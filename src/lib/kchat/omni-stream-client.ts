import { getBearerToken } from "@/lib/auth/client";
import type { OmniAttachment } from "./omni-files";
import type { OmniMode } from "./omni-router";

type OmniCite = { url: string; title: string };

export type OmniStreamPayload = {
  threadId: string;
  content: string;
  attachments?: OmniAttachment[];
  mode?: OmniMode;
  modelId?: string;
  agent?: string | null;
  aspect?: string;
  style?: string;
  searchPref?: "auto" | "on" | "off";
};

export type OmniStreamDone = {
  text: string;
  prompts: string[];
  citations: OmniCite[];
  model: string;
  fallback: boolean;
  searched?: boolean;
};


export async function streamOmniMessage(
  payload: OmniStreamPayload,
  handlers: {
    onStatus?: (text: string) => void;
    onDelta?: (chunk: string) => void;
    onCitation?: (citations: OmniCite[]) => void;
    signal?: AbortSignal;

  },
): Promise<OmniStreamDone> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getBearerToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch("/api/omni-stream", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    let msg = "NYXAI could not answer. Tap Retry.";
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed.error) msg = parsed.error;
    } catch {
      /* keep unavailable copy */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let done: OmniStreamDone | null = null;
  let error: string | null = null;

  let streamed = "";
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    carry += decoder.decode(value, { stream: true });
    const parts = carry.split("\n\n");
    carry = parts.pop() ?? "";
    for (const block of parts) {
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        const json = JSON.parse(data) as {
          text?: string;
          error?: string;
          prompts?: string[];
          citations?: OmniCite[];
          model?: string;
          fallback?: boolean;
          searched?: boolean;
        };
        if (event === "status" && json.text) handlers.onStatus?.(json.text);
        else if (event === "delta" && json.text) {
          streamed += json.text;
          handlers.onDelta?.(json.text);
        } else if (event === "citation" && json.citations) handlers.onCitation?.(json.citations);
        else if (event === "error") error = json.error || "NYXAI could not answer. Tap Retry.";
        else if (event === "done") {
          done = {
            text: json.text || streamed,
            prompts: json.prompts ?? [],
            citations: json.citations ?? [],
            model: json.model ?? "",
            fallback: Boolean(json.fallback),
            searched: Boolean(json.searched),
          };
        }
      } catch {
        /* skip malformed */
      }
    }
  }

  if (done?.text.trim()) return done;
  if (streamed.trim()) {
    return { text: streamed.trim(), prompts: [], citations: [], model: "", fallback: false };
  }
  if (error) throw new Error(error);
  throw new Error("NYXAI could not answer. Tap Retry.");
}

export async function speakOmni(text: string, voiceId = "eve"): Promise<Blob | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getBearerToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch("/api/omni-tts", {
    method: "POST",
    headers,
    body: JSON.stringify({ text: text.slice(0, 1800), voiceId }),
  });
  if (!res.ok) return null;
  return res.blob();
}
