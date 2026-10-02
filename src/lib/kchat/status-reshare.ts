/** Pure rules for status reshare. Enforced again on the server. */

export function canReshareStatus(opts: {
  allowReshare: boolean;
  expired: boolean;
  viewOnce: boolean;
  isSelf: boolean;
  isBlocked: boolean;
  isBlockedBy: boolean;
  canView: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (opts.expired) return { ok: false, reason: "This status expired." };
  if (opts.viewOnce) return { ok: false, reason: "View-once status can’t be reshared." };
  if (opts.isSelf) return { ok: false, reason: "That’s already on your status." };
  if (opts.isBlocked || opts.isBlockedBy) return { ok: false, reason: "You can’t reshare this status." };
  if (!opts.canView) return { ok: false, reason: "This status isn’t available." };
  if (!opts.allowReshare) return { ok: false, reason: "The creator turned off resharing." };
  return { ok: true };
}
