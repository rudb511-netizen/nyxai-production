/** Server-only Gemini client. Never import this from browser code. */

import { GoogleGenAI, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODELS = ["gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-flash-latest", "gemini-3.5-flash"] as const;

function loadGeminiEnv(): void {
  if (process.env.NYX_SKIP_ENV_FILE === "1") return;
  if (process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()) return;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  loadDotenv({ path: resolve(root, ".env"), quiet: true });
  loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });
}

export function geminiApiKey(): string | null {
  loadGeminiEnv();
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}

export function hasGeminiKey(): boolean {
  return Boolean(geminiApiKey());
}

export function geminiClient(): GoogleGenAI {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the server");
  return new GoogleGenAI({ apiKey });
}

function redact(text: string): string {
  const key = geminiApiKey();
  return key ? text.split(key).join("[redacted]") : text;
}

type GeminiPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type GeminiTurn = {
  role: "system" | "user" | "assistant";
  content: string | GeminiPart[];
};

export type GeminiCitation = { url: string; title: string };

export type GeminiChatResult =
  | { ok: true; text: string; model: string; citations: GeminiCitation[]; searched: boolean }
  | { ok: false; error: string };

/** One short completion. Tries the current flash alias, then the model Google names in errors. */
export async function geminiReply(prompt: string): Promise<{ ok: true; text: string; model: string } | { ok: false; error: string }> {
  const chat = await geminiChat({ messages: [{ role: "user", content: prompt }] });
  if (!chat.ok) return chat;
  return { ok: true, text: chat.text, model: chat.model };
}

/**
 * Multi-turn chat. Used when xAI has no key or is out of credits.
 * Search uses Gemini's official Google Search tool — never a scraped page.
 */
export async function geminiChat(opts: {
  messages: GeminiTurn[];
  maxTokens?: number;
  temperature?: number;
  search?: boolean;
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
}): Promise<GeminiChatResult> {
  const messages = opts.messages.filter((m) => textOfTurn(m).trim() || hasImage(m));
  if (!messages.length) return { ok: false, error: "Prompt is empty" };
  let client: GoogleGenAI;
  try {
    client = geminiClient();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "GEMINI_API_KEY is not set on the server" };
  }

  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => textOfTurn(m))
    .filter(Boolean)
    .join("\n\n");
  const contents = toContents(messages);
  let last = "Gemini did not respond";
  const maxOutputTokens = Math.max(512, opts.maxTokens ?? 1600);
  const attempts: boolean[] = opts.search ? [true, false] : [false];

  for (const model of MODELS) {
    for (const search of attempts) {
      try {
        let result = await generateOnce(client, model, contents, {
          system,
          search,
          temperature: opts.temperature ?? 0.8,
          maxOutputTokens,
          signal: opts.signal,
          stream: Boolean(opts.onDelta),
          onDelta: opts.onDelta,
        });
        if (!result.text && !result.emitted && opts.onDelta && !opts.signal?.aborted) {
          result = await generateOnce(client, model, contents, {
            system,
            search,
            temperature: opts.temperature ?? 0.8,
            maxOutputTokens,
            signal: opts.signal,
            stream: false,
          });
          if (result.text) opts.onDelta(result.text);
        }
        if (opts.signal?.aborted) return { ok: false, error: "aborted" };
        if (!result.text) {
          last = "Gemini returned an empty response";
          continue;
        }
        return {
          ok: true,
          text: result.text,
          model,
          citations: result.citations,
          searched: search && result.citations.length > 0,
        };
      } catch (error) {
        last = redact(error instanceof Error ? error.message : "Gemini request failed").slice(0, 300);
        if (opts.signal?.aborted) return { ok: false, error: "aborted" };
        // A 429 on one model is not a user credit block. Try the next model immediately.
        if (isRateLimit(last)) continue;
      }
    }
  }
  return { ok: false, error: last };
}

type GenOpts = {
  system: string;
  search: boolean;
  temperature: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
  stream: boolean;
  onDelta?: (chunk: string) => void;
};

async function generateOnce(
  client: GoogleGenAI,
  model: string,
  contents: Content[],
  opts: GenOpts,
): Promise<{ text: string; citations: GeminiCitation[]; emitted: boolean }> {
  const config: {
    temperature: number;
    maxOutputTokens: number;
    abortSignal?: AbortSignal;
    systemInstruction?: string;
    tools?: Array<{ googleSearch: Record<string, never> }>;
  } = {
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    abortSignal: opts.signal,
  };
  if (opts.system) config.systemInstruction = opts.system;
  if (opts.search) config.tools = [{ googleSearch: {} }];

  if (!opts.stream) {
    const response = await client.models.generateContent({ model, contents, config });
    return { text: response.text?.trim() || "", citations: citationsOf(response), emitted: false };
  }

  const stream = await client.models.generateContentStream({ model, contents, config });
  let text = "";
  let lastChunk: GenerateContentResponse | null = null;
  for await (const chunk of stream) {
    if (opts.signal?.aborted) break;
    lastChunk = chunk;
    const piece = chunk.text ?? "";
    if (!piece) continue;
    text += piece;
    opts.onDelta?.(piece);
  }
  return { text: text.trim(), citations: citationsOf(lastChunk), emitted: text.trim().length > 0 };
}

function isRateLimit(message: string): boolean {
  return /429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOfTurn(turn: GeminiTurn): string {
  if (typeof turn.content === "string") return turn.content;
  return turn.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

function hasImage(turn: GeminiTurn): boolean {
  return typeof turn.content !== "string" && turn.content.some((p) => p.type === "image_url");
}

function toContents(messages: GeminiTurn[]): Content[] {
  const contents: Content[] = [];
  for (const turn of messages) {
    if (turn.role === "system") continue;
    const role = turn.role === "assistant" ? "model" : "user";
    const parts = partsOf(turn);
    if (!parts.length) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts = [...(last.parts ?? []), ...parts];
    else contents.push({ role, parts });
  }
  if (contents[0]?.role === "model") {
    contents.unshift({ role: "user", parts: [{ text: "Continue the conversation." }] });
  }
  if (!contents.length) contents.push({ role: "user", parts: [{ text: "Hello" }] });
  return contents;
}

function partsOf(turn: GeminiTurn): Part[] {
  if (typeof turn.content === "string") {
    const text = turn.content.trim();
    return text ? [{ text }] : [];
  }
  const parts: Part[] = [];
  for (const part of turn.content) {
    if (part.type === "text") {
      if (part.text.trim()) parts.push({ text: part.text });
      continue;
    }
    const image = inlineImage(part.image_url.url);
    if (image) parts.push(image);
  }
  return parts;
}

function inlineImage(url: string): Part | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!match) return null;
  return { inlineData: { mimeType: match[1], data: match[2].replace(/\s/g, "") } };
}

function citationsOf(response: GenerateContentResponse | null): GeminiCitation[] {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const out: GeminiCitation[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const url = chunk.web?.uri || chunk.retrievedContext?.uri || chunk.maps?.uri || "";
    if (!url.startsWith("http") || seen.has(url)) continue;
    seen.add(url);
    const title = chunk.web?.title || chunk.retrievedContext?.title || chunk.maps?.title || hostname(url);
    out.push({ url, title });
    if (out.length >= 12) break;
  }
  return out;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

function listEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.split(",").map((s) => s.trim()).filter(Boolean);
  return raw?.length ? raw : fallback;
}

const IMAGE_MODELS_DEFAULT = ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-2.5-flash-image"];
const VIDEO_MODELS_DEFAULT = ["veo-3.1-fast-generate-preview", "veo-3.1-lite-generate-preview"];

export async function geminiGenerateImage(opts: {
  prompt: string;
  aspect?: string;
  references?: string[];
}): Promise<{ ok: true; url: string; model: string } | { ok: false; error: string }> {
  let client: GoogleGenAI;
  try {
    client = geminiClient();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "GEMINI_API_KEY is not set on the server" };
  }
  const aspect = opts.aspect && opts.aspect !== "1:1" ? ` Aspect ratio ${opts.aspect}.` : "";
  const prompt = `${opts.prompt.trim()}.${aspect}`.slice(0, 2000);
  const parts: Part[] = [];
  for (const url of opts.references ?? []) {
    const image = inlineImage(url);
    if (image) parts.push(image);
  }
  parts.push({ text: prompt });
  let last = "Gemini image model did not return an image";
  for (const model of listEnv("NYX_AI_IMAGE_MODELS", IMAGE_MODELS_DEFAULT)) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { responseModalities: ["TEXT", "IMAGE"] },
      });
      const inline = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) {
        last = "Gemini returned no image bytes";
        continue;
      }
      const mime = inline.mimeType || "image/png";
      return { ok: true, url: `data:${mime};base64,${inline.data}`, model };
    } catch (error) {
      last = redact(error instanceof Error ? error.message : "Gemini image request failed").slice(0, 500);
    }
  }
  return { ok: false, error: last };
}

export async function geminiGenerateVideo(opts: {
  prompt: string;
  aspect?: string;
  onStatus?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<{ ok: true; url: string; model: string } | { ok: false; error: string }> {
  let client: GoogleGenAI;
  try {
    client = geminiClient();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "GEMINI_API_KEY is not set on the server" };
  }
  const aspect = opts.aspect === "9:16" ? "9:16" : "16:9";
  let last = "Veo did not return a video";
  for (const model of listEnv("NYX_AI_VIDEO_MODELS", VIDEO_MODELS_DEFAULT)) {
    try {
      opts.onStatus?.("Starting video generation…");
      let operation = await client.models.generateVideos({
        model,
        source: { prompt: opts.prompt.trim().slice(0, 2000) },
        config: { numberOfVideos: 1, aspectRatio: aspect, durationSeconds: 4 },
      });
      const deadline = Date.now() + 90_000;
      while (!operation.done && Date.now() < deadline) {
        if (opts.signal?.aborted) return { ok: false, error: "aborted" };
        opts.onStatus?.("Video generation is still processing…");
        await sleep(5000);
        operation = await client.operations.getVideosOperation({ operation });
      }
      if (!operation.done) {
        return { ok: false, error: "Video generation is still processing. Tap Retry." };
      }
      if (operation.error) {
        last = redact(JSON.stringify(operation.error)).slice(0, 500);
        continue;
      }
      const video = operation.response?.generatedVideos?.[0]?.video;
      if (video?.videoBytes) {
        const mime = video.mimeType || "video/mp4";
        return { ok: true, url: `data:${mime};base64,${video.videoBytes}`, model };
      }
      if (video?.uri) {
        const fetched = await fetchProviderMedia(video.uri);
        if (fetched) return { ok: true, url: fetched, model };
      }
      last = "Veo finished without a video file";
    } catch (error) {
      last = redact(error instanceof Error ? error.message : "Veo request failed").slice(0, 500);
    }
  }
  return { ok: false, error: last };
}

async function fetchProviderMedia(uri: string): Promise<string | null> {
  const key = geminiApiKey();
  const res = await fetch(uri, {
    headers: key ? { "x-goog-api-key": key } : {},
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return null;
  const mime = (res.headers.get("content-type") || "video/mp4").split(";")[0]!.trim();
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 12_000_000) return uri;
  return `data:${mime};base64,${buf.toString("base64")}`;
}

