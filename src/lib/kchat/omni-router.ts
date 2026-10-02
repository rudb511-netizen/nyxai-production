import { detectIntent, isGreeting } from "./omni-intent.ts";

export type OmniModelId =
  | "auto"
  | "fast"
  | "reasoning"
  | "research"
  | "coding"
  | "creative";

export type OmniMode = "chat" | "search" | "research" | "image" | "video" | "code" | "agent";

export type OmniAgentId =
  | "research"
  | "coding"
  | "writing"
  | "data"
  | "study"
  | "business"
  | "travel"
  | "marketing"
  | "social"
  | "assistant";

export type OmniPersonality =
  | "professional"
  | "friendly"
  | "creative"
  | "concise"
  | "teacher"
  | "researcher"
  | "developer"
  | "advisor";

export type ProviderModel = {
  id: OmniModelId;
  label: string;
  hint: string;
  provider: "xai";
  upstream: string;
  fallback: string;
  reasoning: "low" | "medium" | "high";
  temperature: number;
  maxTokens: number;
  search: "off" | "auto" | "on";
  tools: Array<"web_search" | "x_search" | "code_interpreter">;
};

export const OMNI_MODELS: ProviderModel[] = [
  {
    id: "auto",
    label: "NYXAI Auto",
    hint: "Picks speed vs depth for the question",
    provider: "xai",
    upstream: "grok-4.5",
    fallback: "grok-4.6",
    reasoning: "low",
    temperature: 0.85,
    maxTokens: 2800,
    search: "off",
    tools: [],
  },
  {
    id: "fast",
    label: "NYXAI Fast",
    hint: "Snappy replies, no live web",
    provider: "xai",
    upstream: "grok-4.5",
    fallback: "grok-4.6",
    reasoning: "low",
    temperature: 0.8,
    maxTokens: 900,
    search: "off",
    tools: [],
  },
  {
    id: "reasoning",
    label: "NYXAI Reasoning",
    hint: "Harder problems, math, planning",
    provider: "xai",
    upstream: "grok-4.5",
    fallback: "grok-4.6",
    reasoning: "high",
    temperature: 0.5,
    maxTokens: 2800,
    search: "off",
    tools: [],
  },
  {
    id: "research",
    label: "NYXAI Research",
    hint: "Live web with citations",
    provider: "xai",
    upstream: "grok-4.5",
    fallback: "grok-4.6",
    reasoning: "medium",
    temperature: 0.4,
    maxTokens: 3200,
    search: "on",
    tools: ["web_search", "x_search"],
  },
  {
    id: "coding",
    label: "NYXAI Coding",
    hint: "Code, diffs, sandboxed interpreter",
    provider: "xai",
    upstream: "grok-4.5",
    fallback: "grok-4.6",
    reasoning: "medium",
    temperature: 0.2,
    maxTokens: 2800,
    search: "off",
    tools: ["code_interpreter"],
  },
  {
    id: "creative",
    label: "NYXAI Creative",
    hint: "Writing, images, brainstorms",
    provider: "xai",
    upstream: "grok-4.5",
    fallback: "grok-4.6",
    reasoning: "low",
    temperature: 1.05,
    maxTokens: 2000,
    search: "off",
    tools: [],
  },
];

export function getModel(id: string | null | undefined): ProviderModel {
  return OMNI_MODELS.find((m) => m.id === id) ?? OMNI_MODELS[0]!;
}

export function resolveModel(
  selected: string | null | undefined,
  mode: OmniMode,
  text: string,
): ProviderModel {
  if (selected && selected !== "auto") return getModel(selected);
  if (isGreeting(text)) return getModel("fast");
  if (mode === "research" || mode === "search") return getModel("research");
  if (mode === "code") return getModel("coding");
  if (mode === "image") return getModel("creative");
  const detected = detectIntent(text, mode);
  if (detected.intent === "research" || detected.intent === "search" || detected.needsWeb) {
    return getModel("research");
  }
  if (detected.intent === "code") return getModel("coding");
  if (detected.intent === "math") return getModel("reasoning");
  if (detected.intent === "image" || detected.intent === "video" || detected.intent === "write") return getModel("creative");
  if (/\b(prove|derive|why does|step by step|architecture|tradeoff)\b/i.test(text)) {
    return getModel("reasoning");
  }
  return getModel("fast");
}

export function resolveSearch(
  mode: OmniMode,
  searchPref: "auto" | "on" | "off" | string | undefined,
  text: string,
): "on" | "off" {
  if (isGreeting(text)) return "off";
  if (mode === "search" || mode === "research") return "on";
  if (searchPref === "on") return "on";
  if (searchPref === "off") return "off";
  return detectIntent(text, mode).needsWeb ? "on" : "off";
}

export const PERSONALITY_PROMPT: Record<OmniPersonality, string> = {
  professional: "Tone: professional and precise. Lead with the answer. No slang, no pep talk.",
  friendly:
    "Tone: direct, curious, slightly dry. Useful first, wit second — joke only when it helps. Never open with “Great question!” or corporate filler.",
  creative: "Tone: vivid and concrete. Take language risks. Still finish the task.",
  concise: "Tone: terse. Short paragraphs. No filler. Prefer bullets.",
  teacher: "Tone: patient teacher. Explain why. Check understanding with one question.",
  researcher: "Tone: careful. Separate facts, inferences, and unknowns. Cite only sources you actually retrieved.",
  developer: "Tone: senior engineer. Show code. Call out edge cases and tests. Never fake runtime output.",
  advisor: "Tone: business advisor. Tradeoffs, costs, next actions. Flag assumptions.",
};

export const AGENT_BRIEF: Record<OmniAgentId, string> = {
  research:
    "You are the Research Agent. Plan subquestions, search, read, compare sources, then write a structured report with citations. Never invent sources.",
  coding:
    "You are the Coding Agent. Write working code, tests, and a short explanation. Call the interpreter for calculations. Do not fake runtime output.",
  writing: "You are the Writing Agent. Draft, rewrite, and tighten. Offer 2–3 variants when asked.",
  data: "You are the Data Analyst. Use only the numbers in the files. Never invent rows. Show calculations.",
  study: "You are the Study Agent. Explain, quiz, and make spaced-repetition notes.",
  business: "You are the Business Agent. Markets, costs, positioning. Flag assumptions.",
  travel: "You are the Travel Planner. Itineraries with realistic times. Search live when needed.",
  marketing: "You are the Marketing Agent. Campaigns, hooks, channels. Stay honest about claims.",
  social:
    "You are the Social Media Agent for NYX. Captions, hashtags, reply drafts. Never publish without the user.",
  assistant: "You are a personal assistant. Capture tasks, draft messages, plan the day.",
};

export function wantsImage(text: string): boolean {
  return detectIntent(text).intent === "image";
}

export function applySuperOmni(model: ProviderModel, active: boolean): ProviderModel {
  if (!active) return model;
  const reasoning: ProviderModel["reasoning"] =
    model.reasoning === "low" ? "medium" : model.reasoning;
  return {
    ...model,
    reasoning,
    maxTokens: Math.min(8192, Math.round(model.maxTokens * 1.6)),
    label: model.id === "auto" ? "NYXAI+ Auto" : model.label.replace("NYXAI", "NYXAI+"),
  };
}
