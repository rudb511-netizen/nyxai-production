export type Audience = "everyone" | "friends" | "nobody";
export type StoryVisibility = "everyone" | "friends" | "close";
export type StatusAudience = "friends" | "except" | "only";

export type Relation = {
  isSelf: boolean;
  isBlocked: boolean;
  isBlockedBy: boolean;
  isFriend: boolean;
  isFollowing: boolean;
  isFollower: boolean;
  isCloseFriend: boolean;
  /** Shared 1:1 or group conversation — a NYX contact, not only a friendship row. */
  isContact: boolean;
  /** Mutual follow is a real NYX connection, not a stranger. */
  isMutualFollow: boolean;
};

export function emptyRelation(): Relation {
  return {
    isSelf: false,
    isBlocked: false,
    isBlockedBy: false,
    isFriend: false,
    isFollowing: false,
    isFollower: false,
    isCloseFriend: false,
    isContact: false,
    isMutualFollow: false,
  };
}

/** Legitimate NYX connection for calling: friend, family/contact, group member, or mutual follow. */
export function isCallConnected(rel: Relation): boolean {
  return (
    rel.isFriend ||
    rel.isCloseFriend ||
    rel.isContact ||
    rel.isMutualFollow ||
    (rel.isFollowing && rel.isFollower)
  );
}

export function canViewPrivateAccount(rel: Relation, isPrivate: boolean): boolean {
  if (rel.isSelf) return true;
  if (rel.isBlocked || rel.isBlockedBy) return false;
  if (!isPrivate) return true;
  return rel.isFriend || rel.isFollowing;
}

export function canMessage(rel: Relation, who: Audience): boolean {
  if (rel.isSelf) return false;
  if (rel.isBlocked || rel.isBlockedBy) return false;
  if (who === "nobody") return false;
  if (who === "friends") return rel.isFriend;
  return true;
}

export function canFriendRequest(rel: Relation, who: Audience): boolean {
  if (rel.isSelf || rel.isFriend) return false;
  if (rel.isBlocked || rel.isBlockedBy) return false;
  if (who === "nobody") return false;
  if (who === "friends") return rel.isFollower || rel.isFollowing;
  return true;
}

export function canFollow(rel: Relation, who: Audience): boolean {
  if (rel.isSelf || rel.isFollowing) return false;
  if (rel.isBlocked || rel.isBlockedBy) return false;
  if (who === "nobody") return false;
  if (who === "friends") return rel.isFriend;
  return true;
}

export function canCall(rel: Relation, who: Audience): boolean {
  if (rel.isSelf) return false;
  if (rel.isBlocked || rel.isBlockedBy) return false;
  if (who === "nobody") return false;
  if (who === "friends") return isCallConnected(rel);
  return true;
}

export function callRefusal(rel: Relation, who: Audience): string | null {
  if (canCall(rel, who)) return null;
  if (rel.isSelf) return "You cannot call yourself.";
  if (rel.isBlocked) return "You blocked this person.";
  if (rel.isBlockedBy) return "This person is not available for calls.";
  if (who === "nobody") return "This person is not accepting calls.";
  return "You can only call people you're connected with on NYX.";
}

export function canViewStatus(
  rel: Relation,
  audience: StatusAudience = "friends",
  listed?: { mode: "except" | "only"; userIds: string[] },
  viewerId?: string,
): boolean {
  if (rel.isSelf) return true;
  if (rel.isBlocked || rel.isBlockedBy) return false;
  if (!rel.isFriend) return false;
  if (audience === "friends") return true;
  if (!listed || !viewerId) return false;
  if (audience === "except") return !listed.userIds.includes(viewerId);
  if (audience === "only") return listed.userIds.includes(viewerId);
  return false;
}

export function canViewStory(rel: Relation, visibility: StoryVisibility): boolean {
  if (rel.isSelf) return true;
  if (rel.isBlocked || rel.isBlockedBy) return false;
  if (visibility === "everyone") return true;
  if (visibility === "friends") return rel.isFriend;
  return rel.isCloseFriend;
}

export const REPORT_CATEGORIES = [
  { id: "spam", label: "Spam" },
  { id: "harassment", label: "Harassment" },
  { id: "hate", label: "Hate / abuse" },
  { id: "nudity", label: "Nudity / sexual content" },
  { id: "violence", label: "Violence" },
  { id: "scam", label: "Scam" },
  { id: "impersonation", label: "Impersonation" },
  { id: "illegal", label: "Illegal content" },
  { id: "copyright", label: "Copyright" },
  { id: "other", label: "Other" },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];
