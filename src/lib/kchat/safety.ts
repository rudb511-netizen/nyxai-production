export const RANK = {
  user: 0,
  moderator: 20,
  admin: 50,
  arc: 100,
  system: 1000,
} as const;

export function isStaffRole(role: string): boolean {
  return role === "moderator" || role === "admin" || role === "super_admin";
}

export function isArcKind(verifyKind: string | null | undefined, isArc?: boolean | null): boolean {
  return Boolean(isArc) || verifyKind === "arc";
}

export function isAdministrator(role: string, verifyKind: string, isArc?: boolean | null): boolean {
  return (
    Boolean(isArc) ||
    verifyKind === "org" ||
    verifyKind === "founder" ||
    verifyKind === "developer" ||
    verifyKind === "arc" ||
    role === "admin" ||
    role === "super_admin"
  );
}

export function adminRank(
  role: string,
  verifyKind?: string | null,
  userId?: string | null,
  isArc?: boolean | null,
): number {
  if (userId === "omni_ai_system" || userId === "omni_support_system") return RANK.system;
  if (isArcKind(verifyKind, isArc)) return RANK.arc;
  if (
    verifyKind === "founder" ||
    verifyKind === "org" ||
    verifyKind === "developer" ||
    role === "admin" ||
    role === "super_admin"
  ) {
    return RANK.admin;
  }
  if (role === "moderator") return RANK.moderator;
  return RANK.user;
}

export function isProtectedAccount(opts: {
  userId: string;
  role: string;
  verifyKind?: string | null;
  isArc?: boolean | null;
}): boolean {
  if (opts.userId === "omni_ai_system" || opts.userId === "omni_support_system") return true;
  return (
    isAdministrator(opts.role, opts.verifyKind ?? "none", opts.isArc) || opts.role === "moderator"
  );
}

export function canPunishTarget(opts: {
  actorId: string;
  actorRole?: string;
  actorVerifyKind?: string | null;
  actorIsArc?: boolean | null;
  target: { userId: string; role: string; verifyKind?: string | null; isArc?: boolean | null };
}): boolean {
  if (!opts.actorId || opts.actorId === opts.target.userId) return false;
  const a = adminRank(opts.actorRole ?? "user", opts.actorVerifyKind ?? "none", opts.actorId, opts.actorIsArc);
  const t = adminRank(opts.target.role, opts.target.verifyKind, opts.target.userId, opts.target.isArc);
  if (t >= RANK.arc) return false;
  return a > t;
}

export function canManageAdministrator(opts: {
  actorId: string;
  actorRole?: string;
  actorVerifyKind?: string | null;
  actorIsArc?: boolean | null;
  target: { userId: string; role: string; verifyKind?: string | null; isArc?: boolean | null };
}): boolean {
  if (!opts.actorId || opts.actorId === opts.target.userId) return false;
  if (!isArcKind(opts.actorVerifyKind, opts.actorIsArc)) return false;
  const t = adminRank(opts.target.role, opts.target.verifyKind, opts.target.userId, opts.target.isArc);
  if (t >= RANK.arc) return false;
  return t >= RANK.moderator || isAdministrator(opts.target.role, opts.target.verifyKind ?? "none", opts.target.isArc);
}

export function canAccessSafety(role: string, verifyKind: string, isArc?: boolean | null): boolean {
  return (
    isStaffRole(role) ||
    Boolean(isArc) ||
    verifyKind === "org" ||
    verifyKind === "founder" ||
    verifyKind === "developer" ||
    verifyKind === "arc"
  );
}

export function canDeleteOwned(viewerId: string, authorId: string, role: string): boolean {
  return Boolean(viewerId) && (viewerId === authorId || isStaffRole(role));
}

export function canDeleteComment(opts: {
  viewerId: string;
  commentAuthorId: string;
  postAuthorId?: string | null;
  role: string;
}): boolean {
  if (!opts.viewerId) return false;
  if (opts.viewerId === opts.commentAuthorId) return true;
  if (opts.postAuthorId && opts.viewerId === opts.postAuthorId) return true;
  return isStaffRole(opts.role);
}

export const REPORT_TARGET_KINDS = [
  "user",
  "post",
  "comment",
  "video",
  "video_comment",
  "story",
  "status",
  "flash",
] as const;
export type ReportTargetKind = (typeof REPORT_TARGET_KINDS)[number];

export function isReportTargetKind(v: string): v is ReportTargetKind {
  return (REPORT_TARGET_KINDS as readonly string[]).includes(v);
}
