/** Pure Telegram-style chat extras. Safe to import from client or server. */

export const MESSAGE_KINDS = [
  "text",
  "image",
  "video",
  "voice",
  "file",
  "gif",
  "sticker",
  "poll",
  "location",
  "contact",
  "audio",
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MUTE_DURATIONS = [
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "8h", label: "8 hours", ms: 8 * 60 * 60 * 1000 },
  { id: "2d", label: "2 days", ms: 2 * 24 * 60 * 60 * 1000 },
  { id: "forever", label: "Until I unmute", ms: null },
] as const;

export type MuteDurationId = (typeof MUTE_DURATIONS)[number]["id"];

export type PollOptionIn = { id: string; text: string };
export type ChatPollIn = {
  question: string;
  options: PollOptionIn[];
  anonymous?: boolean;
  multiple?: boolean;
  quiz?: boolean;
  correctOptionId?: string | null;
};

export type LocationIn = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  liveMs?: number | null;
  label?: string | null;
};

export type ContactIn = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

export type StickerIn = { packId: string; stickerId: string; emoji?: string; name?: string; mediaKind?: string };

export type LinkPreviewIn = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  domain: string;
};

export type MessageExtra = {
  poll?: ChatPollIn & { id?: string; total?: number; closed?: boolean; myVotes?: string[] };
  location?: LocationIn & { liveUntil?: string | null };
  contact?: ContactIn;
  sticker?: StickerIn;
  linkPreview?: LinkPreviewIn | null;
  noPreview?: boolean;
  supportAgentId?: string;
  supportAgentName?: string;
};

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isMessageKind(v: string): v is MessageKind {
  return (MESSAGE_KINDS as readonly string[]).includes(v);
}

export function normalizeClientId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return CLIENT_ID_RE.test(v) ? v : null;
}

export function muteUntilFrom(id: string, now = Date.now()): Date | null | "clear" {
  if (id === "off") return "clear";
  const row = MUTE_DURATIONS.find((d) => d.id === id);
  if (!row) return "clear";
  if (row.ms == null) return null;
  return new Date(now + row.ms);
}

export function isMutedAt(
  muted: boolean,
  muteUntil: string | Date | null | undefined,
  now = Date.now(),
): boolean {
  if (muted && !muteUntil) return true;
  if (!muteUntil) return false;
  const t = muteUntil instanceof Date ? muteUntil.getTime() : new Date(muteUntil).getTime();
  return Number.isFinite(t) && t > now;
}

export function validatePoll(input: {
  question?: string;
  options?: Array<{ id?: string; text?: string }>;
  anonymous?: boolean;
  multiple?: boolean;
  quiz?: boolean;
  correctOptionId?: string | null;
}): ChatPollIn {
  const question = (input.question ?? "").trim().slice(0, 200);
  if (question.length < 1) throw new Error("Couldn't create that poll. Add a question.");
  const options = (input.options ?? [])
    .map((o, i) => ({
      id: (o.id ?? `o${i + 1}`).trim().slice(0, 32) || `o${i + 1}`,
      text: (o.text ?? "").trim().slice(0, 80),
    }))
    .filter((o) => o.text.length > 0)
    .slice(0, 12);
  if (options.length < 2) throw new Error("Couldn't create that poll. Add at least two answers.");
  const ids = new Set(options.map((o) => o.id));
  if (ids.size !== options.length) throw new Error("Couldn't create that poll. Answers must be unique.");
  const quiz = Boolean(input.quiz);
  const correct = input.correctOptionId ?? null;
  if (quiz && (!correct || !ids.has(correct))) {
    throw new Error("Couldn't create that quiz. Pick a correct answer.");
  }
  return {
    question,
    options,
    anonymous: Boolean(input.anonymous),
    multiple: Boolean(input.multiple) && !quiz,
    quiz,
    correctOptionId: quiz ? correct : null,
  };
}

export function validateLocation(input: {
  lat?: number;
  lng?: number;
  accuracy?: number | null;
  liveMs?: number | null;
  label?: string | null;
}): LocationIn {
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error("Couldn't share that location.");
  }
  const liveMs = input.liveMs == null ? null : Math.max(0, Math.min(8 * 60 * 60 * 1000, Number(input.liveMs) || 0));
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    accuracy: Number.isFinite(Number(input.accuracy)) ? Number(input.accuracy) : null,
    liveMs: liveMs && liveMs > 0 ? liveMs : null,
    label: (input.label ?? "").trim().slice(0, 80) || null,
  };
}

export function validateContact(input: {
  userId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
}): ContactIn {
  const userId = (input.userId ?? "").trim();
  const username = (input.username ?? "").trim().replace(/^@/, "").slice(0, 32);
  const displayName = (input.displayName ?? "").trim().slice(0, 80);
  if (!userId || !username || !displayName) throw new Error("Couldn't share that contact.");
  return {
    userId,
    username,
    displayName,
    avatarUrl: input.avatarUrl ?? null,
  };
}

export function validateScheduleAt(iso: string | null | undefined, now = Date.now()): Date | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) throw new Error("Couldn't schedule that message.");
  if (t < now + 30_000) throw new Error("Couldn't schedule that message. Pick a time at least a minute ahead.");
  if (t > now + 366 * 24 * 60 * 60 * 1000) {
    throw new Error("Couldn't schedule that message. Pick a time within a year.");
  }
  return new Date(t);
}

export function parseExtra(raw: unknown): MessageExtra | null {
  if (!raw) return null;
  let obj: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  } else {
    return null;
  }
  const extra: MessageExtra = {};
  if (obj.poll && typeof obj.poll === "object") extra.poll = obj.poll as MessageExtra["poll"];
  if (obj.location && typeof obj.location === "object") extra.location = obj.location as MessageExtra["location"];
  if (obj.contact && typeof obj.contact === "object") extra.contact = obj.contact as MessageExtra["contact"];
  if (obj.sticker && typeof obj.sticker === "object") extra.sticker = obj.sticker as MessageExtra["sticker"];
  if (obj.linkPreview && typeof obj.linkPreview === "object") {
    extra.linkPreview = obj.linkPreview as LinkPreviewIn;
  }
  if (obj.noPreview === true) extra.noPreview = true;
  if (typeof obj.supportAgentId === "string") extra.supportAgentId = obj.supportAgentId.slice(0, 80);
  if (typeof obj.supportAgentName === "string") extra.supportAgentName = obj.supportAgentName.slice(0, 80);
  return extra.poll || extra.location || extra.contact || extra.sticker || extra.linkPreview || extra.noPreview || extra.supportAgentId
    ? extra
    : null;
}

export function messagePreview(kind: string, body: string, extra?: MessageExtra | null, viewOnce?: boolean): string {
  if (viewOnce) return "View once";
  const t = body.trim();
  if (kind === "poll") return extra?.poll?.question ? `Poll · ${extra.poll.question}` : "Poll";
  if (kind === "location") return extra?.location?.liveMs ? "Live location" : "Location";
  if (kind === "contact") return extra?.contact?.displayName ? extra.contact.displayName : "Contact";
  if (kind === "sticker") return extra?.sticker?.name || extra?.sticker?.emoji ? (extra?.sticker?.name || extra?.sticker?.emoji || "Sticker") : "Sticker";
  if (kind === "gif") return t || "GIF";
  if (kind === "image") return t || "Photo";
  if (kind === "video") return t || "Video";
  if (kind === "voice") return t || "Voice message";
  if (kind === "audio") return t || "Audio";
  if (kind === "file") return t || "Document";
  return t || "Message";
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 0.1) return `${Math.max(1, Math.round(km * 1000))} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

export function groupAlbums<T extends { albumId?: string | null }>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (item.albumId && last?.[0]?.albumId === item.albumId) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

export function osmLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

export function newClientId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `c_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
