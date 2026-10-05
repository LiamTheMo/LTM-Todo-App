import { MAX_OUTLINE_CHARACTERS, type OutlineBlock } from "./outline-parser.ts";

export const MAX_OUTLINE_BYTES = 10 * 1024 * 1024;
const MAX_XML_BYTES = 2 * 1024 * 1024;
export function textOutlineBlocks(text: string): OutlineBlock[] {
  if (text.length > MAX_OUTLINE_CHARACTERS) throw new Error("Outline text is too large (maximum 500,000 characters).");
  return text.split(/\r?\n/).map(text => ({ text: text.trim(), heading: /^#{1,6}\s/.test(text) }));
}
export function docxXmlBlocks(xml: string): OutlineBlock[] {
  if (xml.length > MAX_XML_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported or oversized DOCX document.");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("DOCX document contains invalid XML.");
  const body = document.getElementsByTagNameNS("*", "body")[0];
  if (!body) throw new Error("DOCX document has no readable body.");
  const blocks: OutlineBlock[] = [];
  const textOf = (element: Element) => Array.from(element.getElementsByTagNameNS("*", "t")).map(node => node.textContent || "").join("");
  const walk = (element: Element) => {
    if (element.localName === "tr") {
      blocks.push({ text: Array.from(element.children).filter(child => child.localName === "tc").map(cell =>
        Array.from(cell.getElementsByTagNameNS("*", "p")).map(textOf).join(" ")).join(" | ") });
      return;
    }
    if (element.localName === "p") {
      const style = element.getElementsByTagNameNS("*", "pStyle")[0];
      const value = style && Array.from(style.attributes).find(attribute => attribute.localName === "val")?.value;
      blocks.push({ text: textOf(element), heading: /heading|title/i.test(value || "") || element.getElementsByTagNameNS("*", "b").length > 0 });
      return;
    }
    for (const child of element.children) walk(child);
  };
  walk(body);
  if (blocks.reduce((count, block) => count + block.text.length, 0) > MAX_OUTLINE_CHARACTERS) throw new Error("Outline text is too large.");
  return blocks;
}
async function readDocx(bytes: Uint8Array): Promise<OutlineBlock[]> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let entries = 0;
  const files = unzipSync(bytes, { filter: file => {
    if (++entries > 2000) throw new Error("DOCX archive has too many entries.");
    if (file.name !== "word/document.xml") return false;
    if (file.originalSize > MAX_XML_BYTES || file.size > MAX_OUTLINE_BYTES) throw new Error("DOCX text is too large.");
    return true;
  } });
  const xml = files["word/document.xml"];
  if (!xml || xml.byteLength > MAX_XML_BYTES) throw new Error("This file is not a supported DOCX document.");
  return docxXmlBlocks(strFromU8(xml));
}
async function readPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<OutlineBlock[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs-6.4.299.worker.min.mjs";
  const task = pdfjs.getDocument({ data: bytes, stopAtErrors: true, useWasm: false, verbosity: 0 });
  const abort = () => { void task.destroy(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new Error("Import cancelled.");
    const pdf = await task.promise;
    if (pdf.numPages > 100) throw new Error("PDF has more than 100 pages. Import a smaller section.");
    const blocks: OutlineBlock[] = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (signal?.aborted) throw new Error("Import cancelled.");
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      if (content.items.length > 20_000) throw new Error("PDF page has too many text fragments. Import a smaller section.");
      const rows: { y: number; parts: { x: number; text: string; height: number }[] }[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        characters += item.str.length;
        if (characters > MAX_OUTLINE_CHARACTERS) throw new Error("PDF text is too large.");
        const y = item.transform[5];
        let row = rows.find(row => Math.abs(row.y - y) < 3);
        if (!row) { if (rows.length > 5000) throw new Error("PDF page is too complex."); row = { y, parts: [] }; rows.push(row); }
        row.parts.push({ x: item.transform[4], text: item.str, height: item.height });
      }
      const heights = rows.flatMap(row => row.parts.map(part => part.height)).sort((a, b) => a - b);
      const median = heights[Math.floor(heights.length / 2)] || 12;
      blocks.push(...rows.sort((a, b) => b.y - a.y).map(row => ({ page: pageNumber,
        text: row.parts.sort((a, b) => a.x - b.x).map(part => part.text).join(" "),
        heading: row.parts.some(part => part.height > median * 1.2) })));
      page.cleanup();
    }
    if (!blocks.some(block => block.text.trim())) throw new Error("This PDF has no readable text. Scanned PDFs need OCR; paste their recognized text instead.");
    return blocks;
  } finally {
    signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}
/** Reads an ephemeral local file. It never uploads, caches, or writes source bytes to IndexedDB. */
export async function readOutlineDocument(file: File, signal?: AbortSignal): Promise<OutlineBlock[]> {
  if (!file.size || file.size > MAX_OUTLINE_BYTES) throw new Error("Choose a non-empty file up to 10 MiB.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["pdf", "docx", "txt", "md"].includes(extension)) throw new Error("Supported files: PDF, DOCX, TXT, and Markdown.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw new Error("Import cancelled.");
  try {
    if (extension === "pdf") {
      if (new TextDecoder().decode(bytes.slice(0, 1024)).indexOf("%PDF-") < 0) throw new Error("This is not a valid PDF file.");
      return await readPdf(bytes, signal);
    }
    if (extension === "docx") return await readDocx(bytes);
    return textOutlineBlocks(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { if (bytes.buffer.byteLength) bytes.fill(0); }
}
