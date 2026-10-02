import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_COLORS,
  CHAT_FONTS,
  CHAT_WALLPAPERS,
  DISAPPEAR_OPTIONS,
  REMINDER_INTERVAL_MS,
  colorHex,
  fontFamily,
  wallpaperCss,
} from "./chat-appearance.ts";

describe("chat appearance", () => {
  it("has 20 colors, 30 fonts, builtin wallpapers, and a 20-minute reminder", () => {
    assert.equal(CHAT_COLORS.length, 20);
    assert.equal(CHAT_FONTS.length, 30);
    assert.ok(CHAT_WALLPAPERS.length >= 10);
    assert.equal(REMINDER_INTERVAL_MS, 20 * 60_000);
    assert.equal(colorHex("nyx-blue").startsWith("#"), true);
    assert.ok(fontFamily("outfit").includes("Outfit"));
    assert.ok(wallpaperCss("void").includes("gradient"));
    assert.equal(DISAPPEAR_OPTIONS[0]?.id, 0);
    assert.ok(DISAPPEAR_OPTIONS.some((o) => o.id === 86400));
  });
});
