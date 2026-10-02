import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { takeToken, rateError } from "../rate-limit";
import { sniffBytes } from "../sticker-process";
import {
  enhanceUnavailableMessage,
  pickSuperResolutionProvider,
  type SuperResolutionProviderId,
  type SuperResolutionResult,
} from "../super-resolution";
import { publicError } from "../public-error";
import { assertNotBanned, ensureProfile, sqlClient } from "./helpers";
import { readStillPixelSize } from "../camera-still";

const INPUT_MAX_CHARS = 3_800_000;
const FETCH_TIMEOUT_MS = 55_000;

function envProvider(): SuperResolutionProviderId {
  return pickSuperResolutionProvider({
    replicateToken: process.env.REPLICATE_API_TOKEN,
    xaiKey: process.env.XAI_API_KEY,
  });
}

function parseDataUrl(raw: string): { mime: string; bytes: Uint8Array } {
  if (!raw.startsWith("data:") || raw.length > INPUT_MAX_CHARS) {
    throw new Error("Image too large.");
  }
  const comma = raw.indexOf(",");
  const header = comma >= 0 ? raw.slice(0, comma) : "";
  const body = comma >= 0 ? raw.slice(comma + 1) : raw;
  const mime = /data:([^;,]+)/i.exec(header)?.[1] || "application/octet-stream";
  const bin = Buffer.from(body, "base64");
  if (!bin.length) throw new Error("Invalid image.");
  return { mime, bytes: new Uint8Array(bin) };
}

function assertStillImage(mime: string, bytes: Uint8Array) {
  const sniff = sniffBytes(bytes, "", mime);
  if (!sniff || sniff.kind !== "image") throw new Error("Invalid image.");
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(sniff.mime)) throw new Error("That file type isn’t allowed.");
}

async function inlineResult(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  if (!/^https:\/\//i.test(url)) throw new Error("Enhancement failed.");
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error("Enhancement failed.");
  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0]!.trim();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 400 || buf.length > 8_000_000) throw new Error("Enhancement failed.");
  assertStillImage(mime, new Uint8Array(buf));
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function probeUrl(url: string): Promise<{ width: number | null; height: number | null }> {
  try {
    if (!url.startsWith("data:")) return { width: null, height: null };
    const parsed = parseDataUrl(url);
    const size = readStillPixelSize(parsed.bytes);
    return size ?? { width: null, height: null };
  } catch {
    return { width: null, height: null };
  }
}

async function runReplicate(imageDataUrl: string, scale: 2 | 4): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error("Enhancement isn’t available.");
  const started = await fetch("https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=45",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      input: {
        image: imageDataUrl,
        scale,
        face_enhance: false,
      },
    }),
  });
  const raw = await started.text();
  if (started.status === 429) throw new Error("Slow down — try again in a minute.");
  if (!started.ok) {
    console.error("[nyx-sr] replicate", started.status, raw.slice(0, 180));
    throw new Error("Enhancement failed.");
  }
  const parsed = JSON.parse(raw) as { output?: string | string[]; status?: string; urls?: { get?: string } };
  const out = Array.isArray(parsed.output) ? parsed.output[0] : parsed.output;
  if (typeof out === "string" && out) return out;
  if (parsed.status === "succeeded" && typeof out === "string") return out;
  const poll = parsed.urls?.get;
  if (!poll) throw new Error("Enhancement failed.");
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const r = await fetch(poll, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await r.json()) as { status?: string; output?: string | string[]; error?: string };
    if (body.status === "succeeded") {
      const u = Array.isArray(body.output) ? body.output[0] : body.output;
      if (typeof u === "string" && u) return u;
    }
    if (body.status === "failed" || body.status === "canceled") throw new Error("Enhancement failed.");
    await new Promise((res) => setTimeout(res, 1200));
  }
  throw new Error("Enhancement failed.");
}

async function runXai(imageDataUrl: string): Promise<string> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("Enhancement isn’t available.");
  const res = await fetch("https://api.x.ai/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      model: "grok-imagine-image-quality",
      prompt:
        "Photorealistic super-resolution of this exact photograph. Increase native detail and resolution. Preserve identity, geometry, lighting, colors, and lens look. Do not restyle, crop, or add objects.",
      image: imageDataUrl,
      images: [imageDataUrl],
      n: 1,
      resolution: "2k",
    }),
  });
  const raw = await res.text();
  if (res.status === 429) throw new Error("Slow down — try again in a minute.");
  if (!res.ok) {
    console.error("[nyx-sr] xai", res.status, raw.slice(0, 180));
    throw new Error("Enhancement failed.");
  }
  const parsed = JSON.parse(raw) as { data?: { url?: string; b64_json?: string }[] };
  const url = parsed.data?.[0]?.url;
  if (url) return url;
  const b64 = parsed.data?.[0]?.b64_json;
  if (b64) return `data:image/png;base64,${b64}`;
  throw new Error("Enhancement failed.");
}

export const enhanceCapturedPhoto = createServerFn({ method: "POST" })
  .validator((d: { imageDataUrl: string; scale?: 2 | 4 }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<SuperResolutionResult> => {
    const started = Date.now();
    const provider = envProvider();
    try {
      const sql = await sqlClient();
      const me = await ensureProfile(sql, { id: context.userId });
      assertNotBanned(me);
      const wait = takeToken(`sr:${context.userId}`, 6, 5 * 60_000);
      if (wait) throw new Error(rateError(wait));
      if (provider === "none") {
        return { ok: false, error: enhanceUnavailableMessage("none"), provider };
      }
      const parsed = parseDataUrl(data.imageDataUrl);
      assertStillImage(parsed.mime, parsed.bytes);
      const scale: 2 | 4 = data.scale === 4 ? 4 : 2;
      let imageUrl =
        provider === "replicate-realesrgan"
          ? await runReplicate(data.imageDataUrl, scale)
          : await runXai(data.imageDataUrl);
      imageUrl = await inlineResult(imageUrl);
      const size = await probeUrl(imageUrl);
      return {
        ok: true,
        imageUrl,
        provider,
        scale,
        width: size.width,
        height: size.height,
        durationMs: Date.now() - started,
      };
    } catch (e) {
      const err = publicError(e, enhanceUnavailableMessage(provider));
      return { ok: false, error: err.message, provider };
    }
  });
