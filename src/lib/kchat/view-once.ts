export const VIEW_ONCE_STATES = ["UNOPENED", "OPENING", "OPENED", "CONSUMED", "EXPIRED", "REVOKED"] as const;
export type ViewOnceState = (typeof VIEW_ONCE_STATES)[number];

/** Unopened view-once media expires 24 hours after send. */
export const VIEW_ONCE_TTL_MS = 24 * 60 * 60 * 1000;

export function isViewOnceState(v: unknown): v is ViewOnceState {
  return (
    v === "UNOPENED" ||
    v === "OPENING" ||
    v === "OPENED" ||
    v === "CONSUMED" ||
    v === "EXPIRED" ||
    v === "REVOKED"
  );
}

export function deriveViewOnceState(row: {
  viewOnce: boolean;
  openedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  stored?: string | null;
  now?: number;
}): ViewOnceState | null {
  if (!row.viewOnce) return null;
  if (row.revokedAt) return "REVOKED";
  if (row.stored === "REVOKED") return "REVOKED";
  if (row.stored === "CONSUMED") return "CONSUMED";
  if (row.openedAt || row.stored === "OPENED" || row.stored === "OPENING") return "OPENED";
  const created = Date.parse(row.createdAt);
  const now = row.now ?? Date.now();
  if (Number.isFinite(created) && now - created >= VIEW_ONCE_TTL_MS) return "EXPIRED";
  if (row.stored === "EXPIRED") return "EXPIRED";
  return "UNOPENED";
}

export function canOpenViewOnce(
  state: ViewOnceState | null,
  isSender: boolean,
): { ok: boolean; reason?: string } {
  if (!state) return { ok: false, reason: "This isn’t a view-once message." };
  if (isSender) return { ok: false, reason: "View Once media sent. You can’t open it again." };
  if (state === "OPENED" || state === "OPENING" || state === "CONSUMED") {
    return { ok: false, reason: "This was already opened." };
  }
  if (state === "EXPIRED") return { ok: false, reason: "This view-once message expired." };
  if (state === "REVOKED") return { ok: false, reason: "This was revoked." };
  return { ok: true };
}

export function recipientViewOnceCopy(state: ViewOnceState): string {
  switch (state) {
    case "UNOPENED":
      return "View once";
    case "OPENING":
    case "OPENED":
    case "CONSUMED":
      return "Opened";
    case "EXPIRED":
      return "Expired";
    case "REVOKED":
      return "Revoked";
  }
}

export function senderViewOnceCopy(state: ViewOnceState | null): string {
  if (state === "REVOKED") return "View Once media revoked";
  if (state === "EXPIRED") return "View Once media expired";
  if (state === "OPENED" || state === "OPENING" || state === "CONSUMED") return "View Once media opened";
  return "View Once media sent";
}

export function viewOnceKindAllowed(kind: string): boolean {
  return kind === "image" || kind === "video" || kind === "voice" || kind === "photo";
}

export function viewOnceNotifyBody(displayName: string, kind: string): string {
  const noun = kind === "voice" ? "voice note" : kind === "video" ? "video" : "photo";
  return `${displayName} sent you a View Once ${noun}.`;
}

export function newViewOnceToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashViewOnceToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(`nyx-vo:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
