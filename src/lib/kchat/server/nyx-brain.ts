/** Server-only NYXAI chat. Rotates server-side keys. No secrets in responses. */

import { appendFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { answerUser } from "./reply.ts";
import {
  cooldownMs,
  coolKey,
  failureKind,
  loadKeyPool,
  noteKeyResult,
  relaxCooldowns,
  selectKey,
  type AiProvider,
  type KeySlot,
} from "./api-keys.ts";
import { analyzeRequest, reviewIsClean, reviewPrompt, synthesisPrompt, type Capability } from "./orchestrator.ts";

export type NyxDialogTurn = { role: "user" | "assistant"; content: string };

const FRIENDLY = "NYXAI could not answer. Tap Retry.";
const BUSY = "NYXAI is busy. Tap Retry.";

const CAPABILITY_MODELS: Record<AiProvider, Record<Capability, string[]>> = {
  gemini: {
    fast: ["gemini-flash-lite-latest"],
    code: ["gemini-flash-lite-latest"],
    reason: ["gemini-flash-lite-latest"],
    write: ["gemini-flash-lite-latest"],
    search: ["gemini-flash-lite-latest"],
  },
  openrouter: {
    fast: ["openai/gpt-4o-mini"],
    code: ["openai/gpt-4o-mini"],
    reason: ["openai/gpt-4o-mini"],
    write: ["openai/gpt-4o-mini"],
    search: ["openai/gpt-4o-mini"],
  },
  openai: {
    fast: ["gpt-4o-mini"],
    code: ["gpt-4o-mini"],
    reason: ["gpt-4o-mini"],
    write: ["gpt-4o-mini"],
    search: ["gpt-4o-mini"],
  },
};

const RANK: Record<Capability, AiProvider[]> = {
  fast: ["openrouter", "gemini"],
  code: ["openrouter", "gemini"],
  reason: ["gemini", "openrouter"],
  write: ["gemini", "openrouter"],
  search: ["openrouter", "gemini"],
};

const SYSTEM = [
  "You are NYXAI, the assistant inside the NYX app.",
  "Answer the latest user message directly.",
  "Be useful, specific, and concise.",
  "Never say you are paused, out of credits, rate-limited, or unavailable.",
  "Never mention API keys, billing, or which company built you.",
].join(" ");

let lastAttempts: string[] = [];
let fastTurn = 0;

export function lastKeyAttempts(): string[] {
  return [...lastAttempts];
}

function providerOrder(capability: Capability): AiProvider[] {
  const preferred = RANK[capability];
  if (capability !== "fast") return [...preferred, "openai"];
  const shift = fastTurn % preferred.length;
  fastTurn += 1;
  return [...preferred.slice(shift), ...preferred.slice(0, shift), "openai"];
}

function geminiContents(turns: NyxDialogTurn[]) {
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const turn of turns) {
    const text = turn.content.replace(/\s+/g, " ").trim().slice(0, 6_000);
    if (!text) continue;
    const role = turn.role === "assistant" ? "model" : "user";
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) prev.parts[0]!.text += `\n${text}`;
    else contents.push({ role, parts: [{ text }] });
  }
  if (!contents.length || contents[0]!.role !== "user") contents.unshift({ role: "user", parts: [{ text: "Hello" }] });
  if (contents[contents.length - 1]!.role !== "user") contents.push({ role: "user", parts: [{ text: "Continue." }] });
  return contents;
}

function openAiMessages(turns: NyxDialogTurn[], system: string) {
  return [
    { role: "system" as const, content: system },
    ...turns
      .map((turn) => ({ role: turn.role, content: turn.content.replace(/\s+/g, " ").trim().slice(0, 6_000) }))
      .filter((turn) => turn.content),
  ];
}

function noteFailure(code: string): void {
  try {
    appendFileSync("/tmp/nyx-ai-error.log", `${new Date().toISOString()} ${code}\n`);
  } catch {
    /* diagnostics must not break chat */
  }
}

type AttemptFail = { kind: ReturnType<typeof failureKind>; cooldownMs: number };

function asFail(status: number, body: string, retryAfterMs?: number): AttemptFail {
  const kind = failureKind(status, body);
  if (kind === "model" || kind === "fatal") return { kind, cooldownMs: kind === "fatal" ? cooldownMs("temporary") : 0 };
  if (kind === "auth") return { kind, cooldownMs: cooldownMs("auth") };
  if (kind === "rate") return { kind, cooldownMs: cooldownMs("rate", retryAfterMs) };
  return { kind, cooldownMs: cooldownMs("temporary") };
}

function messageText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choice = (payload as { choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown } }> }).choices?.[0];
  const content = choice?.message?.content ?? choice?.delta?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

async function openAiCompatible(slot: KeySlot, model: string, turns: NyxDialogTurn[], system: string): Promise<string> {
  const url = slot.provider === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${slot.secret}`,
    "Content-Type": "application/json",
  };
  if (slot.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://nyx.app";
    headers["X-Title"] = "NYX";
  }
  const body = {
    model,
    messages: openAiMessages(turns, system),
    temperature: 0.7,
    max_tokens: 1024,
  };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: false }),
    signal: AbortSignal.timeout(12_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    const retryAfter = Number(res.headers.get("retry-after"));
    throw Object.assign(new Error("provider"), asFail(res.status, raw.slice(0, 500), Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined));
  }
  try {
    const text = messageText(JSON.parse(raw));
    if (text) return text;
  } catch {
    /* not JSON */
  }
  throw Object.assign(new Error("empty"), asFail(502, "empty response"));
}

async function geminiOnce(slot: KeySlot, model: string, turns: NyxDialogTurn[], system: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: slot.secret });
  const response = await ai.models.generateContent({
    model,
    contents: geminiContents(turns),
    config: { systemInstruction: system, maxOutputTokens: 1024, temperature: 0.7 },
  });
  return response.text?.trim() || "";
}

async function callSlot(
  slot: KeySlot,
  turns: NyxDialogTurn[],
  models: string[],
  system: string,
  onDelta?: (chunk: string) => void,
): Promise<{ text: string; model: string }> {
  let last: AttemptFail = { kind: "temporary", cooldownMs: cooldownMs("temporary") };
  for (const model of models) {
    try {
      if (slot.provider === "gemini") {
        const text = await Promise.race([
          geminiOnce(slot, model, turns, system),
          new Promise<string>((_, reject) => {
            setTimeout(() => reject(Object.assign(new Error("timeout"), asFail(408, "timeout"))), 12_000);
          }),
        ]);
        if (!text) {
          last = asFail(502, "empty");
          continue;
        }
        onDelta?.(text);
        return { text, model };
      }
      const text = await openAiCompatible(slot, model, turns, system);
      if (text) onDelta?.(text);
      return { text, model };
    } catch (error) {
      const fail = error as AttemptFail;
      if (fail && typeof fail.kind === "string" && typeof fail.cooldownMs === "number") {
        last = fail;
        if (fail.kind === "model") continue;
        throw fail;
      }
      const message = error instanceof Error ? error.message : "";
      const timedOut = /timeout|aborted|timed out/i.test(message);
      last = asFail(timedOut ? 408 : /429|quota|resource_exhausted/i.test(message) ? 429 : /401|403|api key/i.test(message) ? 401 : 503, message);
      if (last.kind === "model") continue;
      throw last;
    }
  }
  throw last;
}

export async function completeForCapability(input: {
  capability: Capability;
  turns: NyxDialogTurn[];
  system?: string;
  avoidProviders?: AiProvider[];
  onDelta?: (chunk: string) => void;
}): Promise<{ text: string; model: string; provider: AiProvider; keyId: string }> {
  const system = input.system ?? SYSTEM;
  const excluded = new Set<string>();
  const pool = loadKeyPool();
  const order = providerOrder(input.capability).filter((provider) => !input.avoidProviders?.includes(provider));
  let sawRate = false;
  let revived = false;
  let code = pool.length ? "PROVIDER_UNAVAILABLE" : "MISSING_API_KEY";
  while (excluded.size < pool.length) {
    let slot: KeySlot | null = null;
    for (const provider of order) {
      slot = selectKey(excluded, { provider });
      if (slot) break;
    }
    if (!slot) slot = selectKey(excluded);
    if (!slot && !revived && relaxCooldowns()) {
      revived = true;
      excluded.clear();
      continue;
    }
    if (!slot) break;
    excluded.add(slot.id);
    lastAttempts.push(slot.id);
    try {
      const result = await callSlot(slot, input.turns, CAPABILITY_MODELS[slot.provider][input.capability], system, (chunk) => {
        input.onDelta?.(chunk);
      });
      noteKeyResult(slot.id, true);
      return { ...result, provider: slot.provider, keyId: slot.id };
    } catch (error) {
      const fail = error as AttemptFail;
      if (fail?.kind === "rate") {
        sawRate = true;
        code = "RATE_LIMIT";
      } else if (fail?.kind === "auth") code = "AUTHENTICATION_ERROR";
      else if (fail?.kind === "model") code = "INVALID_MODEL";
      else if (fail?.kind === "temporary") code = "TIMEOUT";
      else code = "PROVIDER_UNAVAILABLE";
      noteKeyResult(slot.id, false);
      if (fail?.kind === "auth") coolKey(slot.id, cooldownMs("auth"), Date.now(), true);
      else if (fail?.kind === "rate" || fail?.kind === "temporary") {
        coolKey(slot.id, fail.cooldownMs || cooldownMs("temporary"));
      }
    }
  }
  noteFailure(code);
  throw new Error(sawRate ? BUSY : FRIENDLY);
}

export async function nyxChat(input: {
  userText: string;
  history?: NyxDialogTurn[];
  onDelta?: (chunk: string) => void;
}): Promise<{ text: string; model: string }> {
  const spoken = await answerUser(input.userText, input.history ?? []);
  input.onDelta?.(spoken.text);
  lastAttempts = [spoken.model];
  return spoken;
}

async function runPlan(
  turns: NyxDialogTurn[],
  userText: string,
  onDelta?: (chunk: string) => void,
): Promise<{ text: string; model: string }> {
  const plan = analyzeRequest(userText);
  const single = plan.steps.length === 1;

  const draft = await completeForCapability({
    capability: plan.steps[0]!.capability,
    turns,
    onDelta: single ? onDelta : undefined,
  });
  if (single) return { text: draft.text, model: draft.model };

  const reviewStep = plan.steps.find((step) => step.role === "review");
  let review = "";
  if (reviewStep) {
    try {
      const reviewed = await completeForCapability({
        capability: reviewStep.capability,
        turns: [{ role: "user", content: reviewPrompt(draft.text) }],
        avoidProviders: reviewStep.differentProvider ? [draft.provider] : undefined,
      });
      review = reviewed.text;
      if (reviewIsClean(review)) {
        onDelta?.(draft.text);
        return { text: draft.text, model: draft.model };
      }
    } catch {
      onDelta?.(draft.text);
      return { text: draft.text, model: draft.model };
    }
  }

  try {
    const synthStep = plan.steps.find((step) => step.role === "synthesize");
    const final = await completeForCapability({
      capability: synthStep?.capability ?? "fast",
      turns: [{ role: "user", content: synthesisPrompt(draft.text, review || draft.text) }],
      avoidProviders: synthStep?.differentProvider ? [draft.provider] : undefined,
      onDelta,
    });
    return { text: final.text, model: final.model };
  } catch {
    onDelta?.(draft.text);
    return { text: draft.text, model: draft.model };
  }
}
