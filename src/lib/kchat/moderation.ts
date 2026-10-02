import type { ReportCategory } from "./privacy";

export type ModerationHit = {
  category: ReportCategory;
  severity: "low" | "high";
  reason: string;
  evidence: string;
};

function clip(s: string, n = 180): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function scanText(raw: string): ModerationHit | null {
  const text = raw.replace(/\u200b/g, " ").trim();
  if (text.length < 4) return null;
  const q = text.toLowerCase();

  if (
    /\b(child\s*porn|child\s*pornography|csam)\b/.test(q) ||
    (/\b(minor|underage|preteen|loli)\b/.test(q) && /\b(nude|naked|sex|porn|explicit)\b/.test(q))
  ) {
    return {
      category: "illegal",
      severity: "high",
      reason: "Possible sexual content involving a minor.",
      evidence: clip(text),
    };
  }

  if (
    /\b(i will (kill|shoot|stab) you|i'm going to (kill|shoot) you|bomb (your|the) (house|school|office))\b/.test(
      q,
    )
  ) {
    return {
      category: "violence",
      severity: "high",
      reason: "Direct threat of violence.",
      evidence: clip(text),
    };
  }

  if (
    /\b(wire me|send (me )?gift cards?|crypto giveaway|double your bitcoin|investment guaranteed returns|whatsapp lottery)\b/.test(
      q,
    )
  ) {
    return {
      category: "scam",
      severity: "high",
      reason: "Possible scam or financial fraud.",
      evidence: clip(text),
    };
  }

  const urls = text.match(/https?:\/\/[^\s]+/gi) ?? [];
  if (urls.length >= 5 || /\b(buy followers|cheap engagement|follow for follow spam)\b/.test(q)) {
    return {
      category: "spam",
      severity: "low",
      reason: "Spam or bulk promotional links.",
      evidence: clip(text),
    };
  }

  if (/\b(kill all|gas the|racial slur testtoken)\b/.test(q)) {
    return {
      category: "hate",
      severity: "high",
      reason: "Possible hate or abuse.",
      evidence: clip(text),
    };
  }

  if (/\b(kys|kill yourself)\b/.test(q)) {
    return {
      category: "harassment",
      severity: "high",
      reason: "Harassment or self-harm baiting.",
      evidence: clip(text),
    };
  }

  return null;
}

export function warningTier(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}
