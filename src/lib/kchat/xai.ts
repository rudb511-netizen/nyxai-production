import { geminiChat, hasGeminiKey } from "./gemini.ts";

export type XaiCode = "no_key" | "credits" | "auth" | "invalid" | "rate" | "upstream" | "empty";

export type XaiResult =
  | { ok: true; text: string }
  | { ok: false; error: string; code: XaiCode };

export type ChatTurn = {
  role: "system" | "user" | "assistant";
  content: string | ChatPart[];
};

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type XaiCitation = { url: string; title: string };

export type XaiRichResult =
  | { ok: true; text: string; citations: XaiCitation[]; model: string; searched: boolean }
  | { ok: false; error: string; code: XaiCode; searched?: boolean };

export type OmniCallSpec = {
  model: string;
  fallbackModel?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
  search?: "off" | "auto" | "on";
  tools?: Array<{ type: string }>;
};

export type OmniModelHandlers = {
  onDelta?: (chunk: string) => void;
  onStatus?: (text: string) => void;
  onCitation?: (citations: XaiCitation[]) => void;
  signal?: AbortSignal;
};

const DEFAULT_MODEL = "grok-4.5";
const FALLBACK_MODEL = "grok-4.6";
const XAI_BASE = "https://api.x.ai/v1";
const MAX_ATTEMPTS = 3;

/** User-facing copy after the live model cannot complete a turn. Never a fake answer. */
export const NYXAI_UNAVAILABLE = "NYXAI is temporarily unavailable. Try again.";

function apiKey(): string | null {
  return process.env.XAI_API_KEY?.trim() || null;
}

export function hasXaiKey(): boolean {
  return Boolean(apiKey());
}

export function shouldCallLiveModel(): boolean {
  return hasXaiKey();
}

/** Once xAI reports a spending limit, later turns go straight to Gemini. This is not an in-app credit balance. */
let xaiBlocked = false;

export function noteLiveFailure(code?: XaiCode): void {
  if (code === "credits" || code === "auth") xaiBlocked = true;
}

export function resetLiveCircuit(): void {
  xaiBlocked = false;
}

export function isRetryableXaiCode(code: XaiCode): boolean {
  return code === "rate" || code === "upstream" || code === "empty";
}

export function nyxaiBackoffMs(attempt: number): number {
  return 400 * 2 ** Math.max(0, attempt);
}

export function redactXaiSecrets(text: string): string {
  return text
    .replace(/xai-[A-Za-z0-9_-]+/g, "xai-[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[redacted]");
}

export function logNyxaiFailure(info: {
  status?: number | null;
  provider?: string;
  model?: string | null;
  error?: string | null;
  requestId?: string | null;
  code?: string | null;
  hasKey: boolean;
}): void {
  const error = redactXaiSecrets(String(info.error ?? "unknown"));
  console.error(
    [
      "[NYXAI] Model request failed",
      `status: ${info.status ?? "n/a"}`,
      `provider: ${info.provider ?? "xai"}`,
      `model: ${info.model ?? "n/a"}`,
      `code: ${info.code ?? "n/a"}`,
      `error: ${error.slice(0, 400)}`,
      `requestId: ${info.requestId ?? "n/a"}`,
      `hasKey: ${info.hasKey}`,
    ].join("\n"),
  );
}

function timeoutMs(spec: OmniCallSpec): number {
  if (spec.search === "on") return 75_000;
  if (spec.tools?.some((t) => t.type === "web_search" || t.type === "x_search" || t.type === "code_interpreter")) {
    return 75_000;
  }
  return 60_000;
}

function mergedSignal(spec: OmniCallSpec, extra?: AbortSignal): AbortSignal {
  const parts: AbortSignal[] = [AbortSignal.timeout(timeoutMs(spec))];
  if (extra) parts.push(extra);
  return parts.length === 1 ? parts[0]! : AbortSignal.any(parts);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestIdFromBody(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { id?: string; request_id?: string };
    return parsed.id || parsed.request_id || null;
  } catch {
    return null;
  }
}

export async function completeChatRich(
  messages: ChatTurn[],
  spec: OmniCallSpec,
): Promise<XaiRichResult> {
  return runOmniModel(messages, spec);
}

export async function streamChatRich(
  messages: ChatTurn[],
  spec: OmniCallSpec,
  onDelta: (chunk: string) => void,
): Promise<XaiRichResult> {
  return runOmniModel(messages, spec, { onDelta });
}

export async function researchWithTools(
  messages: ChatTurn[],
  spec: OmniCallSpec,
): Promise<XaiRichResult> {
  return runOmniModel(messages, {
    ...spec,
    search: "on",
    tools: spec.tools?.length ? spec.tools : [{ type: "web_search" }, { type: "x_search" }],
  });
}

export async function runOmniModel(
  messages: ChatTurn[],
  spec: OmniCallSpec,
  handlers: OmniModelHandlers = {},
): Promise<XaiRichResult> {
  const searchOn = spec.search === "on" || spec.search === "auto";
  const tools = uniqueTools([
    ...(spec.tools ?? []),
    ...(searchOn ? [{ type: "web_search" }] : []),
  ]);
  const useSearch = tools.some((t) => t.type === "web_search" || t.type === "x_search");

  const key = apiKey();
  if (!key || xaiBlocked) {
    if (!key) {
      logNyxaiFailure({
        code: "no_key",
        error: "XAI_API_KEY is not set on the server",
        model: spec.model,
        hasKey: false,
      });
    }
    const gem = await geminiFallback(messages, spec, handlers, useSearch);
    if (gem?.ok) return gem;
    return { ok: false, code: key ? "credits" : "no_key", error: NYXAI_UNAVAILABLE };
  }

  if (useSearch) handlers.onStatus?.("Searching the web…");
  else handlers.onStatus?.("Generating response…");

  const models = [spec.model, spec.fallbackModel, DEFAULT_MODEL, FALLBACK_MODEL].filter(
    (m, i, a): m is string => Boolean(m) && a.indexOf(m) === i,
  );
  let last: XaiRichResult = { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };

  for (const model of models) {
    const nextSpec: OmniCallSpec = { ...spec, model, tools, search: useSearch ? "on" : "off" };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (handlers.signal?.aborted) {
        return { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };
      }
      last = handlers.onDelta
        ? await streamOnce(key, messages, nextSpec, handlers)
        : await completeOnceRich(key, messages, nextSpec, handlers);

      if (last.ok && last.text.trim()) return last;
      const fail: Extract<XaiRichResult, { ok: false }> = last.ok
        ? { ok: false, code: "empty", error: NYXAI_UNAVAILABLE, searched: last.searched }
        : last;

      if (fail.code === "credits" || fail.code === "auth" || fail.code === "no_key") {
        noteLiveFailure(fail.code);
        const gem = await geminiFallback(messages, spec, handlers, useSearch);
        if (gem?.ok) return gem;
        return { ok: false, code: fail.code, error: NYXAI_UNAVAILABLE, searched: fail.searched };
      }
      if (!isRetryableXaiCode(fail.code)) break;
      last = fail;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(nyxaiBackoffMs(attempt));
    }
  }
  if (!handlers.signal?.aborted) {
    const gem = await geminiFallback(messages, spec, handlers, useSearch);
    if (gem?.ok) return gem;
  }
  return last.ok
    ? { ok: false, code: "empty", error: NYXAI_UNAVAILABLE }
    : { ok: false, code: last.code, error: NYXAI_UNAVAILABLE, searched: last.searched };
}

/** xAI is out of credits or missing. Gemini is the live fallback — never a canned reply. */
async function geminiFallback(
  messages: ChatTurn[],
  spec: OmniCallSpec,
  handlers: OmniModelHandlers,
  useSearch: boolean,
): Promise<XaiRichResult | null> {
  if (handlers.signal?.aborted || !hasGeminiKey()) return null;
  handlers.onStatus?.(useSearch ? "Searching the web…" : "Generating response…");
  const result = await geminiChat({
    messages,
    maxTokens: spec.maxTokens,
    temperature: spec.temperature,
    search: useSearch,
    onDelta: handlers.onDelta,
    signal: handlers.signal,
  });
  if (!result.ok) {
    if (result.error === "aborted") return { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };
    logNyxaiFailure({
      provider: "gemini",
      code: "upstream",
      error: result.error,
      model: "gemini-flash-latest",
      hasKey: true,
    });
    return null;
  }
  if (result.citations.length) handlers.onCitation?.(result.citations);
  return {
    ok: true,
    text: result.text,
    citations: result.citations,
    model: result.model,
    searched: result.searched,
  };
}

function uniqueTools(tools: Array<{ type: string }>): Array<{ type: string }> {
  const seen = new Set<string>();
  const out: Array<{ type: string }> = [];
  for (const t of tools) {
    if (!t.type || seen.has(t.type)) continue;
    seen.add(t.type);
    out.push({ type: t.type });
  }
  return out;
}

async function completeOnceRich(
  key: string,
  messages: ChatTurn[],
  spec: OmniCallSpec,
  handlers: OmniModelHandlers,
): Promise<XaiRichResult> {
  const hasTools = Boolean(spec.tools?.length);
  if (hasTools) {
    const viaResponses = await completeResponses(key, messages, spec, handlers);
    if (viaResponses.ok) return viaResponses;
    if (viaResponses.code === "credits" || viaResponses.code === "auth") return viaResponses;
  }
  return completeChatCompletions(key, messages, spec, handlers);
}

async function streamOnce(
  key: string,
  messages: ChatTurn[],
  spec: OmniCallSpec,
  handlers: OmniModelHandlers,
): Promise<XaiRichResult> {
  const hasTools = Boolean(spec.tools?.length);
  if (hasTools) {
    const viaResponses = await streamResponses(key, messages, spec, handlers);
    if (viaResponses.ok) return viaResponses;
    if (viaResponses.code === "credits" || viaResponses.code === "auth") return viaResponses;
  }
  return streamChatCompletions(key, messages, spec, handlers);
}

function systemAndInput(messages: ChatTurn[]): { instructions: string; input: unknown[] } {
  const instructions = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : textOf(m.content)))
    .join("\n\n");
  const input = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        content: m.content.map((p) =>
          p.type === "text"
            ? { type: "input_text", text: p.text }
            : { type: "input_image", image_url: p.image_url.url },
        ),
      };
    });
  return { instructions, input };
}

function textOf(parts: ChatPart[]): string {
  return parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

function responsesBody(messages: ChatTurn[], spec: OmniCallSpec, stream: boolean): Record<string, unknown> {
  const { instructions, input } = systemAndInput(messages);
  const body: Record<string, unknown> = {
    model: spec.model,
    input: input.length ? input : [{ role: "user", content: "Hello" }],
    temperature: spec.temperature ?? 0.8,
    max_output_tokens: spec.maxTokens ?? 1600,
    stream,
  };
  if (instructions.trim()) body.instructions = instructions;
  if (spec.tools?.length) {
    body.tools = spec.tools;
    body.tool_choice = "auto";
  }
  if (spec.reasoningEffort) {
    body.reasoning = { effort: spec.reasoningEffort };
  }
  return body;
}

async function completeResponses(
  key: string,
  messages: ChatTurn[],
  spec: OmniCallSpec,
  handlers: OmniModelHandlers,
): Promise<XaiRichResult> {
  const bodies = [
    responsesBody(messages, spec, false),
    (() => {
      const b = responsesBody(messages, spec, false);
      delete b.reasoning;
      return b;
    })(),
    (() => {
      const b = responsesBody(messages, spec, false);
      delete b.reasoning;
      if (Array.isArray(b.tools)) {
        b.tools = (b.tools as Array<{ type: string }>).filter((t) => t.type === "web_search");
        if (!(b.tools as unknown[]).length) delete b.tools;
      }
      return b;
    })(),
  ];
  let last: XaiRichResult = { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };
  for (const body of bodies) {
    last = await postResponses(key, body, spec, handlers);
    if (last.ok) return last;
    if (last.code === "credits" || last.code === "auth" || last.code === "rate") return last;
  }
  return last;
}

async function postResponses(
  key: string,
  body: Record<string, unknown>,
  spec: OmniCallSpec,
  handlers: OmniModelHandlers,
): Promise<XaiRichResult> {
  let res: Response;
  try {
    res = await fetch(`${XAI_BASE}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: mergedSignal(spec, handlers.signal),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return abortError(err, handlers.signal);
  }
  const raw = await res.text();
  const requestId = res.headers.get("x-request-id") || requestIdFromBody(raw);
  if (!res.ok) {
    const mapped = mapXaiHttpError(res.status, raw);
    logNyxaiFailure({
      status: res.status,
      model: spec.model,
      error: mapped.ok ? mapped.text : mapped.error,
      code: mapped.ok ? "upstream" : mapped.code,
      requestId,
      hasKey: true,
    });
    return { ok: false, code: mapped.ok ? "upstream" : mapped.code, error: NYXAI_UNAVAILABLE };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logNyxaiFailure({
      status: res.status,
      model: spec.model,
      error: "Unreadable JSON from /responses",
      code: "upstream",
      requestId,
      hasKey: true,
    });
    return { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };
  }
  const text = extractXaiText(parsed);
  const citations = extractXaiCitations(parsed);
  if (citations.length) handlers.onCitation?.(citations);
  if (!text) {
    logNyxaiFailure({
      status: res.status,
      model: spec.model,
      error: "Empty /responses body",
      code: "empty",
      requestId,
      hasKey: true,
    });
    return { ok: false, code: "empty", error: NYXAI_UNAVAILABLE, searched: Boolean(spec.tools?.length) };
  }
  return { ok: true, text, citations, model: spec.model, searched: citations.length > 0 || spec.search === "on" };
}

async function streamResponses(
  key: string,
  messages: ChatTurn[],
  spec: OmniCallSpec,
  handlers: OmniModelHandlers,
): Promise<XaiRichResult> {
  const body = responsesBody(messages, spec, true);
  let res: Response;
  try {
    res = await fetch(`${XAI_BASE}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: mergedSignal(spec, handlers.signal),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return abortError(err, handlers.signal);
  }
  if (!res.ok) {
    const raw = await res.text();
    const mapped = mapXaiHttpError(res.status, raw);
    logNyxaiFailure({
      status: res.status,
      model: spec.model,
      error: mapped.ok ? mapped.text : mapped.error,
      code: mapped.ok ? "upstream" : mapped.code,
      requestId: res.headers.get("x-request-id") || requestIdFromBody(raw),
      hasKey: true,
    });
    if (!mapped.ok && (mapped.code === "credits" || mapped.code === "auth" || mapped.code === "rate")) {
      return { ok: false, code: mapped.code, error: NYXAI_UNAVAILABLE };
    }
    const stripped = { ...body };
    delete stripped.reasoning;
    delete stripped.stream;
    return postResponses(key, stripped, spec, handlers);
  }
  if (!res.body) {
    return completeResponses(key, messages, spec, handlers);
  }
  const streamed = await readSse(res.body, handlers, spec.model);
  if (streamed.ok && streamed.text.trim()) return streamed;
  if (streamed.ok === false && (streamed.code === "credits" || streamed.code === "auth")) return streamed;
  return completeResponses(key, messages, spec, handlers);
}

function chatCompletionsBody(messages: ChatTurn[], spec: OmniCallSpec, stream: boolean, withReasoning: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: spec.model,
    max_tokens: spec.maxTokens ?? 1600,
    temperature: spec.temperature ?? 0.8,
    stream,
    messages,
  };
  if (withReasoning && spec.reasoningEffort) body.reasoning_effort = spec.reasoningEffort;
  if (spec.tools?.length) body.tools = spec.tools;
  return body;
}

async function completeChatCompletions(
  key: string,
  messages: ChatTurn[],
  spec: OmniCallSpec,
  handlers: OmniModelHandlers,
): Promise<XaiRichResult> {
  const bodies = [chatCompletionsBody(messages, spec, false, true), chatCompletionsBody(messages, spec, false, false)];
  let last: XaiRichResult = { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };
  for (const body of bodies) {
    last = await postChatCompletions(key, body, spec, handlers);
    if (last.ok) return last;
    if (last.code === "credits" || last.code === "auth" || last.code === "rate") return last;
  }
  return last;
}

async function postChatCompletions(
  key: string,
  body: Record<string, unknown>,
  spec: OmniCallSpec,
  handlers: OmniModelHandlers,
): Promise<XaiRichResult> {
  let res: Response;
  try {
    res = await fetch(`${XAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: mergedSignal(spec, handlers.signal),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return abortError(err, handlers.signal);
  }
  const raw = await res.text();
  const requestId = res.headers.get("x-request-id") || requestIdFromBody(raw);
  if (!res.ok) {
    const mapped = mapXaiHttpError(res.status, raw);
    logNyxaiFailure({
      status: res.status,
      model: spec.model,
      error: mapped.ok ? mapped.text : mapped.error,
      code: mapped.ok ? "upstream" : mapped.code,
      requestId,
      hasKey: true,
    });
    return { ok: false, code: mapped.ok ? "upstream" : mapped.code, error: NYXAI_UNAVAILABLE };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logNyxaiFailure({
      status: res.status,
      model: spec.model,
      error: "Unreadable JSON from /chat/completions",
      code: "upstream",
      requestId,
      hasKey: true,
    });
    return { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };
  }
  const text = extractXaiText(parsed);
  const citations = extractXaiCitations(parsed);
  if (citations.length) handlers.onCitation?.(citations);
  if (!text) {
    logNyxaiFailure({
      status: res.status,
      model: spec.model,
      error: "Empty /chat/completions body",
      code: "empty",
      requestId,
      hasKey: true,
    });
    return { ok: false, code: "empty", error: NYXAI_UNAVAILABLE };
  }
  return { ok: true, text, citations, model: spec.model, searched: citations.length > 0 };
}

async function streamChatCompletions(
  key: string,
  messages: ChatTurn[],
  spec: OmniCallSpec,
  handlers: OmniModelHandlers,
): Promise<XaiRichResult> {
  const body = chatCompletionsBody(messages, spec, true, true);
  let res: Response;
  try {
    res = await fetch(`${XAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: mergedSignal(spec, handlers.signal),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return abortError(err, handlers.signal);
  }
  if (!res.ok) {
    const raw = await res.text();
    const mapped = mapXaiHttpError(res.status, raw);
    logNyxaiFailure({
      status: res.status,
      model: spec.model,
      error: mapped.ok ? mapped.text : mapped.error,
      code: mapped.ok ? "upstream" : mapped.code,
      requestId: res.headers.get("x-request-id") || requestIdFromBody(raw),
      hasKey: true,
    });
    if (!mapped.ok && (mapped.code === "credits" || mapped.code === "auth")) {
      return { ok: false, code: mapped.code, error: NYXAI_UNAVAILABLE };
    }
    return completeChatCompletions(key, messages, spec, handlers);
  }
  if (!res.body) return completeChatCompletions(key, messages, spec, handlers);
  const streamed = await readSse(res.body, handlers, spec.model);
  if (streamed.ok && streamed.text.trim()) return streamed;
  return completeChatCompletions(key, messages, spec, handlers);
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  handlers: OmniModelHandlers,
  model: string,
): Promise<XaiRichResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let text = "";
  const cites: XaiCitation[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const parts = carry.split("\n");
    carry = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as Record<string, unknown>;
        const piece = sseDelta(json);
        if (piece) {
          text += piece;
          handlers.onDelta?.(piece);
        }
        const found = extractXaiCitations(json);
        if (found.length) {
          for (const c of found) cites.push(c);
          handlers.onCitation?.(uniqueCitations(cites));
        }
      } catch {
        /* skip malformed */
      }
    }
  }
  if (!text.trim()) {
    return { ok: false, code: "empty", error: NYXAI_UNAVAILABLE };
  }
  return { ok: true, text, citations: uniqueCitations(cites), model, searched: cites.length > 0 };
}

function sseDelta(json: Record<string, unknown>): string {
  const type = typeof json.type === "string" ? json.type : "";
  if (type === "response.output_text.delta" || type === "response.refusal.delta") {
    return typeof json.delta === "string" ? json.delta : "";
  }
  const choices = json.choices as { delta?: { content?: string | Array<{ text?: string }> } }[] | undefined;
  const delta = choices?.[0]?.delta?.content;
  if (typeof delta === "string") return delta;
  if (Array.isArray(delta)) return delta.map((p) => p.text ?? "").join("");
  if (typeof json.delta === "string") return json.delta;
  return "";
}

function abortError(err: unknown, signal?: AbortSignal): XaiRichResult {
  if (signal?.aborted) {
    return { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };
  }
  const timed = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
  logNyxaiFailure({
    status: 0,
    model: null,
    error: err instanceof Error ? `${err.name}: ${err.message}` : "network error",
    code: "upstream",
    hasKey: true,
  });
  return {
    ok: false,
    code: "upstream",
    error: timed ? NYXAI_UNAVAILABLE : NYXAI_UNAVAILABLE,
  };
}

export function extractXaiCitations(body: unknown): XaiCitation[] {
  if (!body || typeof body !== "object") return [];
  const b = body as {
    citations?: unknown;
    response?: { citations?: unknown };
    choices?: { message?: { citations?: unknown; annotations?: unknown } }[];
    output?: Array<{
      type?: string;
      content?: Array<{ text?: string; annotations?: unknown; type?: string }>;
    }>;
  };
  const bags: unknown[] = [];
  if (b.citations) bags.push(b.citations);
  if (b.response?.citations) bags.push(b.response.citations);
  if (b.choices?.[0]?.message?.citations) bags.push(b.choices[0].message.citations);
  if (b.choices?.[0]?.message?.annotations) bags.push(b.choices[0].message.annotations);
  if (b.output) {
    for (const item of b.output) {
      for (const part of item.content ?? []) {
        if (part.annotations) bags.push(part.annotations);
      }
    }
  }
  const out: XaiCitation[] = [];
  for (const bag of bags) {
    if (!Array.isArray(bag)) continue;
    for (const c of bag) {
      const parsed = citationFromUnknown(c);
      if (parsed) out.push(parsed);
    }
  }
  return uniqueCitations(out);
}

function citationFromUnknown(c: unknown): XaiCitation | null {
  if (typeof c === "string" && /^https?:\/\//.test(c)) {
    return { url: c, title: hostname(c) };
  }
  if (!c || typeof c !== "object") return null;
  const o = c as {
    url?: string;
    title?: string;
    uri?: string;
    type?: string;
    url_citation?: { url?: string; title?: string };
  };
  const url = o.url || o.uri || o.url_citation?.url || "";
  if (!url.startsWith("http")) return null;
  const title = o.title || o.url_citation?.title || hostname(url);
  return { url, title };
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

function uniqueCitations(list: XaiCitation[]): XaiCitation[] {
  const seen = new Set<string>();
  const out: XaiCitation[] = [];
  for (const c of list) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
    if (out.length >= 12) break;
  }
  return out;
}

export async function generateXaiImage(
  prompt: string,
  aspect = "1:1",
  style?: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string; code: XaiCode }> {
  const key = apiKey();
  if (!key) {
    logNyxaiFailure({ code: "no_key", error: "XAI_API_KEY is not set", model: "grok-imagine-image", hasKey: false });
    return { ok: false, code: "no_key", error: NYXAI_UNAVAILABLE };
  }
  const styled = applyImageStyle(prompt, style);
  const result = await imagineImage(key, {
    model: "grok-imagine-image",
    prompt: styled.slice(0, 2000),
    n: 1,
    resolution: "1k",
    aspect_ratio: aspect,
  });
  if (!result.ok) {
    logNyxaiFailure({ code: result.code, error: result.error, model: "grok-imagine-image", hasKey: true });
  }
  return result.ok ? result : { ok: false, code: result.code, error: NYXAI_UNAVAILABLE };
}

export async function editXaiImage(
  prompt: string,
  imageUrls: string[],
  aspect = "1:1",
): Promise<{ ok: true; url: string } | { ok: false; error: string; code: XaiCode }> {
  const key = apiKey();
  if (!key) return { ok: false, code: "no_key", error: NYXAI_UNAVAILABLE };
  const refs = imageUrls.filter(Boolean).slice(0, 3);
  if (!refs.length) return generateXaiImage(prompt, aspect);
  let res: Response;
  try {
    res = await fetch(`${XAI_BASE}/images/edits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(22_000),
      body: JSON.stringify({
        model: "grok-imagine-image",
        prompt: prompt.slice(0, 2000),
        image: refs[0],
        images: refs,
        n: 1,
        resolution: "1k",
        aspect_ratio: aspect,
      }),
    });
  } catch {
    return { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };
  }
  const parsed = await readImagineResponse(res);
  if (parsed.ok) return parsed;
  return generateXaiImage(`Edit this image: ${prompt}`, aspect);
}

function applyImageStyle(prompt: string, style?: string): string {
  const hints: Record<string, string> = {
    photo: "photorealistic photography, natural light, no watermark",
    illustration: "editorial illustration, clean shapes, rich color",
    logo: "simple vector logo, flat, centered, no extra text unless asked",
    poster: "poster composition, bold, cinematic lighting, space for type",
    product: "studio product photography, softbox lighting, clean background",
  };
  const hint = style ? hints[style] : undefined;
  return hint ? `${prompt}. Visual style: ${hint}.` : prompt;
}

async function imagineImage(
  key: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; url: string } | { ok: false; error: string; code: XaiCode }> {
  let res: Response;
  try {
    res = await fetch(`${XAI_BASE}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(22_000),
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };
  }
  return readImagineResponse(res);
}

async function readImagineResponse(
  res: Response,
): Promise<{ ok: true; url: string } | { ok: false; error: string; code: XaiCode }> {
  const raw = await res.text();
  if (!res.ok) {
    const mapped = mapXaiHttpError(res.status, raw);
    logNyxaiFailure({
      status: res.status,
      model: "grok-imagine-image",
      error: mapped.ok ? mapped.text : mapped.error,
      code: mapped.ok ? "upstream" : mapped.code,
      requestId: res.headers.get("x-request-id") || requestIdFromBody(raw),
      hasKey: true,
    });
    return { ok: false, code: mapped.ok ? "upstream" : mapped.code, error: NYXAI_UNAVAILABLE };
  }
  try {
    const parsed = JSON.parse(raw) as { data?: { url?: string; b64_json?: string }[] };
    const url = parsed.data?.[0]?.url;
    if (url) return { ok: true, url };
    const b64 = parsed.data?.[0]?.b64_json;
    if (b64) return { ok: true, url: `data:image/png;base64,${b64}` };
  } catch {
    /* fall through */
  }
  return { ok: false, code: "empty", error: NYXAI_UNAVAILABLE };
}

export async function speakXai(
  text: string,
  voiceId = "eve",
): Promise<{ ok: true; bytes: ArrayBuffer; contentType: string } | { ok: false; error: string; code: XaiCode }> {
  const key = apiKey();
  if (!key) return { ok: false, code: "no_key", error: NYXAI_UNAVAILABLE };
  let res: Response;
  try {
    res = await fetch(`${XAI_BASE}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(40_000),
      body: JSON.stringify({ text: text.slice(0, 1800), voice_id: voiceId }),
    });
  } catch {
    return { ok: false, code: "upstream", error: NYXAI_UNAVAILABLE };
  }
  if (!res.ok) {
    const raw = await res.text();
    const mapped = mapXaiHttpError(res.status, raw);
    return { ok: false, code: mapped.ok ? "upstream" : mapped.code, error: NYXAI_UNAVAILABLE };
  }
  return {
    ok: true,
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") || "audio/mpeg",
  };
}

type XaiErrorBody = { code?: string; error?: string; error_code?: string };

export function mapXaiHttpError(status: number, raw: string): XaiResult {
  let parsed: XaiErrorBody = {};
  try {
    parsed = JSON.parse(raw) as XaiErrorBody;
  } catch {
    /* plain text */
  }
  const code = `${parsed.code ?? parsed.error_code ?? ""}`.toLowerCase();
  const detail = (parsed.error ?? raw ?? "").toLowerCase();
  const spending =
    code.includes("spending") ||
    code.includes("credit") ||
    detail.includes("run out of credits") ||
    detail.includes("spending-limit") ||
    detail.includes("subscription");

  if (status === 401 || code.includes("unauthorized") || detail.includes("incorrect api key")) {
    return {
      ok: false,
      code: "auth",
      error: "Invalid API key or unauthorized request",
    };
  }
  if (spending) {
    return {
      ok: false,
      code: "credits",
      error: "xAI spending limit or credits exhausted",
    };
  }
  if (
    status === 400 ||
    status === 404 ||
    status === 422 ||
    code.includes("invalid") ||
    detail.includes("invalid model") ||
    detail.includes("malformed")
  ) {
    return {
      ok: false,
      code: "invalid",
      error: `Invalid request (${status}) ${redactXaiSecrets((parsed.error ?? raw ?? "").slice(0, 180))}`,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      code: "rate",
      error: "Rate limited (429)",
    };
  }
  return {
    ok: false,
    code: "upstream",
    error: `Upstream error (${status}) ${redactXaiSecrets((parsed.error ?? raw ?? "").slice(0, 180))}`,
  };
}

export function extractXaiText(body: unknown): string {
  const b = body as {
    choices?: {
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
        refusal?: string;
      };
    }[];
    output_text?: string;
    response?: { output_text?: string };
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };
  if (typeof b.output_text === "string" && b.output_text.trim()) return b.output_text.trim();
  if (typeof b.response?.output_text === "string" && b.response.output_text.trim()) {
    return b.response.output_text.trim();
  }
  if (Array.isArray(b.output)) {
    const joined = b.output
      .flatMap((o) => o.content ?? [])
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    if (joined) return joined;
  }
  const msg = b.choices?.[0]?.message;
  const c = msg?.content;
  if (typeof c === "string" && c.trim()) return c.trim();
  if (Array.isArray(c)) {
    const joined = c
      .map((p) => (typeof p === "string" ? p : p.text ?? ""))
      .join("")
      .trim();
    if (joined) return joined;
  }
  if (typeof msg?.refusal === "string" && msg.refusal.trim()) return msg.refusal.trim();
  return "";
}

export async function completeChat(messages: ChatTurn[], maxTokens = 900): Promise<XaiResult> {
  const rich = await completeChatRich(messages, {
    model: DEFAULT_MODEL,
    fallbackModel: FALLBACK_MODEL,
    maxTokens,
    temperature: 0.9,
    reasoningEffort: "low",
    search: "off",
  });
  if (rich.ok) return { ok: true, text: rich.text };
  return { ok: false, code: rich.code, error: rich.error };
}
