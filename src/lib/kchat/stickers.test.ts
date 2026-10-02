import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_INSTALLED_PACK_IDS,
  findSticker,
  NYX_STICKER_PACKS,
  searchStickers,
  stickerDataUrl,
  stickerMarkup,
} from "./stickers.ts";

describe("nyx stickers", () => {
  it("ships a complete owned pack", () => {
    assert.ok(NYX_STICKER_PACKS[0]!.stickers.length >= 12);
    for (const s of NYX_STICKER_PACKS[0]!.stickers) {
      assert.match(stickerMarkup(s), /<svg /);
      assert.ok(stickerDataUrl(stickerMarkup(s)).startsWith("data:image/svg+xml"));
    }
  });

  it("finds and searches stickers", () => {
    const s = findSticker("pack_nyx_signals", "st_night");
    assert.ok(s);
    assert.ok(searchStickers("night").length >= 1);
    assert.equal(findSticker("pack_nyx_signals", "missing"), null);
  });

  it("indexes named catalog stickers", () => {
    assert.ok(NYX_STICKER_PACKS.length >= 20);
    const love = searchStickers("love");
    assert.ok(love.some((s) => /love/i.test(s.name)));
    const omo = searchStickers("omo");
    assert.ok(omo.some((s) => /omo/i.test(s.name)));
    const gaming = searchStickers("gaming");
    assert.ok(gaming.length >= 5);
    const ids = new Set<string>();
    for (const pack of NYX_STICKER_PACKS) {
      for (const st of pack.stickers) {
        assert.ok(st.name.length > 0);
        assert.equal(ids.has(st.id), false, st.id);
        ids.add(st.id);
      }
    }
    assert.ok(ids.size > 200);
    assert.ok(DEFAULT_INSTALLED_PACK_IDS.includes("pack_reactions"));
  });
});
