/** Provider-agnostic super-resolution. Original still is never overwritten. */

export type SuperResolutionProviderId = "replicate-realesrgan" | "xai-imagine" | "none";

export type SuperResolutionRequest = {
  imageDataUrl: string;
  scale: 2 | 4;
  mime?: string;
};

export type SuperResolutionResult = {
  ok: true;
  imageUrl: string;
  provider: SuperResolutionProviderId;
  scale: 2 | 4;
  width: number | null;
  height: number | null;
  durationMs: number;
} | {
  ok: false;
  error: string;
  provider: SuperResolutionProviderId;
};

export function pickSuperResolutionProvider(env: {
  replicateToken?: string | null;
  xaiKey?: string | null;
}): SuperResolutionProviderId {
  if (env.replicateToken?.trim()) return "replicate-realesrgan";
  if (env.xaiKey?.trim()) return "xai-imagine";
  return "none";
}

export function enhanceUnavailableMessage(provider: SuperResolutionProviderId): string {
  if (provider === "none") return "Photo enhancement isn’t available right now. Your original photo is kept.";
  return "Enhancement failed. Your original photo is kept.";
}
