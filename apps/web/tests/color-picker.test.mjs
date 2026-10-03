import test from "node:test";
import assert from "node:assert/strict";
import { colorAtWheelPoint, fromHex, hsvToRgb, rgbToHsv, toHex } from "../lib/color-picker.ts";

const radius = 100;
const at = (degrees, value = 1) => colorAtWheelPoint(
  Math.cos(degrees * Math.PI / 180) * radius,
  Math.sin(degrees * Math.PI / 180) * radius,
  radius,
  value
);

test("wheel pointer hues match the visible sRGB spectrum around the circle", () => {
  assert.equal(at(0), "#FF0000");
  assert.equal(at(60), "#FFFF00");
  assert.equal(at(120), "#00FF00");
  assert.equal(at(180), "#00FFFF");
  assert.equal(at(240), "#0000FF");
  assert.equal(at(300), "#FF00FF");
});

test("wheel interior keeps the selected hue and brightness", () => {
  assert.equal(colorAtWheelPoint(50, 0, radius, 1), "#FF8080");
  assert.equal(colorAtWheelPoint(100, 0, radius, 207 / 255), "#CF0000");
});

test("RGB and HSV conversion preserves exact channel values", () => {
  const color = { r: 12, g: 188, b: 241 };
  assert.deepEqual(fromHex(toHex(color)), color);
  assert.deepEqual(hsvToRgb(rgbToHsv(color)), color);
});

test("brightness can reach black and preserves each channel's full 8-bit range", () => {
  assert.equal(toHex(hsvToRgb({ hue: 60, saturation: 1, value: 1 })), "#FFFF00");
  assert.equal(toHex(hsvToRgb({ hue: 60, saturation: 1, value: 0 })), "#000000");
  assert.equal(toHex(hsvToRgb({ hue: 300, saturation: 1, value: 128 / 255 })), "#800080");
});
