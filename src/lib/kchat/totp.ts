/** RFC 6238 TOTP (SHA-1, 30s, 6 digits). Pure Web Crypto — no extra deps. */

const PERIOD = 30;
const DIGITS = 6;

function base32Encode(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data.buffer as ArrayBuffer);
  return new Uint8Array(sig);
}

export async function totpAt(secret: string, timeMs = Date.now()): Promise<string> {
  const counter = Math.floor(timeMs / 1000 / PERIOD);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(4, counter);
  const hash = await hmacSha1(base32Decode(secret), new Uint8Array(buf));
  const offset = hash[hash.length - 1]! & 0x0f;
  const bin =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export async function verifyTotp(secret: string, code: string, window = 1): Promise<boolean> {
  const trimmed = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) return false;
  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    const expected = await totpAt(secret, now + i * PERIOD * 1000);
    if (expected === trimmed) return true;
  }
  return false;
}

export function totpOtpauthUrl(secret: string, account: string): string {
  const label = encodeURIComponent(`NYX:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=NYX&period=${PERIOD}&digits=${DIGITS}`;
}

export async function hashBackupCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code.trim().toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateBackupCodes(n = 8): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let s = "";
    for (const b of bytes) s += alphabet[b % alphabet.length];
    codes.push(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return codes;
}
