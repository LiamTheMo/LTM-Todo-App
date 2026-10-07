"use client";

import { useEffect, useState } from "react";
import type { CalendarColor, Project } from "../lib/domain";
import { CalendarColorPicker } from "./CalendarColorPicker";

export function ProjectEditor({ project, onClose, onSave, onDelete }: {
  project: Project; onClose: () => void; onSave: (name: string, color: string) => void; onDelete: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState<CalendarColor>(/^#[0-9a-f]{6}$/i.test(project.color) ? project.color as CalendarColor : "#c86b24");
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  return <div className="modalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="editor" role="dialog" aria-modal="true" aria-labelledby="project-editor-title" onSubmit={event => { event.preventDefault(); if (name.trim()) onSave(name, color); }}>
      <div className="editorHead"><h2 id="project-editor-title">Edit project</h2><button type="button" aria-label="Close project editor" onClick={onClose}>×</button></div>
      <label>Project name<input autoFocus required value={name} onChange={event => setName(event.target.value)} /></label>
      <fieldset><legend>Project color</legend><CalendarColorPicker value={color} onChange={setColor} /></fieldset>
      <div className="editorActions"><button type="submit" disabled={!name.trim()}>Save project</button><button type="button" onClick={onClose}>Cancel</button><button type="button" className="danger" onClick={() => { if (confirm(`Delete “${project.name}”? Its tasks will stay available in Inbox. Its sections will be removed.`)) onDelete(); }}>Delete project</button></div>
    </form>
  </div>;
}
