/** Granular account restrictions from active sanctions. */

export type RestrictCaps = {
  post?: boolean;
  comment?: boolean;
  message?: boolean;
  video?: boolean;
  story?: boolean;
  status?: boolean;
  call?: boolean;
  react?: boolean;
  friend?: boolean;
};

export type RestrictKey = keyof RestrictCaps;

const LABELS: Record<RestrictKey, string> = {
  post: "post",
  comment: "comment",
  message: "send messages",
  video: "upload video",
  story: "post a story",
  status: "post a status",
  call: "place calls",
  react: "react",
  friend: "send friend requests",
};

export function parseRestrict(raw: unknown): RestrictCaps {
  if (!raw || typeof raw !== "object") return {};
  return raw as RestrictCaps;
}

export function denyIfRestricted(caps: RestrictCaps, key: RestrictKey): void {
  if (!caps[key]) return;
  throw new Error(`This account cannot ${LABELS[key]} right now.`);
}
