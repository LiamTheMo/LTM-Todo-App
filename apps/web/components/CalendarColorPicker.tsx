"use client";

import { useRef } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { CalendarColor } from "../lib/domain";

type RGB = { r: number; g: number; b: number };
const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const toHex = ({ r, g, b }: RGB): CalendarColor =>
  (`#${[r, g, b].map(value => clamp(value).toString(16).padStart(2, "0")).join("")}`).toUpperCase() as CalendarColor;
const fromHex = (hex: string): RGB => ({
  r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16)
});
function toHsv({ r, g, b }: RGB) {
  const red = r / 255, green = g / 255, blue = b / 255;
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  let hue = 0;
  if (delta) hue = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation: max ? delta / max : 0, value: max };
}
function fromHsv(hue: number, saturation: number, value: number): RGB {
  const chroma = value * saturation, x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)), m = value - chroma;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] :
    hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return { r: clamp((r + m) * 255), g: clamp((g + m) * 255), b: clamp((b + m) * 255) };
}

export function CalendarColorPicker({ value, onChange }: { value: CalendarColor; onChange: (value: CalendarColor) => void }) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const rgb = fromHex(value), hsv = toHsv(rgb);
  const wheelPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (bounds.left + bounds.width / 2), dy = event.clientY - (bounds.top + bounds.height / 2);
    const radius = Math.min(bounds.width, bounds.height) / 2;
    const saturation = Math.max(0, Math.min(1, Math.hypot(dx, dy) / radius));
    const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    onChange(toHex(fromHsv(hue, saturation, hsv.value)));
  };
  const updateChannel = (channel: keyof RGB, raw: string) => {
    if (raw === "") return;
    onChange(toHex({ ...rgb, [channel]: clamp(Number(raw)) }));
  };
  const markerStyle = { left: `${50 + Math.cos(hsv.hue * Math.PI / 180) * hsv.saturation * 48}%`,
    top: `${50 + Math.sin(hsv.hue * Math.PI / 180) * hsv.saturation * 48}%` } as CSSProperties;
  const labels: Array<[keyof RGB, string]> = [["r", "R"], ["g", "G"], ["b", "B"]];
  return <div className="calendarColorPicker">
    <div ref={wheelRef} className="calendarSpectrumWheel" role="slider" tabIndex={0} aria-label="Calendar color spectrum"
      aria-valuetext={`${value}, RGB ${rgb.r} ${rgb.g} ${rgb.b}`} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); wheelPointer(event); }}
      onPointerMove={event => { if (event.buttons) wheelPointer(event); }}
      onKeyDown={event => { if (event.key.startsWith("Arrow")) { event.preventDefault(); const h = (hsv.hue + (event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : 359)) % 360; onChange(toHex(fromHsv(h, hsv.saturation, hsv.value))); } }}>
      <span className="calendarSpectrumMarker" style={markerStyle} />
    </div>
    <label className="calendarBrightness">Brightness <span>{rgb.r === rgb.g && rgb.g === rgb.b ? rgb.r : Math.round(hsv.value * 255)}</span>
      <input aria-label="Color brightness" type="range" min="0" max="255" value={Math.round(hsv.value * 255)}
        style={{ "--brightness-color": toHex(fromHsv(hsv.hue, 1, 1)) } as CSSProperties}
        onChange={event => onChange(toHex(fromHsv(hsv.hue, hsv.saturation, Number(event.target.value) / 255)))} />
    </label>
    <div className="calendarRgbChannels">{labels.map(([channel, label]) => <label className="calendarRgbChannel" key={channel}>{label}
      <input aria-label={`${label} color channel`} type="number" inputMode="numeric" min="0" max="255" value={rgb[channel]}
        onChange={event => updateChannel(channel, event.target.value)} /></label>)}</div>
    <output className="calendarHexOutput"><i style={{ backgroundColor: value }} />{value} · RGB {rgb.r}, {rgb.g}, {rgb.b}</output>
  </div>;
}
