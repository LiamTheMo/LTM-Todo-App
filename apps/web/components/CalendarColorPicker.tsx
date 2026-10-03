"use client";

import { useRef } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { CalendarColor } from "../lib/domain";
import { colorAtWheelPoint, fromHex, hsvToRgb, rgbToHsv, toHex, type CalendarRGB } from "../lib/color-picker";

export function CalendarColorPicker({ value, onChange }: { value: CalendarColor; onChange: (value: CalendarColor) => void }) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const rgb = fromHex(value), hsv = rgbToHsv(rgb);
  const wheelPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (bounds.left + bounds.width / 2), dy = event.clientY - (bounds.top + bounds.height / 2);
    const radius = Math.min(bounds.width, bounds.height) / 2;
    onChange(colorAtWheelPoint(dx, dy, radius, hsv.value));
  };
  const updateChannel = (channel: keyof CalendarRGB, raw: string) => {
    if (raw === "") return;
    onChange(toHex({ ...rgb, [channel]: Math.max(0, Math.min(255, Math.round(Number(raw)))) }));
  };
  const markerStyle = { left: `${50 + Math.cos(hsv.hue * Math.PI / 180) * hsv.saturation * 48}%`,
    top: `${50 + Math.sin(hsv.hue * Math.PI / 180) * hsv.saturation * 48}%` } as CSSProperties;
  const labels: Array<[keyof CalendarRGB, string]> = [["r", "R"], ["g", "G"], ["b", "B"]];
  return <div className="calendarColorPicker">
    <div ref={wheelRef} className="calendarSpectrumWheel" role="slider" tabIndex={0} aria-label="Calendar color spectrum" aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.round(hsv.hue)}
      aria-valuetext={`${value}, RGB ${rgb.r} ${rgb.g} ${rgb.b}`} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); wheelPointer(event); }}
      onPointerMove={event => { if (event.buttons) wheelPointer(event); }}
      onKeyDown={event => { if (event.key.startsWith("Arrow")) { event.preventDefault(); const hue = (hsv.hue + (event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : 359)) % 360; onChange(toHex(hsvToRgb({ ...hsv, hue }))); } }}>
      <span className="calendarSpectrumMarker" style={markerStyle} />
    </div>
    <label className="calendarBrightness">Brightness <span>{rgb.r === rgb.g && rgb.g === rgb.b ? rgb.r : Math.round(hsv.value * 255)}</span>
      <input aria-label="Color brightness" type="range" min="0" max="255" value={Math.round(hsv.value * 255)}
        style={{ "--brightness-color": toHex(hsvToRgb({ hue: hsv.hue, saturation: 1, value: 1 })) } as CSSProperties}
        onChange={event => onChange(toHex(hsvToRgb({ ...hsv, value: Number(event.target.value) / 255 })))} />
    </label>
    <div className="calendarRgbChannels">{labels.map(([channel, label]) => <label className="calendarRgbChannel" key={channel}>{label}
      <input aria-label={`${label} color channel`} type="number" inputMode="numeric" min="0" max="255" value={rgb[channel]}
        onChange={event => updateChannel(channel, event.target.value)} /></label>)}</div>
    <output className="calendarHexOutput"><i style={{ backgroundColor: value }} />{value} · RGB {rgb.r}, {rgb.g}, {rgb.b}</output>
  </div>;
}
