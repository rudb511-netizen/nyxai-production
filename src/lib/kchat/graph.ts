/** Pure helpers for lists, hashtags, schedule, phone, and export. No I/O. */

export const LIST_NAME_MAX = 40;
export const HIGHLIGHT_NAME_MAX = 32;
export const SCHEDULE_MIN_MS = 60_000;
export const SCHEDULE_MAX_MS = 90 * 24 * 3600_000;
export const THREAD_ITEM_MAX = 8;
export const PHONE_E164 = /^\+[1-9]\d{7,14}$/;

export function normalizeListName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, LIST_NAME_MAX);
}

export function normalizeHighlightName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, HIGHLIGHT_NAME_MAX);
}

export function normalizeTag(raw: string): string {
  return raw.replace(/^#/, "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
}

export function tagsFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /#([A-Za-z][A-Za-z0-9_]{0,29})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tag = normalizeTag(m[1] ?? "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Suggested starters. Users can delete them; they are not reinserted. */
export function seedDefaultTags(text: string): string {
  if (text.trim()) return text;
  return "#Nyx #krdx ";
}

export function removeHashtag(text: string, tag: string): string {
  const n = normalizeTag(tag);
  if (!n) return text;
  return text
    .replace(new RegExp(`#${n}\\b`, "gi"), "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+/, "");
}

export function appendHashtag(text: string, raw: string): string {
  const display = raw.replace(/^#/, "").trim();
  const n = normalizeTag(display);
  if (!n || tagsFromText(text).includes(n)) return text;
  const token = /^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(display) ? display : n;
  const sep = text.length > 0 && !/\s$/.test(text) ? " " : "";
  return `${text}${sep}#${token}`;
}


export function isValidE164(phone: string): boolean {
  return PHONE_E164.test(phone.trim());
}

export function scheduleWindowOk(when: Date, now = new Date()): string | null {
  const delta = when.getTime() - now.getTime();
  if (Number.isNaN(when.getTime())) return "Pick a real date and time.";
  if (delta < SCHEDULE_MIN_MS) return "Schedule at least one minute from now.";
  if (delta > SCHEDULE_MAX_MS) return "You can schedule up to 90 days ahead.";
  return null;
}

export function parseScheduleAt(raw: string | null | undefined, now = new Date()): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error("Pick a real date and time.");
  const issue = scheduleWindowOk(d, now);
  if (issue) throw new Error(issue);
  return d;
}

export function sixDigitOtp(bytes: Uint8Array): string {
  const n = ((bytes[0] ?? 0) << 16) | ((bytes[1] ?? 0) << 8) | (bytes[2] ?? 0);
  return String(n % 1_000_000).padStart(6, "0");
}

export function otpShapeOk(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

export type ExportSection =
  | "profile"
  | "posts"
  | "comments"
  | "follows"
  | "friends"
  | "messages"
  | "stories"
  | "lists"
  | "bookmarks";

export const EXPORT_SECTIONS: ExportSection[] = [
  "profile",
  "posts",
  "comments",
  "follows",
  "friends",
  "messages",
  "stories",
  "lists",
  "bookmarks",
];

export function visibilityOk(v: string | undefined): v is "everyone" | "followers" | "mentioned" {
  return v === "everyone" || v === "followers" || v === "mentioned";
}

export function liveKindOk(v: string | undefined): v is "video" | "audio" {
  return v === "video" || v === "audio";
}

export function commentSortOk(v: string | undefined): v is "newest" | "liked" | "relevant" {
  return v === "newest" || v === "liked" || v === "relevant";
}

export function speakerRoleOk(v: string): v is "host" | "cohost" | "speaker" | "listener" | "requested" {
  return v === "host" || v === "cohost" || v === "speaker" || v === "listener" || v === "requested";
}

export function websiteOk(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v.startsWith("http") ? v : `https://${v}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().slice(0, 200);
  } catch {
    return null;
  }
}
