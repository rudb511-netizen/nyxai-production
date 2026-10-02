export type OmniIntent =
  | "chat"
  | "recommend"
  | "explain"
  | "search"
  | "research"
  | "write"
  | "compare"
  | "code"
  | "math"
  | "image"
  | "video"
  | "translate"
  | "summarize"
  | "analyze";

export type OmniIntentResult = {
  intent: OmniIntent;
  needsWeb: boolean;
  reason: string;
};

const CURRENT =
  /\b(latest|breaking|this week|this month|who won|final score|as of 20\d{2}|price of|stock price|share price|how much (is|are)|current (price|events|weather|version|standings)|weather (in|for|today)|forecast|released today|just released|right now|live (score|results)|crypto|bitcoin|ethereum|btc\b|eth\b|news about|headlines|search the web|look(?:ing)? up|look up|browse|on the (web|internet)|what happened (today|yesterday)|election results|box office)\b/i;

const CASUAL_TODAY =
  /\b(what('?s| is) on your mind today|how are you today|your mind today|good morning|good night)\b/i;

const FOLLOW_UP =
  /^(why|how so|and then|more$|go on|continue|keep going|tell me more|what do you mean|what about (it|that|this)|yeah|yes|yep|yup|no|nope|ok|okay|sure|really|wait|huh|same|true|false|agree|disagree|maybe|idk|i don't know|that one|the first one|the previous one|please do|do it|go ahead|just tell me|just answer|answer(?: the question)?|answer me|stop talking|stop it|give me the answer|you'?re not answering|please just(?: answer| tell)|i (said|asked))\b/i;

const FRUSTRATION =
  /^(just tell me|just answer|answer(?: the question)?|answer me|stop talking|stop it|give me the answer|you'?re not answering|please just(?: answer| tell)|i (said|asked)|that('?s| is) not (an )?answer)\b/i;

const NEW_TASK =
  /\b(generate|create|draw|make|render|imagine|paint|search|look up|research|write (me )?(a |an )?(function|component|script|code|picture|image)|debug|fix this|translate)\b/i;

export function isGreeting(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q || q.length > 48) return false;
  return /^(hi|hey|hello|yo|sup|howdy|hiya|thanks|thank you|thx|good (morning|afternoon|evening|night)|what'?s up|how are you|how's it going)[\s!.?]*$/i.test(
    q,
  );
}

export function detectIntent(text: string, mode?: string | null): OmniIntentResult {
  const q = text.trim();
  const lower = q.toLowerCase();

  if (isGreeting(q)) {
    return { intent: "chat", needsWeb: false, reason: "greeting" };
  }

  if (mode === "video" && q.length > 8) {
    return { intent: "video", needsWeb: false, reason: "video mode" };
  }
  if (mode === "image" && (wantsImage(lower) || q.length > 10)) {
    return { intent: "image", needsWeb: false, reason: "image mode" };
  }
  if (mode === "code" && q.length > 4) return { intent: "code", needsWeb: false, reason: "code mode" };
  if (mode === "research" && q.length > 8) return { intent: "research", needsWeb: true, reason: "research mode" };
  if (mode === "search" && q.length > 4) return { intent: "search", needsWeb: true, reason: "search mode" };

  if (wantsVideo(lower)) {
    return { intent: "video", needsWeb: false, reason: "video request" };
  }
  if (wantsImage(lower)) {
    return { intent: "image", needsWeb: false, reason: "image request" };
  }
  if (
    /\b(debug|refactor|stack trace|compile error|typescript|javascript|python|sql query|html|css|react native|function\s|class\s|```)\b/i.test(
      q,
    ) ||
    /\b(write|fix|explain)\b.+\b(code|function|component|query)\b/i.test(q)
  ) {
    return { intent: "code", needsWeb: false, reason: "programming" };
  }
  if (
    /\b(integral|derivative|solve for|calculate|compute|what is \d+|equals|\d+\s*(times|plus|minus|divided by)\s*\d+)\b/i.test(
      q,
    ) ||
    /^\s*-?\d+(\.\d+)?\s*[\+\-x×*/÷]\s*-?\d+/.test(lower)
  ) {
    return { intent: "math", needsWeb: false, reason: "math" };
  }
  if (CASUAL_TODAY.test(q)) {
    return { intent: "chat", needsWeb: false, reason: "conversation" };
  }
  if (/^\s*(what(?:'s| is)|what's|define|who is|who are|tell me about)\s+/i.test(q) && q.length < 180) {
    const web = needsWeb(q);
    return { intent: "explain", needsWeb: web, reason: web ? "definition + current" : "definition" };
  }
  if (/\b(translate|traduce|übersetz|in (spanish|french|german|japanese|korean|arabic|hindi|portuguese))\b/i.test(q)) {
    return { intent: "translate", needsWeb: false, reason: "translate" };
  }
  if (/\b(summarize|summary|tldr|tl;dr|key points|recap this)\b/i.test(q)) {
    return { intent: "summarize", needsWeb: false, reason: "summarize" };
  }
  if (/\b(compare|vs\.?|versus|difference between|pros and cons)\b/i.test(q)) {
    const web = needsWeb(q);
    return { intent: "compare", needsWeb: web, reason: web ? "compare + current" : "compare" };
  }
  if (/\b(help me write|draft|rewrite|caption|bio|subject line|make this (sound|shorter|funnier))\b/i.test(q)) {
    return { intent: "write", needsWeb: false, reason: "writing" };
  }
  if (/\b(should i buy|what .+ should i (buy|get|use)|recommend|recommendation|best .+ for)\b/i.test(q)) {
    const web = needsWeb(q);
    return { intent: "recommend", needsWeb: web, reason: web ? "recommend + current" : "recommend" };
  }
  if (/\b(analyze|analyse|extract from|what's in this (file|doc|image|screenshot)|review this (doc|pdf|image)|dataset|csv|spreadsheet|xlsx|missing values|outliers)\b/i.test(q)) {
    return { intent: "analyze", needsWeb: false, reason: "analyze" };
  }
  if (/\b(explain|what does this mean|walk me through|how does .+ work)\b/i.test(q)) {
    const web = needsWeb(q);
    return { intent: "explain", needsWeb: web, reason: web ? "explain + current" : "explain" };
  }
  if (/\b(research|deep dive|briefing|cite sources|sources please)\b/i.test(q)) {
    return { intent: "research", needsWeb: true, reason: "research ask" };
  }
  if (needsWeb(q)) {
    return { intent: "search", needsWeb: true, reason: "current information" };
  }
  return { intent: "chat", needsWeb: false, reason: "conversation" };
}

export function needsWeb(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  if (CASUAL_TODAY.test(q) || isGreeting(q)) return false;
  if (CURRENT.test(q)) return true;
  if (
    /\b(today|tonight|this morning|yesterday|this year)\b/i.test(q) &&
    /\b(news|price|weather|score|won|game|stock|election|released|standings|match)\b/i.test(q)
  ) {
    return true;
  }
  return false;
}

function wantsVideo(lower: string): boolean {
  return (
    /\b(generate|create|make|render|animate)\b/.test(lower) && /\b(video|clip|animation)\b/.test(lower)
  ) || /\b(video of|clip of|animate)\b/.test(lower);
}

function wantsImage(lower: string): boolean {
  if (
    (/\b(generate|create|draw|make|render|imagine|paint|design|sketch)\b/.test(lower) &&
      /\b(image|picture|illustration|logo|poster|thumbnail|banner|art|photo|drawing|pic)\b/.test(lower)) ||
    /\b(image of|picture of|illustration of|photo of|drawing of)\b/.test(lower)
  ) {
    return true;
  }
  if (/\b(draw|generate|paint|imagine)\b.+\b(car|cat|dog|house|sunset|city|portrait|flower|dragon|robot)\b/.test(lower)) {
    return true;
  }
  return false;
}

export function isFollowUp(text: string, history: { role: string; content: string }[]): boolean {
  if (!history.length) return false;
  const q = text.trim();
  if (!q || q.length > 96) return false;
  if (isGreeting(q)) return false;
  if (NEW_TASK.test(q)) return false;
  const current = detectIntent(q);
  if (current.intent === "image" || current.intent === "code" || current.intent === "search" || current.intent === "research") {
    return false;
  }
  if (isTopicChange(q, history)) return false;
  if (isFrustration(q) || FOLLOW_UP.test(q.toLowerCase())) return true;
  if (/^(it|that|this|those|them|he|she)\b/i.test(q) && q.length < 48) return true;
  return false;
}

export function isTopicChange(text: string, history: { role: string; content: string }[]): boolean {
  if (!history.length) return false;
  if (isGreeting(text) || isFollowUpShort(text) || isFrustration(text)) return false;
  const current = detectIntent(text);
  let lastUser = "";
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.role === "user") {
      lastUser = history[i]!.content;
      break;
    }
  }
  if (!lastUser) return false;
  const prev = detectIntent(lastUser);
  if (NEW_TASK.test(text) && current.intent !== prev.intent) return true;
  if (
    (current.intent === "image" ||
      current.intent === "code" ||
      current.intent === "search" ||
      current.intent === "research" ||
      current.intent === "write" ||
      current.intent === "translate" ||
      current.intent === "math") &&
    current.intent !== prev.intent
  ) {
    return true;
  }
  if (current.intent !== "chat" && current.intent !== prev.intent) return true;
  const now = significantTokens(text);
  const then = significantTokens(lastUser);
  if (now.length >= 2 && then.length >= 2) {
    const overlap = now.filter((t) => then.includes(t)).length;
    if (overlap === 0) return true;
  }
  return false;
}

function isFollowUpShort(text: string): boolean {
  const q = text.trim();
  if (q.length > 96) return false;
  return FOLLOW_UP.test(q.toLowerCase()) || isFrustration(q);
}

export function isFrustration(text: string): boolean {
  const q = text.trim();
  if (!q || q.length > 96) return false;
  return FRUSTRATION.test(q.toLowerCase());
}

export function lastOpenUserQuestion(history: { role: string; content: string }[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!;
    if (turn.role !== "user") continue;
    const c = turn.content.trim();
    if (!c) continue;
    if (isGreeting(c) || isFrustration(c) || isFollowUpShort(c)) continue;
    return c;
  }
  return "";
}

function significantTokens(s: string): string[] {
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "in",
    "on",
    "for",
    "is",
    "it",
    "i",
    "you",
    "me",
    "my",
    "we",
    "what",
    "how",
    "do",
    "does",
    "can",
    "please",
    "just",
    "about",
    "with",
    "this",
    "that",
  ]);
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t));
}

export function intentInstruction(intent: OmniIntent): string {
  switch (intent) {
    case "recommend":
      return "Give a clear pick, why, and 1–2 alternatives. Ask only if a real constraint is missing.";
    case "explain":
      return "Explain directly. Start with the definition or mechanism. No preamble.";
    case "search":
      return "Use live web search. Lead with the answer, then sources. If search fails, say so.";
    case "research":
      return "Search, compare sources, then write a brief with citations. Never invent sources.";
    case "write":
      return "Produce the draft. Do not describe the draft before writing it.";
    case "compare":
      return "Compare with a table or aligned bullets. State the deciding tradeoff.";
    case "code":
      return "Show working code with a language tag. Do not invent runtime output.";
    case "math":
      return "Put the result first. Brief working only if it helps.";
    case "image":
      return "Image generation runs separately. Do not continue a previous unrelated topic.";
    case "video":
      return "Video generation runs separately. Do not invent a clip or a progress bar.";
    case "translate":
      return "Put the translation first. Preserve tone.";
    case "summarize":
      return "Summarize. Do not invent facts from the file.";
    case "analyze":
      return "Use only what is in the files or images. If text could not be extracted, say so.";
    default:
      return "Answer the latest user message first. Older turns are context. If they changed topic, drop the old one.";
  }
}

const SENSITIVE =
  /\b(password|passwd|ssn|social security|credit card|cvv|api[- ]?key|secret|private key|token|otp|backup codes?)\b/i;

export function extractExplicitMemory(text: string): { key: string; value: string } | null {
  if (SENSITIVE.test(text)) return null;
  const named = text.match(/\b(?:remember (?:that )?my name is|call me)\s+([A-Za-z][A-Za-z' -]{1,40})/i);
  if (named?.[1]) return { key: "name", value: named[1].trim().slice(0, 80) };
  const pref = text.match(/\bremember (?:that |this[:\s]+)?(.{4,240})$/i);
  if (!pref) return null;
  const value = pref[1]!.replace(/[.!?]+$/, "").trim();
  if (value.length < 4) return null;
  if (/^(this|that|it|me|you)\b/i.test(value) && value.length < 12) return null;
  return { key: "preference", value: value.slice(0, 500) };
}

export function compactHistory(
  turns: { role: string; content: string }[],
  keep = 20,
  olderLimit = 1800,
): { older: string; recent: { role: "user" | "assistant"; content: string }[] } {
  if (turns.length <= keep) {
    return {
      older: "",
      recent: turns.map((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content: t.content,
      })),
    };
  }
  const olderTurns = turns.slice(0, turns.length - keep);
  const recentTurns = turns.slice(turns.length - keep);
  const older = olderTurns
    .map((t) => `${t.role === "assistant" ? "NYXAI" : "User"}: ${t.content.replace(/\s+/g, " ").slice(0, 160)}`)
    .join("\n")
    .slice(0, olderLimit);
  return {
    older,
    recent: recentTurns.map((t) => ({
      role: t.role === "assistant" ? "assistant" : "user",
      content: t.content,
    })),
  };
}
