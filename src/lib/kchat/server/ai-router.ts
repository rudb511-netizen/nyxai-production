/** Server-only chat router. Keys stay in the environment. No secrets in results. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { GoogleGenAI } from "@google/genai";

export type ProviderName = "openrouter" | "gemini" | "mistral" | "openai" | "runway";
export type ProviderHealth = "available" | "rate_limited" | "invalid_key" | "temporarily_unavailable" | "not_configured";
export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatResult = {
  text: string;
  provider: Exclude<ProviderName, "runway">;
  model: string;
  tokensIn: number;
  tokensOut: number;
};

const SYSTEM =
  "You are NYXAI, the assistant inside the NYX app. Answer the latest user message directly, clearly, and concisely.";

const health = new Map<ProviderName, ProviderHealth>();

function envFile(): string {
  let root = process.cwd();
  try {
    root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  } catch {
    /* bundled runtime without a file URL */
  }
  const paths = [resolve(root, ".env"), "/workspace/.env", resolve(process.cwd(), ".env")];
  for (const path of paths) {
    try {
      loadDotenv({ path, quiet: true, override: false });
    } catch {
      /* dotenv is optional if the file cannot be parsed */
    }
  }
  const chunks: string[] = [];
  for (const path of paths) {
    try {
      chunks.push(readFileSync(path, "utf8"));
    } catch {
      /* another path may exist */
    }
  }
  return chunks.join("\n");
}

function usable(value: string): string {
  const cleaned = value.trim().replace(/^["']|["']$/g, "");
  if (!cleaned || cleaned.includes("your-") || cleaned.endsWith("...") || cleaned === "undefined") return "";
  return cleaned;
}

export function envValue(name: string): string {
  const found: string[] = [];
  for (const line of envFile().split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    if (key !== name) continue;
    const value = usable(trimmed.slice(eq + 1));
    if (value) found.push(value);
  }
  const fromProc = usable(process.env[name] || "");
  if (fromProc) found.push(fromProc);
  const value = found.at(-1) || "";
  if (value) process.env[name] = value;
  return value;
}

function keysLike(prefix: string): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const cleaned = usable(value);
    if (cleaned.startsWith(prefix) && !out.includes(cleaned)) out.push(cleaned);
  };
  for (const line of envFile().split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    push(line.slice(eq + 1));
  }
  for (const value of Object.values(process.env)) push(value || "");
  return out;
}

function modelFor(provider: Exclude<ProviderName, "runway">): string {
  if (provider === "openrouter") return envValue("OPENROUTER_MODEL") || "openai/gpt-4o-mini";
  if (provider === "openai") return envValue("OPENAI_MODEL") || "gpt-4o-mini";
  if (provider === "gemini") return envValue("GEMINI_MODEL") || "gemini-flash-lite-latest";
  return envValue("MISTRAL_MODEL") || "mistral-small-latest";
}

function keyFor(provider: ProviderName): string {
  if (provider === "openrouter") return envValue("OPENROUTER_API_KEY") || keysLike("sk-or-")[0] || "";
  if (provider === "gemini") return envValue("GEMINI_API_KEY") || envValue("GOOGLE_API_KEY") || keysLike("AQ.")[0] || keysLike("AIza")[0] || "";
  if (provider === "mistral") return envValue("MISTRAL_API_KEY") || keysLike("mstrl_")[0] || "";
  if (provider === "openai") return envValue("OPENAI_API_KEY") || envValue("OPENAI_KEY") || keysLike("sk-proj-")[0] || "";
  return envValue("RUNWAY_API_KEY") || envValue("RUNWAYML_API_SECRET");
}

export function providerOrder(): Array<Exclude<ProviderName, "runway">> {
  const raw = envValue("AI_FALLBACK_ORDER") || "openrouter,gemini,mistral,openai";
  const allowed = new Set(["openrouter", "gemini", "mistral", "openai"]);
  const order = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is Exclude<ProviderName, "runway"> => allowed.has(item));
  return order.length ? order : ["openrouter", "gemini", "mistral", "openai"];
}

export function providerStatus(): Record<ProviderName, ProviderHealth> {
  const names: ProviderName[] = ["openrouter", "gemini", "mistral", "openai", "runway"];
  const out = {} as Record<ProviderName, ProviderHealth>;
  for (const name of names) {
    if (!keyFor(name)) out[name] = "not_configured";
    else out[name] = health.get(name) || "available";
  }
  return out;
}

let probedAt = 0;

/** Real provider check. Does not print keys. Cached for one minute. */
export async function refreshProviderStatus(): Promise<Record<ProviderName, ProviderHealth>> {
  if (Date.now() - probedAt < 60_000 && probedAt > 0) return providerStatus();
  probedAt = Date.now();
  await Promise.all([
    probeChat("openrouter", "https://openrouter.ai/api/v1/chat/completions", modelFor("openrouter")),
    probeChat("openai", "https://api.openai.com/v1/chat/completions", modelFor("openai")),
    probeChat("mistral", "https://api.mistral.ai/v1/chat/completions", modelFor("mistral")),
    probeGemini(),
  ]);
  if (!keyFor("runway")) note("runway", "not_configured");
  return providerStatus();
}

async function probeChat(
  provider: "openrouter" | "openai" | "mistral",
  url: string,
  model: string,
): Promise<void> {
  const key = keyFor(provider);
  if (!key) {
    note(provider, "not_configured");
    return;
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://nyx.app";
    headers["X-Title"] = "NYX";
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with pong." }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    if (res.ok) note(provider, "available");
    else note(provider, classify(res.status, body));
  } catch {
    note(provider, "temporarily_unavailable");
  }
}

async function probeGemini(): Promise<void> {
  const key = keyFor("gemini");
  if (!key) {
    note("gemini", "not_configured");
    return;
  }
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await res.text();
    if (res.ok) note("gemini", "available");
    else note("gemini", classify(res.status, body));
  } catch {
    note("gemini", "temporarily_unavailable");
  }
}

function note(provider: ProviderName, state: ProviderHealth): void {
  health.set(provider, state);
}

function classify(status: number, body: string): ProviderHealth {
  const s = body.toLowerCase();
  if (status === 401 || status === 403 || /invalid api key|incorrect api key|unauthorized/.test(s)) return "invalid_key";
  if (status === 429 || /rate limit|quota|resource_exhausted|insufficient_quota|credit/.test(s)) return "rate_limited";
  return "temporarily_unavailable";
}

function friendly(provider: string, state: ProviderHealth): string {
  if (state === "invalid_key") return `${provider} rejected the API key.`;
  if (state === "rate_limited") return `${provider} is rate-limited. Trying the next provider.`;
  if (state === "not_configured") return `${provider} is not configured.`;
  return `${provider} is temporarily unavailable. Trying the next provider.`;
}

function messages(turns: ChatTurn[], system: string) {
  return [
    { role: "system" as const, content: system },
    ...turns
      .map((turn) => ({ role: turn.role, content: turn.content.replace(/\s+/g, " ").trim().slice(0, 6_000) }))
      .filter((turn) => turn.content),
  ];
}

type Attempt = { text: string; tokensIn: number; tokensOut: number };

async function openAiCompatible(
  provider: "openrouter" | "openai" | "mistral",
  turns: ChatTurn[],
  stream: boolean,
  onDelta?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<Attempt> {
  const key = keyFor(provider);
  const model = modelFor(provider);
  const url =
    provider === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : provider === "mistral"
        ? "https://api.mistral.ai/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://nyx.app";
    headers["X-Title"] = "NYX";
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 1024,
      stream,
      messages: messages(turns, SYSTEM),
    }),
    signal: signal ?? AbortSignal.timeout(stream ? 25_000 : 20_000),
  });
  if (!res.ok) {
    const body = await res.text();
    const state = classify(res.status, body);
    note(provider, state);
    const error = new Error(friendly(provider, state));
    (error as Error & { retryable?: boolean }).retryable = state !== "invalid_key";
    throw error;
  }
  if (!stream) {
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) throw new Error(`${provider} returned an empty reply.`);
    note(provider, "available");
    return {
      text,
      tokensIn: payload.usage?.prompt_tokens || 0,
      tokensOut: payload.usage?.completion_tokens || 0,
    };
  }
  if (!res.body) throw new Error(`${provider} did not stream.`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = json.choices?.[0]?.delta?.content || "";
        if (delta) {
          text += delta;
          onDelta?.(delta);
        }
      } catch {
        /* ignore a partial keepalive */
      }
    }
  }
  text = text.trim();
  if (!text) throw new Error(`${provider} returned an empty stream.`);
  note(provider, "available");
  return { text, tokensIn: 0, tokensOut: 0 };
}

async function geminiCall(turns: ChatTurn[], stream: boolean, onDelta?: (chunk: string) => void): Promise<Attempt> {
  const ai = new GoogleGenAI({ apiKey: keyFor("gemini") });
  const contents = turns
    .map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content.replace(/\s+/g, " ").trim().slice(0, 6_000) }],
    }))
    .filter((turn) => turn.parts[0]?.text);
  if (!contents.length || contents[0]!.role !== "user") contents.unshift({ role: "user", parts: [{ text: "Hello" }] });
  const model = modelFor("gemini");
  try {
    if (!stream) {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: { systemInstruction: SYSTEM, maxOutputTokens: 1024, temperature: 0.7 },
      });
      const text = response.text?.trim() || "";
      if (!text) throw new Error("Gemini returned an empty reply.");
      note("gemini", "available");
      const usage = response.usageMetadata;
      return { text, tokensIn: usage?.promptTokenCount || 0, tokensOut: usage?.candidatesTokenCount || 0 };
    }
    const response = await ai.models.generateContentStream({
      model,
      contents,
      config: { systemInstruction: SYSTEM, maxOutputTokens: 1024, temperature: 0.7 },
    });
    let text = "";
    for await (const chunk of response) {
      const delta = chunk.text || "";
      if (!delta) continue;
      text += delta;
      onDelta?.(delta);
    }
    text = text.trim();
    if (!text) throw new Error("Gemini returned an empty stream.");
    note("gemini", "available");
    return { text, tokensIn: 0, tokensOut: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini request failed";
    if (!/empty/.test(message)) note("gemini", classify(0, message));
    throw new Error(friendly("Gemini", health.get("gemini") || "temporarily_unavailable"));
  }
}

export async function generateConversationResponse(
  history: ChatTurn[],
  userText: string,
  opts?: { onDelta?: (chunk: string) => void; signal?: AbortSignal },
): Promise<ChatResult> {
  const turns: ChatTurn[] = [
    ...history.filter((turn) => turn.content.trim()).slice(-8),
    { role: "user", content: userText.slice(0, 8_000) },
  ];
  const stream = Boolean(opts?.onDelta);
  let sawOutput = false;
  const failures: string[] = [];
  let configured = 0;
  const wrappedDelta = (chunk: string) => {
    sawOutput = true;
    opts?.onDelta?.(chunk);
  };
  for (const provider of providerOrder()) {
    if (!keyFor(provider)) {
      note(provider, "not_configured");
      continue;
    }
    configured += 1;
    try {
      const attempt =
        provider === "gemini"
          ? await geminiCall(turns, stream, stream ? wrappedDelta : undefined)
          : await openAiCompatible(provider, turns, stream, stream ? wrappedDelta : undefined, opts?.signal);
      return { text: attempt.text, provider, model: modelFor(provider), tokensIn: attempt.tokensIn, tokensOut: attempt.tokensOut };
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider} failed.`;
      if (!/not configured/i.test(message)) failures.push(message);
      if (sawOutput) break;
    }
  }
  if (!configured) throw new Error("No AI provider is configured.");
  throw new Error(failures[0] || "Every configured AI provider failed. Try again.");
}
