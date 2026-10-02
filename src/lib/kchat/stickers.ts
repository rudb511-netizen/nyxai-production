/** NYX-owned sticker packs. Designed SVG cards — not emoji-as-message. */

import { CATALOG_PACKS } from "./sticker-catalog.ts";
import { phraseStickerSvg, stickerSlug, toneFor } from "./sticker-art.ts";

export type StickerDef = {
  id: string;
  name: string;
  emoji: string;
  svg?: string;
  tags: string[];
  animated?: boolean;
};
export type StickerPackDef = {
  id: string;
  title: string;
  authorName: string;
  category: string;
  description: string;
  stickers: StickerDef[];
};

const INK = "#3f6d12";
const PAPER = "#f7ffe8";
const NIGHT = "#10140f";
const ATLAS = "#0d7a8c";
const LIVE = "#d61f46";
const GOLD = "#b57a12";

function svg(body: string, bg = PAPER): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">${bg ? `<rect width="96" height="96" rx="22" fill="${bg}"/>` : ""}${body}</svg>`;
}

const SIGNALS: StickerPackDef = {
  id: "pack_nyx_signals",
  title: "NYX Signals",
  authorName: "NYX",
  category: "official",
  description: "The original night marks.",
  stickers: [
    { id: "st_pulse", name: "Pulse", emoji: "◎", tags: ["pulse", "signal"], svg: svg(`<circle cx="48" cy="48" r="10" fill="${INK}"/><circle cx="48" cy="48" r="20" fill="none" stroke="${INK}" stroke-width="3" opacity=".7"/><circle cx="48" cy="48" r="30" fill="none" stroke="${INK}" stroke-width="2" opacity=".4"/>`) },
    { id: "st_night", name: "Night", emoji: "☾", tags: ["night", "moon"], svg: svg(`<path d="M58 22a26 26 0 1 0 16 42 30 30 0 1 1-16-42z" fill="${NIGHT}"/>`, "#dce8d4") },
    { id: "st_spark", name: "Spark", emoji: "✦", tags: ["spark"], svg: svg(`<path d="M48 14l6 26 26 6-26 6-6 26-6-26-26-6 26-6z" fill="${GOLD}"/>`) },
    { id: "st_bolt", name: "Bolt", emoji: "⚡", tags: ["bolt"], svg: svg(`<path d="M54 12 28 52h20l-8 32 34-46H52z" fill="${GOLD}"/>`) },
    { id: "st_lock", name: "Lock", emoji: "🔒", tags: ["lock"], svg: svg(`<rect x="28" y="42" width="40" height="32" rx="6" fill="${INK}"/><path d="M36 42v-8a12 12 0 0 1 24 0v8" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><circle cx="48" cy="58" r="4" fill="${PAPER}"/>`) },
    { id: "st_check", name: "Check", emoji: "✓", tags: ["check", "yes"], svg: svg(`<circle cx="48" cy="48" r="28" fill="${INK}"/><path d="M34 50l10 10 20-22" fill="none" stroke="${PAPER}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`) },
    { id: "st_heart", name: "Heart", emoji: "❤", tags: ["heart", "love"], svg: svg(`<path d="M48 76s-24-16-24-34a14 14 0 0 1 24-9 14 14 0 0 1 24 9c0 18-24 34-24 34z" fill="${LIVE}"/>`) },
    { id: "st_wave", name: "Wave", emoji: "〰", tags: ["wave", "hi"], svg: svg(`<path d="M12 58c8-16 16-16 24 0s16 16 24 0 16-16 24 0" fill="none" stroke="${ATLAS}" stroke-width="6" stroke-linecap="round"/>`) },
    { id: "st_pin", name: "Pin", emoji: "📍", tags: ["pin"], svg: svg(`<path d="M48 16a20 20 0 0 1 20 20c0 16-20 40-20 40S28 52 28 36A20 20 0 0 1 48 16z" fill="${ATLAS}"/><circle cx="48" cy="36" r="7" fill="${PAPER}"/>`) },
    { id: "st_shield", name: "Shield", emoji: "🛡", tags: ["shield"], svg: svg(`<path d="M48 14 22 26v22c0 18 12 30 26 40 14-10 26-22 26-40V26z" fill="${INK}"/><path d="M48 30v28" stroke="${PAPER}" stroke-width="4" stroke-linecap="round"/><path d="M38 44h20" stroke="${PAPER}" stroke-width="4" stroke-linecap="round"/>`) },
    { id: "st_plus", name: "Plus", emoji: "+", tags: ["plus"], svg: svg(`<rect x="42" y="22" width="12" height="52" rx="4" fill="${INK}"/><rect x="22" y="42" width="52" height="12" rx="4" fill="${INK}"/>`) },
    { id: "st_ring", name: "Ring", emoji: "○", tags: ["ring"], svg: svg(`<circle cx="48" cy="48" r="24" fill="none" stroke="${GOLD}" stroke-width="8"/><circle cx="48" cy="48" r="12" fill="none" stroke="${INK}" stroke-width="3"/>`) },
    { id: "st_comet", name: "Comet", emoji: "☄", tags: ["comet"], svg: svg(`<circle cx="62" cy="34" r="12" fill="${GOLD}"/><path d="M50 46 18 78" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M44 40 20 64" stroke="${INK}" stroke-width="4" stroke-linecap="round" opacity=".6"/>`) },
    { id: "st_fire", name: "Fire", emoji: "🔥", tags: ["fire"], svg: svg(`<path d="M48 18s8 14 8 26a16 16 0 1 1-32 0c0-8 8-18 12-26 4 8 8 12 12 0z" fill="${LIVE}"/><path d="M48 46a8 8 0 1 1-10 10c2-8 6-10 10-10z" fill="${GOLD}"/>`) },
    { id: "st_moonring", name: "Moonring", emoji: "◎", tags: ["moon"], svg: svg(`<circle cx="48" cy="48" r="28" fill="none" stroke="${NIGHT}" stroke-width="6"/><circle cx="48" cy="48" r="8" fill="${INK}"/>`) },
    { id: "st_send", name: "Send", emoji: "➤", tags: ["send"], svg: svg(`<path d="M20 48 76 24 52 76 44 52z" fill="${INK}"/>`) },
  ],
};

function catalogPacks(): StickerPackDef[] {
  return CATALOG_PACKS.map((pack) => {
    const animated = new Set(pack.animated ?? []);
    const used = new Map<string, number>();
    return {
      id: pack.id,
      title: pack.title,
      authorName: "NYX",
      category: pack.category,
      description: pack.description,
      stickers: pack.names.map((name) => {
        const base = `st_${pack.id.replace(/^pack_/, "")}_${stickerSlug(name)}`;
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        const id = n === 1 ? base : `${base}_${n}`;
        return {
          id,
          name,
          emoji: name.slice(0, 2),
          tags: [pack.category, pack.title.toLowerCase(), ...name.toLowerCase().split(/\s+/)].filter(Boolean),
          animated: animated.has(name),
        };
      }),
    };
  });
}

export const NYX_STICKER_PACKS: StickerPackDef[] = [SIGNALS, ...catalogPacks()];

export const DEFAULT_INSTALLED_PACK_IDS = [
  "pack_nyx_signals",
  "pack_reactions",
  "pack_greetings",
  "pack_everyday",
] as const;

const BY_ID = new Map<string, StickerDef & { packId: string }>();
for (const pack of NYX_STICKER_PACKS) {
  for (const s of pack.stickers) BY_ID.set(`${pack.id}:${s.id}`, { ...s, packId: pack.id });
}

export function findSticker(packId: string, stickerId: string): (StickerDef & { packId: string }) | null {
  return BY_ID.get(`${packId}:${stickerId}`) ?? null;
}

export function findStickerById(stickerId: string): (StickerDef & { packId: string }) | null {
  for (const pack of NYX_STICKER_PACKS) {
    const s = pack.stickers.find((x) => x.id === stickerId);
    if (s) return { ...s, packId: pack.id };
  }
  return null;
}

export function stickerMarkup(def: StickerDef): string {
  if (def.svg) return def.svg;
  const svgMarkup = phraseStickerSvg(def.name, { animated: Boolean(def.animated), seed: def.id });
  def.svg = svgMarkup;
  return svgMarkup;
}

export function stickerDataUrl(svgMarkup: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`;
}

export function stickerRenderUrl(opts: {
  packId?: string | null;
  stickerId?: string | null;
  mediaUrl?: string | null;
}): string | null {
  if (opts.packId && opts.stickerId) {
    const def = findSticker(opts.packId, opts.stickerId);
    if (def) return stickerDataUrl(stickerMarkup(def));
  }
  if (opts.stickerId) {
    const def = findStickerById(opts.stickerId);
    if (def) return stickerDataUrl(stickerMarkup(def));
  }
  return opts.mediaUrl ?? null;
}

export function searchStickers(q: string): Array<StickerDef & { packId: string }> {
  const needle = q.trim().toLowerCase();
  const out: Array<StickerDef & { packId: string }> = [];
  for (const pack of NYX_STICKER_PACKS) {
    for (const s of pack.stickers) {
      if (
        !needle ||
        s.name.toLowerCase().includes(needle) ||
        s.emoji.toLowerCase().includes(needle) ||
        s.id.includes(needle) ||
        s.tags.some((t) => t.includes(needle)) ||
        pack.title.toLowerCase().includes(needle) ||
        pack.category.toLowerCase().includes(needle)
      ) {
        out.push({ ...s, packId: pack.id });
      }
    }
  }
  return out;
}

export function packCoverUrl(pack: StickerPackDef): string {
  const s = pack.stickers[0];
  return s ? stickerDataUrl(stickerMarkup(s)) : "";
}

export function isOfficialPackId(id: string): boolean {
  return NYX_STICKER_PACKS.some((p) => p.id === id);
}

export { toneFor };
