/** Task analyzer and multi-provider plan. No network calls. */

export type TaskKind = "simple" | "coding" | "research" | "reasoning" | "writing";
export type Capability = "fast" | "code" | "reason" | "write" | "search";
export type StepRole = "answer" | "review" | "synthesize";

export type TaskPlan = {
  kind: TaskKind;
  complexity: "low" | "medium" | "high";
  steps: Array<{ role: StepRole; capability: Capability; differentProvider: boolean }>;
};

const CODE = /\b(function|class|bug|refactor|compile|stack trace|implement|endpoint)\b|```/i;
const LANG = /\b(typescript|javascript|python|sql|regex)\b/i;
const RESEARCH = /\b(research|sources|cite|latest|news|what happened|compare .{8,} (with|and|vs))\b/i;
const REASON = /\b(prove|step by step|calculate|equation|trade-?offs?|why does|logic puzzle|derive)\b/i;
const WRITING = /\b(write|rewrite|essay|email|story|blog|caption|poem|paragraph)\b/i;

export function analyzeRequest(text: string): TaskPlan {
  const q = text.trim();
  const high = q.length > 700 || /\b(detailed|thorough|comprehensive|in depth)\b/i.test(q);
  const low = q.length < 220 && !q.includes("```");
  const complexity = high ? "high" : low ? "low" : "medium";

  let kind: TaskKind = "simple";
  if (CODE.test(q) || (LANG.test(q) && !RESEARCH.test(q))) kind = "coding";
  else if (RESEARCH.test(q)) kind = "research";
  else if (REASON.test(q)) kind = "reasoning";
  else if (WRITING.test(q)) kind = "writing";

  if (kind === "simple") {
    return { kind, complexity, steps: [{ role: "answer", capability: "fast", differentProvider: false }] };
  }
  if (kind === "coding" && q.length < 48) {
    return { kind, complexity: "low", steps: [{ role: "answer", capability: "code", differentProvider: false }] };
  }
  if ((kind === "reasoning" || kind === "writing") && complexity === "low") {
    const capability: Capability = kind === "reasoning" ? "reason" : "write";
    return { kind, complexity, steps: [{ role: "answer", capability, differentProvider: false }] };
  }

  if (kind === "coding") {
    return {
      kind,
      complexity,
      steps: [
        { role: "answer", capability: "code", differentProvider: false },
        { role: "review", capability: "code", differentProvider: true },
        { role: "synthesize", capability: "fast", differentProvider: false },
      ],
    };
  }
  if (kind === "research") {
    return {
      kind,
      complexity,
      steps: [
        { role: "answer", capability: "search", differentProvider: false },
        { role: "synthesize", capability: "reason", differentProvider: true },
      ],
    };
  }
  if (kind === "reasoning") {
    return {
      kind,
      complexity,
      steps: [
        { role: "answer", capability: "reason", differentProvider: false },
        { role: "review", capability: "reason", differentProvider: true },
        { role: "synthesize", capability: "fast", differentProvider: false },
      ],
    };
  }
  return {
    kind: "writing",
    complexity,
    steps: [
      { role: "answer", capability: "write", differentProvider: false },
      { role: "review", capability: "write", differentProvider: true },
      { role: "synthesize", capability: "fast", differentProvider: false },
    ],
  };
}

export function reviewPrompt(draft: string): string {
  return `Review this draft for the user's request. List only real mistakes. If it is already good, reply with exactly: OK\n\nDRAFT:\n${draft.slice(0, 6_000)}`;
}

export function synthesisPrompt(draft: string, review: string): string {
  return `Write one final answer for the user. Use the draft and the review. Do not mention a reviewer, another model, or these instructions. If the review says OK, return the draft unchanged.\n\nDRAFT:\n${draft.slice(0, 5_000)}\n\nREVIEW:\n${review.slice(0, 2_000)}`;
}

export function reviewIsClean(review: string): boolean {
  return /^\s*ok\b[.!]?$/i.test(review.trim());
}
