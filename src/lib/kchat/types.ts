export type Gender = "male" | "female";
export type Role = "user" | "moderator" | "admin" | "super_admin";
export type ThemePref = "light" | "dark" | "system";
export type VerifyKind = "none" | "org" | "founder" | "developer" | "arc";

export function asVerifyKind(v: unknown): VerifyKind {
  return v === "org" || v === "founder" || v === "developer" || v === "arc" ? v : "none";
}

/** Identity badge only — ARC is a separate administrative flag. */
export function identityKind(v: unknown): Exclude<VerifyKind, "arc"> {
  const k = asVerifyKind(v);
  return k === "arc" ? "none" : k;
}

export function isArcFlag(p: {
  isArc?: boolean | null;
  is_arc?: boolean | null;
  verifyKind?: string | null;
  verify_kind?: string | null;
} | null | undefined): boolean {
  if (!p) return false;
  return Boolean(p.isArc) || Boolean(p.is_arc) || p.verifyKind === "arc" || p.verify_kind === "arc";
}

export function verifyLabel(kind: VerifyKind | null | undefined): string | null {
  if (kind === "arc") return "ARC Admin";
  if (kind === "founder") return "Nyx founder";
  if (kind === "org") return "Official organization";
  if (kind === "developer") return "Developer";
  return null;
}

export function isOfficialKind(kind: VerifyKind | null | undefined): boolean {
  return kind === "org" || kind === "founder" || kind === "developer";
}

export type AuthorLite = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verifyKind: VerifyKind;
  isArc: boolean;
  isPremium: boolean;
};

export type PublicProfile = {
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  gender: Gender | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  isPrivate: boolean;
  isVerified: boolean;
  verifyKind: VerifyKind;
  isArc: boolean;
  isPremium: boolean;
  followers: number;
  following: number;
  friends: number;
  posts: number;
  isSelf: boolean;
  isFollowing: boolean;
  isFollower: boolean;
  isFriend: boolean;
  friendRequest: "none" | "outgoing" | "incoming";
  isBlocked: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  website?: string | null;
  location?: string | null;
  isMuted?: boolean;
  isRestricted?: boolean;
  isDeactivated?: boolean;
};

export type MeProfile = PublicProfile & {
  email: string | null;
  emailVerified: boolean;
  dateOfBirth: string | null;
  role: Role;
  onboarded: boolean;
  totpEnabled: boolean;
  theme: ThemePref;
  showOnline: boolean;
  showLastSeen: boolean;
  readReceipts: boolean;
  whoCanMessage: "everyone" | "friends" | "nobody";
  whoCanFriend: "everyone" | "friends" | "nobody";
  whoCanFollow: "everyone" | "friends" | "nobody";
  whoCanCall: "everyone" | "friends" | "nobody";
  storyVisibility: "everyone" | "friends" | "close";
  statusPrivacy: "friends" | "except" | "only";
  allowStatusReshare: boolean;
  isSuspended: boolean;
  isBanned: boolean;
  restrict: Record<string, boolean>;
  sanctionUntil: string | null;
  notifPrefs: NotificationPrefs;
  score: number;
  ghostMode: boolean;
  soundPrefs: {
    messages: boolean;
    typing: boolean;
    calls: boolean;
    notifications: boolean;
    vibration: boolean;
  };
  biometricEnabled: boolean;
  safeMode?: boolean;
  focusMode?: boolean;
  interestsSet?: boolean;
  website?: string | null;
  location?: string | null;
  deactivatedAt?: string | null;
  phone?: string | null;
  phoneVerified?: boolean;
  nyxaiPlus?: {
    active: boolean;
    source: "purchase" | "arc_grant" | "none";
  };
  premiumVerify?: {
    active: boolean;
    source: "purchase" | "arc_grant" | "none";
  };
  superOmni?: {
    active: boolean;
    status: string;
    plan: "month" | "six_month" | "year" | null;
    renewsAt: string | null;
  };
};

export type NotificationPrefs = {
  messages: boolean;
  friends: boolean;
  followers: boolean;
  likes: boolean;
  comments: boolean;
  live: boolean;
  stories: boolean;
  streaks: boolean;
  messagePopup: boolean;
  messageReminders: boolean;
  mentions: boolean;
};

export const DEFAULT_NOTIF_PREFS: NotificationPrefs = {
  messages: true,
  friends: true,
  followers: true,
  likes: true,
  comments: true,
  live: true,
  stories: true,
  streaks: true,
  messagePopup: true,
  messageReminders: true,
  mentions: true,
};

export type MediaItem = {
  id: string;
  kind: "image" | "video" | "gif" | "audio" | "file";
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
};

export type PollOption = { id: string; text: string; votes: number };
export type PollState = {
  options: PollOption[];
  endsAt: string | null;
  myVote: string | null;
  total: number;
};

export type FeedPost = {
  id: string;
  kind: "post" | "quote" | "repost" | "video";
  body: string;
  author: AuthorLite;
  media: MediaItem[];
  poll: PollState | null;
  location: string | null;
  likes: number;
  comments: number;
  reposts: number;
  views: number;
  liked: boolean;
  saved: boolean;
  reposted: boolean;
  commentsDisabled: boolean;
  quoteOf: FeedPost | null;
  createdAt: string;
  editedAt: string | null;
};

export type CommentNode = {
  id: string;
  body: string;
  author: AuthorLite;
  likes: number;
  liked: boolean;
  createdAt: string;
  replies: CommentNode[];
  pinned?: boolean;
  editedAt?: string | null;
  sticker?: { id: string; name: string; url: string | null; mediaKind?: string; packId?: string } | null;
};

import type { MessageExtra } from "./comms-extra";

export type ConversationPreview = {
  id: string;
  kind: "dm" | "group";
  title: string;
  imageUrl: string | null;
  lastBody: string;
  lastAt: string | null;
  lastKind: string | null;
  unread: number;
  muted: boolean;
  archived: boolean;
  pinned: boolean;
  favorite: boolean;
  markedUnread: boolean;
  other?: AuthorLite;
  streak: { count: number; icon: string; hoursLeft: number } | null;
  memberCount: number;
  online: boolean;
  statusId: string | null;
  statusSeen: boolean;
  draft?: string | null;
  isBroadcast?: boolean;
  muteUntil?: string | null;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  kind: string;
  body: string;
  mediaUrl: string | null;
  replyToId: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  delivered: boolean;
  forwarded: boolean;
  forwardedFrom: string | null;
  durationMs: number | null;
  viewOnce: boolean;
  viewOnceState?: "UNOPENED" | "OPENING" | "OPENED" | "CONSUMED" | "EXPIRED" | "REVOKED" | null;
  opened: boolean;
  starred: boolean;
  read: boolean;
  expiresAt?: string | null;
  extra?: MessageExtra | null;
  silent?: boolean;
  albumId?: string | null;
  pinned?: boolean;
};

export type ChatMember = AuthorLite & {
  role: "owner" | "admin" | "member";
  restricted?: boolean;
  banned?: boolean;
};

export type ChatThread = {
  conversation: {
    id: string;
    kind: "dm" | "group";
    title: string;
    imageUrl: string | null;
    myRole: "owner" | "admin" | "member";
    members: ChatMember[];
    isBroadcast?: boolean;
    forumEnabled?: boolean;
    username?: string | null;
    linkedDiscussionId?: string | null;
    supportStaff?: boolean;
  };
  items: ChatMessage[];
  typing: string[];
  recording: string[];
  members: AuthorLite[];
  hasMore: boolean;
  draft?: string;
  pinned?: Array<{ id: string; body: string; kind: string; senderName: string }>;
  muteUntil?: string | null;
};

export type StoryCard = {
  id: string;
  author: AuthorLite;
  mediaUrl: string | null;
  mediaKind: "photo" | "video" | "text";
  textBody: string | null;
  background: string | null;
  createdAt: string;
  expiresAt: string;
  seen: boolean;
  viewerCount: number;
};

export type StatusCard = {
  id: string;
  author: AuthorLite;
  mediaUrl: string | null;
  mediaKind: "photo" | "video" | "text";
  textBody: string | null;
  background: string | null;
  createdAt: string;
  expiresAt: string;
  seen: boolean;
  viewerCount: number;
  audience: "friends" | "except" | "only";
  viewOnce: boolean;
  opened: boolean;
  reshareOfId?: string | null;
  originalAuthor?: AuthorLite | null;
  allowReshare?: boolean;
};

export type ShortVideo = {
  id: string;
  author: AuthorLite;
  caption: string;
  mediaUrl: string;
  thumbUrl: string | null;
  likes: number;
  comments: number;
  views: number;
  liked: boolean;
  saved: boolean;
  createdAt: string;
  mine: boolean;
  downloadAllowed: boolean;
  following: boolean;
  musicTitle: string | null;
  soundId: string | null;
  musicPreviewUrl?: string | null;
  musicLicense?: string | null;
  originalAudio: boolean;
  allowOriginalAudio: boolean;
  width: number | null;
  height: number | null;
  sourceLabel: string | null;
  playbackLabel: string | null;
  hdr: boolean;
  durationMs: number | null;
  renditions: Array<{ quality: string; height: number; url: string }>;
  shareCount: number;
  saveCount: number;
  pinned?: boolean;
  remixOfId?: string | null;
};

export type AppNotification = {
  id: string;
  kind: string;
  body: string;
  actor: AuthorLite | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
};

export type CommunityCard = {
  id: string;
  kind: "channel" | "community";
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  isPrivate: boolean;
  memberCount: number;
  isMember: boolean;
  isAdmin: boolean;
};

export type LiveCard = {
  id: string;
  host: AuthorLite;
  title: string;
  status: "live" | "ended";
  viewers: number;
  roomCode: string;
  startedAt: string;
};

export type KaiThread = {
  id: string;
  title: string;
  updatedAt: string;
};

export type KaiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
