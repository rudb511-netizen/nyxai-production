/** Mention parsing for composers and rendered bodies. */

const TOKEN = /([#@][A-Za-z][A-Za-z0-9_]{0,29})/g;
const URL_TOKEN = /https?:\/\/[^\s<>"'`]+/gi;

export type RichToken = { type: "text" | "mention" | "tag" | "link"; value: string };

export function splitRichTokens(text: string): RichToken[] {
  const hits: Array<{ start: number; end: number; type: "mention" | "tag" | "link"; value: string }> = [];
  const mentionRe = new RegExp(TOKEN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = mentionRe.exec(text))) {
    hits.push({
      start: m.index,
      end: m.index + m[0]!.length,
      type: m[0]!.startsWith("@") ? "mention" : "tag",
      value: m[0]!,
    });
  }
  const urlRe = new RegExp(URL_TOKEN.source, "gi");
  while ((m = urlRe.exec(text))) {
    const raw = m[0]!;
    const cleaned = raw.replace(/[),.;!?]+$/g, "");
    if (!/^https?:\/\//i.test(cleaned)) continue;
    try {
      const u = new URL(cleaned);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      hits.push({ start: m.index, end: m.index + cleaned.length, type: "link", value: u.href });
    } catch {
      /* skip */
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: RichToken[] = [];
  let last = 0;
  for (const h of hits) {
    if (h.start < last) continue;
    if (h.start > last) out.push({ type: "text", value: text.slice(last, h.start) });
    out.push({ type: h.type, value: h.value });
    last = h.end;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

export function mentionAtCaret(text: string, caret: number): { start: number; query: string } | null {
  const left = text.slice(0, Math.max(0, caret));
  const m = /(?:^|[\s([{"'])@([A-Za-z0-9_]{0,20})$/.exec(left);
  if (!m || m.index === undefined) return null;
  const at = left.lastIndexOf("@");
  if (at < 0) return null;
  return { start: at, query: m[1] ?? "" };
}

export function applyMention(text: string, caret: number, username: string): { text: string; caret: number } {
  const hit = mentionAtCaret(text, caret);
  if (!hit) {
    const insert = `@${username} `;
    const next = text.slice(0, caret) + insert + text.slice(caret);
    return { text: next, caret: caret + insert.length };
  }
  const next = `${text.slice(0, hit.start)}@${username} ${text.slice(caret)}`;
  const newCaret = hit.start + username.length + 2;
  return { text: next, caret: newCaret };
}