import type { CalendarColor } from "./domain.ts";

export type CalendarRGB = { r: number; g: number; b: number };
export type CalendarHSV = { hue: number; saturation: number; value: number };

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
export const toHex = ({ r, g, b }: CalendarRGB): CalendarColor =>
  (`#${[r, g, b].map(value => clampByte(value).toString(16).padStart(2, "0")).join("")}`).toUpperCase() as CalendarColor;
export const fromHex = (hex: string): CalendarRGB => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16)
});

export function rgbToHsv({ r, g, b }: CalendarRGB): CalendarHSV {
  const red = r / 255, green = g / 255, blue = b / 255;
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  let hue = 0;
  if (delta) hue = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation: max ? delta / max : 0, value: max };
}

export function hsvToRgb({ hue, saturation, value }: CalendarHSV): CalendarRGB {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const chroma = value * saturation, x = chroma * (1 - Math.abs((normalizedHue / 60) % 2 - 1)), m = value - chroma;
  const [r, g, b] = normalizedHue < 60 ? [chroma, x, 0] : normalizedHue < 120 ? [x, chroma, 0] :
    normalizedHue < 180 ? [0, chroma, x] : normalizedHue < 240 ? [0, x, chroma] :
    normalizedHue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return { r: clampByte((r + m) * 255), g: clampByte((g + m) * 255), b: clampByte((b + m) * 255) };
}

/** Map pointer deltas to hue/saturation; hue zero is at the wheel's right edge. */
export function colorAtWheelPoint(dx: number, dy: number, radius: number, value: number): CalendarColor {
  const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  const saturation = radius > 0 ? Math.min(1, Math.hypot(dx, dy) / radius) : 0;
  return toHex(hsvToRgb({ hue, saturation, value: Math.min(1, Math.max(0, value)) }));
}
