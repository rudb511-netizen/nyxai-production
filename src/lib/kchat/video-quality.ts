/** Honest quality labels from actual pixel height. Never upscale. */

export type QualityId = "360p" | "480p" | "720p" | "1080p" | "1440p" | "4K" | "8K";

const LADDER: { id: QualityId; minHeight: number }[] = [
  { id: "8K", minHeight: 4000 },
  { id: "4K", minHeight: 2000 },
  { id: "1440p", minHeight: 1400 },
  { id: "1080p", minHeight: 1000 },
  { id: "720p", minHeight: 700 },
  { id: "480p", minHeight: 440 },
  { id: "360p", minHeight: 1 },
];

export function qualityFromHeight(height: number): QualityId {
  const h = Math.max(0, Math.round(height));
  for (const step of LADDER) {
    if (h >= step.minHeight) return step.id;
  }
  return "360p";
}

export function heightForQuality(id: QualityId): number {
  switch (id) {
    case "8K":
      return 4320;
    case "4K":
      return 2160;
    case "1440p":
      return 1440;
    case "1080p":
      return 1080;
    case "720p":
      return 720;
    case "480p":
      return 480;
    default:
      return 360;
  }
}

/** Rungs we may encode, never taller than the source. */
export function ladderForSource(sourceHeight: number): QualityId[] {
  const out: QualityId[] = [];
  for (const step of [...LADDER].reverse()) {
    if (sourceHeight >= step.minHeight && heightForQuality(step.id) <= sourceHeight) {
      out.push(step.id);
    }
  }
  return out;
}

/** Playback rungs we actually bother encoding (storage-aware). */
export function encodeTargets(sourceHeight: number, durationSec: number): QualityId[] {
  const available = ladderForSource(sourceHeight);
  const targets: QualityId[] = [];
  if (available.includes("360p")) targets.push("360p");
  const mid: QualityId = sourceHeight >= 1000 && durationSec <= 18 ? "1080p" : "720p";
  if (available.includes(mid) && !targets.includes(mid)) targets.push(mid);
  else if (available.includes("720p") && !targets.includes("720p")) targets.push("720p");
  else if (available.includes("480p") && !targets.includes("480p")) targets.push("480p");
  return targets.length ? targets : available.slice(0, 1);
}

export function pickAdaptive(
  rungs: { quality: QualityId; height: number }[],
  effectiveType?: string | null,
): QualityId {
  if (rungs.length === 0) return "360p";
  const sorted = [...rungs].sort((a, b) => a.height - b.height);
  const slow = effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g";
  if (slow) return sorted[0]!.quality;
  return sorted[sorted.length - 1]!.quality;
}

export function aspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) return "9:16";
  const g = gcd(width, height);
  return `${Math.round(width / g)}:${Math.round(height / g)}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function mentionsOmniAI(text: string): boolean {
  return /(^|[^\w])@(nyxai|omniai)\b/i.test(text);
}
