/** Server-only Runway Gen-4.5 client. The API key never leaves the server. */

import { envValue } from "./ai-router.ts";

const BASE = "https://api.dev.runwayml.com";
const VERSION = "2024-11-06";

export type RunwayTask = {
  taskId: string;
  model: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  outputUrl: string | null;
  error: string | null;
};

function key(): string {
  return envValue("RUNWAY_API_KEY");
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${key()}`,
    "Content-Type": "application/json",
    "X-Runway-Version": VERSION,
  };
}

function publicError(status: number, body: string): string {
  if (status === 401 || status === 403) return "Runway rejected the API key.";
  if (status === 429) return "Runway is rate-limited. Try again later.";
  const cleaned = body.replace(/key_[A-Za-z0-9]+/g, "key").slice(0, 180);
  return cleaned || "Runway video generation failed. Please try again.";
}

function mapStatus(status: string | undefined): RunwayTask["status"] {
  if (status === "SUCCEEDED") return "SUCCEEDED";
  if (status === "FAILED" || status === "CANCELLED") return "FAILED";
  if (status === "RUNNING" || status === "THROTTLED") return "RUNNING";
  return "PENDING";
}

export function runwayConfigured(): boolean {
  return Boolean(key());
}

export async function createRunwayVideo(opts: {
  prompt: string;
  image?: string;
  ratio: string;
  duration: number;
}): Promise<{ taskId: string; model: string }> {
  if (!key()) throw new Error("Runway is not configured.");
  const model = envValue("RUNWAY_MODEL") || "gen4.5";
  const body: Record<string, unknown> = {
    model,
    promptText: opts.prompt.slice(0, 1000),
    ratio: opts.ratio,
    duration: opts.duration,
  };
  if (opts.image) body.promptImage = opts.image;
  const res = await fetch(`${BASE}/v1/image_to_video`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(publicError(res.status, raw));
  let taskId = "";
  try {
    taskId = (JSON.parse(raw) as { id?: string }).id || "";
  } catch {
    throw new Error("Runway returned an unreadable response.");
  }
  if (!taskId) throw new Error("Runway did not return a task id.");
  return { taskId, model };
}

export async function fetchRunwayTask(taskId: string): Promise<RunwayTask> {
  if (!key()) throw new Error("Runway is not configured.");
  const res = await fetch(`${BASE}/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: headers(),
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(publicError(res.status, raw));
  const data = JSON.parse(raw) as {
    id?: string;
    status?: string;
    output?: string[];
    failure?: string;
    failureCode?: string;
  };
  const status = mapStatus(data.status);
  const outputUrl = Array.isArray(data.output) ? data.output.find((item) => typeof item === "string" && item.startsWith("http")) || null : null;
  return {
    taskId: data.id || taskId,
    model: envValue("RUNWAY_MODEL") || "gen4.5",
    status,
    outputUrl,
    error: status === "FAILED" ? data.failure || data.failureCode || "Runway video generation failed." : null,
  };
}
