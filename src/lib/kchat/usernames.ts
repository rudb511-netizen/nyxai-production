const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
const RESERVED = new Set([
  "admin",
  "administrator",
  "omnifeed",
  "omniai",
  "omnisupport",
  "nyx",
  "nyxai",
  "nyxsupport",
  "nyxaiplus",
  "superomni",
  "kchat",
  "k-chat",
  "kai",
  "support",
  "help",
  "official",
  "system",
  "mod",
  "moderator",
  "root",
  "api",
  "login",
  "register",
  "settings",
  "discover",
  "inbox",
  "watch",
  "live",
  "admin",
  "me",
  "capture",
  "atlas",
  "memories",
  "flash",
  "flashes",
  "map",
  "omni",
  "null",
  "undefined",
]);

export type UsernameIssue =
  | "too_short"
  | "too_long"
  | "invalid"
  | "reserved"
  | "taken";

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function validateUsername(raw: string): UsernameIssue | null {
  const u = normalizeUsername(raw);
  if (u.length < 3) return "too_short";
  if (u.length > 20) return "too_long";
  if (!USERNAME_RE.test(u)) return "invalid";
  if (RESERVED.has(u)) return "reserved";
  return null;
}

export function usernameError(issue: UsernameIssue): string {
  switch (issue) {
    case "too_short":
      return "Usernames need at least 3 characters.";
    case "too_long":
      return "Usernames can be at most 20 characters.";
    case "invalid":
      return "Use letters, numbers, and underscores. Start with a letter.";
    case "reserved":
      return "That username is reserved.";
    case "taken":
      return "That username is already taken.";
  }
}

export function slugifyName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
  if (s.length >= 3 && USERNAME_RE.test(s) && !RESERVED.has(s)) return s;
  return "user";
}

export function extractHashtags(text: string): string[] {
  const tags = new Set<string>();
  const re = /#([a-zA-Z][a-zA-Z0-9_]{1,29})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tags.add(m[1]!.toLowerCase());
  return [...tags];
}

export function extractMentions(text: string): string[] {
  const names = new Set<string>();
  const re = /@([a-zA-Z][a-zA-Z0-9_]{2,19})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) names.add(m[1]!.toLowerCase());
  return [...names];
}
