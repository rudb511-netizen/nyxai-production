/** User-safe AI failures. Never include keys, SQL, or a fake result. */

export type AiKind = "text" | "image" | "video";

export function isCannedOutage(text: string): boolean {
  return /paused because|out of credits|credits are restored|temporarily unavailable|try again after credits|this app is out of credits/i.test(
    text,
  );
}

export function providerFailureMessage(raw: string, kind: AiKind): string {
  const s = raw.toLowerCase();
  const freeZero = /limit:\s*0|free_tier/.test(s);
  const providerBilling =
    /spending-limit|spending limit|run out of credits|quota|resource_exhausted|billing/.test(s) || /429/.test(s);
  if (kind === "image" && (freeZero || providerBilling)) {
    return "Image generation failed. The configured providers refused it (Gemini image free quota is 0, or xAI image billing is exhausted). Enable billing on one of those accounts, then tap Retry.";
  }
  if (kind === "video" && (freeZero || providerBilling)) {
    return "Video generation failed. The configured providers refused it (Veo free quota is 0, or xAI video billing is exhausted). Enable billing on one of those accounts, then tap Retry.";
  }
  if (/429|resource_exhausted|rate limit/.test(s) && kind !== "text") {
    return kind === "image" ? "Image generation failed. Tap Retry." : "Video generation failed. Tap Retry.";
  }
  if (/timeout|timed out|aborted/.test(s)) return "Your request timed out. Tap Retry.";
  if (/not set|no_key|api key is not|not configured/.test(s)) {
    return "AI provider is not configured on the server.";
  }
  if (/not found|invalid model|unsupported/.test(s)) {
    return "That AI model is not available on this provider account.";
  }
  if (kind === "image") return "Image generation failed. Tap Retry.";
  if (kind === "video") return "Video generation failed. Tap Retry.";
  return "NYXAI could not answer. Tap Retry.";
}
