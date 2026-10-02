/** Server-only API key pool. Secrets stay in the process environment and `.env`. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AiProvider = "gemini" | "openrouter" | "openai";

export type KeySlot = {
  id: string;
  provider: AiProvider;
  secret: string;
  cooldownUntil: number;
  requests: number;
  errors: number;
  authBlocked: boolean;
};

const RATE_COOLDOWN_MS = 60_000;
const AUTH_COOLDOWN_MS = 30 * 60_000;
const TEMP_COOLDOWN_MS = 20_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

let slots: KeySlot[] | null = null;
let cursor = 0;

export function classifyProvider(secret: string): AiProvider | null {
  const key = secret.trim();
  if (!key || key.includes("your-") || key.endsWith("...")) return null;
  if (key.startsWith("sk-or-")) return "openrouter";
  if (key.startsWith("AQ.") || key.startsWith("AIza")) return "gemini";
  if (key.startsWith("sk-")) return "openai";
  return null;
}

export function cooldownMs(kind: "rate" | "auth" | "temporary", retryAfterMs?: number): number {
  if (kind === "auth") return AUTH_COOLDOWN_MS;
  if (kind === "rate") {
    const hinted = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : RATE_COOLDOWN_MS;
    return Math.min(MAX_COOLDOWN_MS, Math.max(1_000, hinted));
  }
  return TEMP_COOLDOWN_MS;
}

export function failureKind(status: number, body: string): "rate" | "auth" | "temporary" | "model" | "fatal" {
  const s = body.toLowerCase();
  if (status === 429 || /rate limit|too many requests|quota|resource_exhausted|insufficient_quota/.test(s)) return "rate";
  if (status === 401 || status === 403 || /invalid api key|incorrect api key|unauthorized|permission/.test(s)) return "auth";
  if (status === 402 || /billing|credit balance|insufficient/.test(s)) return "rate";
  if (status === 404 || /no such model|model not found|does not exist|not supported/.test(s)) return "model";
  if (status === 408 || status === 409 || status >= 500 || /timeout|timed out|temporar|unavailable|econnreset|fetch failed/.test(s)) {
    return "temporary";
  }
  if (status >= 400) return "fatal";
  return "temporary";
}

function envFileText(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const paths = ["/workspace/.env", resolve(process.cwd(), ".env"), resolve(here, "../../../.env"), resolve(here, "../../../../.env")];
  for (const path of paths) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      /* next */
    }
  }
  return "";
}

function valuesFromEnvFile(name: string): string[] {
  const text = envFileText();
  if (!text) return [];
  const out: string[] = [];
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(.*)\\s*$`, "gm");
  for (const match of text.matchAll(re)) {
    const value = match[1]?.trim().replace(/^["']|["']$/g, "");
    if (value) out.push(value);
  }
  return out;
}

function collectSecrets(): Array<{ id: string; secret: string }> {
  const found: Array<{ id: string; secret: string }> = [];
  const push = (id: string, raw: string | undefined) => {
    const secret = raw?.trim().replace(/^["']|["']$/g, "");
    if (!secret || found.some((item) => item.secret === secret)) return;
    const provider = classifyProvider(secret);
    if (provider !== "openrouter" && provider !== "gemini") return;
    found.push({ id, secret });
  };
  const file = envFileText();
  for (const match of file.matchAll(/^\s*(PROVIDER_[A-Z]_API_KEY_\d+)\s*=\s*(.+)\s*$/gm)) {
    push(match[1] ?? "", match[2]);
  }
  for (let n = 1; n <= 20; n++) push(`AI_API_KEY_${n}`, valuesFromEnvFile(`AI_API_KEY_${n}`)[0]);
  push("gemini", valuesFromEnvFile("GEMINI_API_KEY")[0] || valuesFromEnvFile("GOOGLE_API_KEY")[0]);
  push("openrouter", valuesFromEnvFile("OPENROUTER_API_KEY")[0]);
  return found;
}

export function useKeySlots(next: KeySlot[]): void {
  slots = next.map((slot) => ({
    ...slot,
    cooldownUntil: slot.cooldownUntil || 0,
    requests: slot.requests || 0,
    errors: slot.errors || 0,
    authBlocked: slot.authBlocked || false,
  }));
  cursor = 0;
}

export function resetKeyPool(): void {
  slots = null;
  cursor = 0;
}

export function loadKeyPool(): KeySlot[] {
  if (slots) return slots;
  slots = collectSecrets().flatMap((item) => {
    const provider = classifyProvider(item.secret);
    if (!provider) return [];
    return [{ id: item.id, provider, secret: item.secret, cooldownUntil: 0, requests: 0, errors: 0, authBlocked: false }];
  });
  return slots;
}

/** Next healthy key. Pass `provider` to stay on one integration; omit it to fail over anywhere. */
export function selectKey(
  excluded: ReadonlySet<string>,
  opts?: { provider?: AiProvider },
  now = Date.now(),
): KeySlot | null {
  const pool = loadKeyPool().filter((slot) => !opts?.provider || slot.provider === opts.provider);
  if (!pool.length) return null;
  for (let offset = 0; offset < pool.length; offset++) {
    const index = (cursor + offset) % pool.length;
    const slot = pool[index]!;
    if (excluded.has(slot.id) || slot.cooldownUntil > now) continue;
    cursor = (index + 1) % pool.length;
    return slot;
  }
  return null;
}

export function coolKey(id: string, ms: number, now = Date.now(), auth = false): void {
  const slot = loadKeyPool().find((item) => item.id === id);
  if (!slot) return;
  slot.cooldownUntil = now + Math.max(0, ms);
  if (auth) slot.authBlocked = true;
}

/** Rate-limit cooldowns must not block chat forever. Invalid keys stay blocked. */
export function relaxCooldowns(): boolean {
  let revived = false;
  for (const slot of loadKeyPool()) {
    if (slot.authBlocked || slot.cooldownUntil <= Date.now()) continue;
    slot.cooldownUntil = 0;
    revived = true;
  }
  return revived;
}

export function releaseKey(id: string): void {
  const slot = loadKeyPool().find((item) => item.id === id);
  if (slot) slot.cooldownUntil = 0;
}

export function noteKeyResult(id: string, ok: boolean): void {
  const slot = loadKeyPool().find((item) => item.id === id);
  if (!slot) return;
  slot.requests += 1;
  if (ok) slot.cooldownUntil = 0;
  else slot.errors += 1;
}

/** Safe for logs and the existing admin screen. Never includes the secret. */
export function keyPoolStatus(now = Date.now()): Array<{
  id: string;
  provider: AiProvider;
  mask: string;
  cooling: boolean;
  requests: number;
  errors: number;
}> {
  return loadKeyPool().map((slot) => ({
    id: slot.id,
    provider: slot.provider,
    mask: `••••${slot.secret.slice(-4)}`,
    cooling: slot.cooldownUntil > now,
    requests: slot.requests,
    errors: slot.errors,
  }));
}
