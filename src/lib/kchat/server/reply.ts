/** One real chat completion with provider fallback. */

import { appendFileSync } from "node:fs";
import { generateConversationResponse, type ChatTurn } from "./ai-router.ts";

function note(code: string): void {
  try {
    appendFileSync("/tmp/nyx-ai-error.log", `${new Date().toISOString()} ${code.slice(0, 180)}\n`);
  } catch {
    /* ignore */
  }
}

export async function answerUser(
  userText: string,
  history: ChatTurn[] = [],
  onDelta?: (chunk: string) => void,
): Promise<{ text: string; model: string; provider: string; tokensIn: number; tokensOut: number }> {
  try {
    const spoken = await generateConversationResponse(history, userText, { onDelta });
    return {
      text: spoken.text,
      model: spoken.model,
      provider: spoken.provider,
      tokensIn: spoken.tokensIn,
      tokensOut: spoken.tokensOut,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "NYXAI could not answer. Tap Retry.";
    note(message);
    throw new Error(message);
  }
}
