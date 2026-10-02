export type MdNode =
  | { t: "p"; text: string }
  | { t: "h"; level: number; text: string }
  | { t: "code"; lang: string; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "table"; headers: string[]; rows: string[][] }
  | { t: "hr" }
  | { t: "img"; alt: string; src: string };

const IMG_LINE = /^!\[([^\]]*)\]\((.+)\)$/;

export function splitMarkdown(src: string): MdNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: MdNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        buf.push(lines[i]!);
        i += 1;
      }
      i += 1;
      out.push({ t: "code", lang, text: buf.join("\n") });
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      out.push({ t: "h", level, text: line.replace(/^#+\s*/, "") });
      i += 1;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      out.push({ t: "hr" });
      i += 1;
      continue;
    }
    const imgHit = line.trim().match(IMG_LINE);
    if (imgHit) {
      out.push({ t: "img", alt: imgHit[1] || "generated", src: imgHit[2]! });
      i += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push({ t: "quote", text: buf.join(" ") });
      continue;
    }
    if (/^\|.+\|/.test(line) && i + 1 < lines.length && /^\|?\s*-+/.test(lines[i + 1]!)) {
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|/.test(lines[i]!)) {
        rows.push(splitRow(lines[i]!));
        i += 1;
      }
      out.push({ t: "table", headers, rows });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      out.push({ t: "ul", items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      out.push({ t: "ol", items });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^```/.test(lines[i]!) &&
      !/^#{1,4}\s/.test(lines[i]!) &&
      !/^\s*[-*]\s+/.test(lines[i]!) &&
      !IMG_LINE.test(lines[i]!.trim())
    ) {
      buf.push(lines[i]!);
      i += 1;
    }
    out.push({ t: "p", text: buf.join(" ") });
  }
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function extractCitations(raw: string): { text: string; urls: string[] } {
  const urls = [...raw.matchAll(/https?:\/\/[^\s)\]>"]+/g)].map((m) => m[0].replace(/[.,;]+$/, ""));
  const unique = [...new Set(urls)].slice(0, 12);
  return { text: raw, urls: unique };
}
