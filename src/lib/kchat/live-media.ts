/** Real image and video generation. xAI first, Gemini/Veo if xAI cannot. No placeholders. */

import { providerFailureMessage } from "./ai-errors.ts";
import { geminiGenerateImage, geminiGenerateVideo } from "./gemini.ts";
import { editXaiImage, generateXaiImage } from "./xai.ts";

const XAI_BASE = "https://api.x.ai/v1";

export async function liveGenerateImage(opts: {
  prompt: string;
  aspect?: string;
  style?: string;
  references?: string[];
}): Promise<{ ok: true; url: string; model: string } | { ok: false; error: string }> {
  const aspect = opts.aspect || "1:1";
  const xai = opts.references?.length
    ? await editXaiImage(opts.prompt, opts.references, aspect)
    : await generateXaiImage(opts.prompt, aspect, opts.style);
  if (xai.ok) return { ok: true, url: xai.url, model: "grok-imagine-image" };
  if (xai.code === "invalid") return { ok: false, error: providerFailureMessage(xai.error, "image") };
  const gem = await geminiGenerateImage({ prompt: opts.prompt, aspect, references: opts.references });
  if (gem.ok) return gem;
  return { ok: false, error: providerFailureMessage(`${xai.code} ${gem.error}`, "image") };
}

export async function liveGenerateVideo(opts: {
  prompt: string;
  aspect?: string;
  onStatus?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<{ ok: true; url: string; model: string } | { ok: false; error: string }> {
  const xai = await xaiGenerateVideo(opts.prompt, opts.aspect || "16:9", opts.onStatus, opts.signal);
  if (xai.ok) return xai;
  if (/invalid/.test(xai.error) && !/quota|credit|billing|429|spending/i.test(xai.error)) {
    return { ok: false, error: providerFailureMessage(xai.error, "video") };
  }
  const gem = await geminiGenerateVideo(opts);
  if (gem.ok) return gem;
  return { ok: false, error: providerFailureMessage(`${xai.error} ${gem.error}`, "video") };
}

async function xaiGenerateVideo(
  prompt: string,
  aspect: string,
  onStatus?: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ ok: true; url: string; model: string } | { ok: false; error: string }> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) return { ok: false, error: "XAI_API_KEY is not set" };
  onStatus?.("Starting video generation…");
  let res: Response;
  try {
    res = await fetch(`${XAI_BASE}/videos/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: signal ?? AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: "grok-imagine-video",
        prompt: prompt.slice(0, 2000),
        duration: 5,
        aspect_ratio: aspect === "9:16" ? "9:16" : "16:9",
        resolution: "720p",
      }),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "xAI video request failed" };
  }
  const raw = await res.text();
  if (!res.ok) return { ok: false, error: raw.slice(0, 500) };
  let requestId = "";
  let immediate = "";
  try {
    const parsed = JSON.parse(raw) as { request_id?: string; video?: { url?: string }; url?: string };
    requestId = parsed.request_id || "";
    immediate = parsed.video?.url || parsed.url || "";
  } catch {
    return { ok: false, error: "Unreadable xAI video response" };
  }
  if (immediate.startsWith("http")) return { ok: true, url: immediate, model: "grok-imagine-video" };
  if (!requestId) return { ok: false, error: "xAI video response had no request id" };
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) return { ok: false, error: "aborted" };
    onStatus?.("Video generation is still processing…");
    await new Promise((r) => setTimeout(r, 4000));
    const poll = await fetch(`${XAI_BASE}/videos/${encodeURIComponent(requestId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await poll.text();
    if (!poll.ok) return { ok: false, error: body.slice(0, 400) };
    const data = JSON.parse(body) as { status?: string; video?: { url?: string } };
    if (data.status === "done" && data.video?.url) {
      return { ok: true, url: data.video.url, model: "grok-imagine-video" };
    }
    if (data.status === "failed" || data.status === "expired") {
      return { ok: false, error: `xAI video ${data.status}` };
    }
  }
  return { ok: false, error: "Video generation is still processing. Tap Retry." };
}
