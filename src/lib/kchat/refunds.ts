/** 24-hour in-app refund request window. Provider/store rights are never overridden. */

export const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

export function refundWindow(purchasedAt: string | Date, now = Date.now()): {
  deadline: string;
  expired: boolean;
  remainingMs: number;
} {
  const t = new Date(purchasedAt).getTime();
  const deadlineMs = t + REFUND_WINDOW_MS;
  return {
    deadline: new Date(deadlineMs).toISOString(),
    expired: !Number.isFinite(t) || now > deadlineMs,
    remainingMs: Number.isFinite(t) ? deadlineMs - now : 0,
  };
}

export function refundStatusLabel(status: string): string {
  if (status === "confirmed") return "Refund confirmed by the payment provider.";
  if (status === "submitted") return "Submitted to the payment provider. Not complete until they confirm.";
  if (status === "pending") return "Request recorded. Money is returned only after the provider confirms.";
  if (status === "denied") return "The provider denied this refund.";
  if (status === "expired") return "Refund request period expired.";
  if (status === "cancelled") return "Refund request cancelled.";
  return status;
}
