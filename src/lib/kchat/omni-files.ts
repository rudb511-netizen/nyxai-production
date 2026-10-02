/** Extract usable text from uploads. Never invent file contents. */

export type OmniAttachment = {
  name: string;
  mime: string;
  kind: "text" | "image" | "table" | "doc";
  text: string;
  dataUrl?: string | null;
  bytes: number;
};

const TEXT_MAX = 24_000;

export function sniffKind(name: string, mime: string): OmniAttachment["kind"] {
  const n = name.toLowerCase();
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (n.endsWith(".csv") || n.endsWith(".tsv") || n.endsWith(".xlsx") || n.endsWith(".json")) {
    return "table";
  }
  if (n.endsWith(".pdf") || n.endsWith(".docx") || n.endsWith(".pptx") || n.endsWith(".doc")) {
    return "doc";
  }
  return "text";
}

export function extractPdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const chunks: string[] = [];
  const re = /\((?:\\.|[^\\)]){1,400}\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const inner = m[0].slice(1, m[0].lastIndexOf(")"));
    const text = inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
    if (/[A-Za-z0-9]/.test(text)) chunks.push(text);
  }
  const joined = chunks.join(" ").replace(/[^\S\n]+/g, " ").trim();
  if (joined.length > 40) return joined.slice(0, TEXT_MAX);
  const strings = raw.match(/[\x20-\x7e]{6,}/g) ?? [];
  return strings
    .filter((s) => /[A-Za-z]{3}/.test(s) && !s.startsWith("%PDF"))
    .join(" ")
    .slice(0, TEXT_MAX);
}

export function parseCsvPreview(text: string, maxRows = 40): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, maxRows + 1);
  if (lines.length === 0) return "";
  return lines.join("\n").slice(0, TEXT_MAX);
}

export function summarizeExtract(att: OmniAttachment): string {
  if (att.kind === "image") return `[Image: ${att.name}]`;
  const body = att.text.trim();
  if (!body) return `[File ${att.name}: no extractable text]`;
  return `--- file: ${att.name} ---\n${body}\n--- end ---`;
}

export async function extractFromArrayBuffer(
  name: string,
  mime: string,
  buf: ArrayBuffer,
): Promise<OmniAttachment> {
  const bytes = new Uint8Array(buf);
  const kind = sniffKind(name, mime);
  const n = name.toLowerCase();
  if (kind === "image") {
    return { name, mime, kind, text: "", dataUrl: null, bytes: bytes.byteLength };
  }
  if (n.endsWith(".pdf") || mime === "application/pdf") {
    return {
      name,
      mime,
      kind: "doc",
      text: extractPdfText(bytes),
      bytes: bytes.byteLength,
    };
  }
  if (n.endsWith(".docx") || n.endsWith(".pptx") || n.endsWith(".xlsx")) {
    const text = await extractOfficeText(bytes, n);
    return {
      name,
      mime,
      kind: n.endsWith(".xlsx") ? "table" : "doc",
      text: text || "[Could not extract text from this Office file]",
      bytes: bytes.byteLength,
    };
  }
  const asText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (n.endsWith(".csv") || n.endsWith(".tsv") || n.endsWith(".json") || n.endsWith(".txt") || n.endsWith(".md") || mime.startsWith("text/")) {
    return {
      name,
      mime,
      kind: n.endsWith(".csv") || n.endsWith(".tsv") || n.endsWith(".json") ? "table" : "text",
      text: parseCsvPreview(asText),
      bytes: bytes.byteLength,
    };
  }
  const printable = asText.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim();
  return {
    name,
    mime,
    kind,
    text: printable.slice(0, TEXT_MAX),
    bytes: bytes.byteLength,
  };
}

async function inflateRaw(data: Uint8Array): Promise<string> {
  const ds = new DecompressionStream("deflate-raw");
  const copy = Uint8Array.from(data);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buf);
}

async function extractOfficeText(bytes: Uint8Array, name: string): Promise<string> {
  const fileRe = name.endsWith(".xlsx")
    ? /(xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml)$/i
    : name.endsWith(".pptx")
      ? /ppt\/slides\/slide\d+\.xml$/i
      : /word\/document\.xml$/i;
  const tagRe = name.endsWith(".xlsx")
    ? /<(?:t|v)[^>]*>([^<]*)<\/(?:t|v)>/g
    : /<(?:w:t|a:t)[^>]*>([^<]*)<\/(?:w:t|a:t)>/g;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: string[] = [];
  let i = 0;
  while (i < bytes.length - 30) {
    if (view.getUint32(i, true) !== 0x04034b50) {
      i += 1;
      continue;
    }
    const method = view.getUint16(i + 8, true);
    const comp = view.getUint32(i + 18, true);
    const nameLen = view.getUint16(i + 26, true);
    const extra = view.getUint16(i + 28, true);
    const entry = new TextDecoder().decode(bytes.slice(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extra;
    if (comp === 0 || start + comp > bytes.length) {
      i += 4;
      continue;
    }
    const payload = bytes.slice(start, start + comp);
    i = start + comp;
    if (!fileRe.test(entry)) continue;
    let xml = "";
    try {
      xml = method === 0 ? new TextDecoder().decode(payload) : await inflateRaw(payload);
    } catch {
      continue;
    }
    for (const m of xml.matchAll(tagRe)) {
      if (m[1]) parts.push(m[1]);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
}
