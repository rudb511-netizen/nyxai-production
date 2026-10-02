/** Hold a MediaStream acquired during the Answer tap so iOS getUserMedia stays in the user-gesture. */

export type StashedCall = { callId: string; stream: MediaStream; label: string };

let pending: StashedCall | null = null;

export function stashCallMedia(callId: string, stream: MediaStream, label: string): void {
  if (pending && pending.callId !== callId) {
    pending.stream.getTracks().forEach((t) => t.stop());
  }
  pending = { callId, stream, label };
}

export function takeCallMedia(callId: string): StashedCall | null {
  if (!pending || pending.callId !== callId) return null;
  const held = pending;
  pending = null;
  return held;
}
