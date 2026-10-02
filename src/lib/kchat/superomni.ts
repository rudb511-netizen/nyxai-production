/** NYXAI+ vs free NYXAI capability caps. Free NYXAI stays fully usable. */

export const FREE_OMNI_CAPS = {
  historyKeep: 24,
  olderChars: 2400,
  maxTokensMul: 1,
  minReasoning: "low" as const,
  chatPerMin: 240,
  imagesPerHour: 120,
  videosPerHour: 30,
  ttsPerHour: 120,
  memoryLimit: 24,
  fileExtractChars: 40_000,
  multiSource: false,
  workspaceFiles: 12,
};

export const SUPEROMNI_CAPS = {
  historyKeep: 40,
  olderChars: 6000,
  maxTokensMul: 1.6,
  minReasoning: "medium" as const,
  chatPerMin: 480,
  imagesPerHour: 240,
  videosPerHour: 60,
  ttsPerHour: 240,
  memoryLimit: 64,
  fileExtractChars: 80_000,
  multiSource: true,
  workspaceFiles: 32,
};

export type OmniCaps = {
  historyKeep: number;
  olderChars: number;
  maxTokensMul: number;
  minReasoning: "low" | "medium" | "high";
  chatPerMin: number;
  imagesPerHour: number;
  videosPerHour: number;
  ttsPerHour: number;
  memoryLimit: number;
  fileExtractChars: number;
  multiSource: boolean;
  workspaceFiles: number;
};

export function omniCaps(superActive: boolean): OmniCaps {
  return superActive ? SUPEROMNI_CAPS : FREE_OMNI_CAPS;
}

export const SUPEROMNI_FEATURES = [
  { id: "reasoning", title: "Advanced reasoning", body: "Harder math, planning, and multi-step problems with a higher reasoning floor." },
  { id: "memory", title: "Longer conversation memory", body: "More of this thread stays in context so follow-ups stay on the actual subject." },
  { id: "research", title: "Multi-source research", body: "Live lookup across more than one source, with citations — never invented links." },
  { id: "code", title: "Advanced coding", body: "Larger drafts, interpreter tools, and a bigger workspace for project files." },
  { id: "files", title: "File and image understanding", body: "Longer document extracts and image understanding on the same thread." },
  { id: "image", title: "Image generation", body: "Higher hourly image allowance. Generation still uses the live image path when it is available." },
  { id: "voice", title: "Live voice", body: "Real-time voice stays on for everyone; NYXAI+ raises spoken-reply capacity." },
  { id: "agent", title: "Agent-style tasks", body: "Research, coding, writing, and study agents run with the higher NYXAI+ limits." },
  { id: "writing", title: "Advanced writing", body: "Longer structured drafts without shrinking everyday NYXAI." },
] as const;
