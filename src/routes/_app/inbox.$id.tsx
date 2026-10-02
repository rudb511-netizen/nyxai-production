import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Clock, Eye, FileText, ImagePlus, Images, MapPin, Paperclip, Phone, Reply, Send, Settings, Smile, Sparkles, Sticker, Users, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmojiPicker } from "@/components/kchat/emoji-picker";
import { MessageMenu } from "@/components/kchat/message-menu";
import { VoiceBubble, VoiceButton, VoiceRecorder } from "@/components/kchat/voice-note";
import { useMeQuery } from "@/lib/kchat/hooks";
import { compressImage } from "@/lib/kchat/media-client";
import { MediaUploader, mediaSrc } from "@/lib/kchat/media-upload";
import { ImageLightbox, isVisualMediaUrl, type LightboxItem } from "@/components/kchat/image-lightbox";
import { ChatMediaPanel } from "@/components/kchat/chat-media-panel";
import { UploadProgress } from "@/components/kchat/upload-progress";
import { getCurrentPosition, hideKeyboard, openExternalUrl } from "@/utils/nativeCapabilities";
import { OMNI_AI_USER_ID } from "@/lib/kchat/omni-ids";
import { OMNI_SUPPORT_USER_ID } from "@/lib/kchat/omni-support-ids";
import { canAccessSafety } from "@/lib/kchat/safety";
import {
  addGroupMembers,
  forwardMessage,
  leaveChat,
  listConversations,
  listMessages,
  openViewOnce,
  removeGroupMember,
  renameGroup,
  sendMessage,
  setGroupRole,
  setTyping,
} from "@/lib/kchat/server/messages";
import { startCall, globalSearch } from "@/lib/kchat/server/more";
import { playNyxSound, startTypingLoop, stopTypingLoop, typingLoopShouldRun } from "@/lib/kchat/sounds";
import { MediaComposer } from "@/components/kchat/media-composer";
import { GiftSheet } from "@/components/kchat/gift-sheet";
import { ViewOnceViewer } from "@/components/kchat/view-once-viewer";
import type { ChatMember, ChatMessage } from "@/lib/kchat/types";
import { senderViewOnceCopy } from "@/lib/kchat/view-once";
import { cn, timeAgo } from "@/lib/utils";
import { MentionBox } from "@/components/kchat/mention-box";
import { ComposerIcon } from "@/components/kchat/composer-icon";
import { RichBody } from "@/components/kchat/rich-body";
import { ChatAppearancePanel, chatSurfaceStyle } from "@/components/kchat/chat-appearance";
import { ChatPollBubble } from "@/components/kchat/chat-poll";
import { StickerPicker } from "@/components/kchat/sticker-picker";
import { StickerBubble } from "@/components/kchat/sticker-bubble";
import { ChatAttachSheet } from "@/components/kchat/chat-attach";
import { getChatCustomization } from "@/lib/kchat/server/chat-custom";
import { disappearLabel } from "@/lib/kchat/chat-appearance";
import { NameMark } from "@/components/kchat/verified-badge";
import {
  bulkDeleteMessages,
  cancelScheduledMessage,
  channelStats,
  clearChatHistory,
  createDiscussion,
  createInviteLink,
  createTopic,
  getConversationDraft,
  joinDiscussion,
  listInviteLinks,
  listJoinRequests,
  listScheduledMessages,
  listTopics,
  resolveJoinRequest,
  revokeInviteLink,
  saveConversationDraft,
  setChannelUsername,
  setMemberAccess,
  setRecording as setRemoteRecording,
  updateLiveLocation,
} from "@/lib/kchat/server/comms";
import { formatDistance, haversineKm, newClientId, osmLink, type MessageExtra } from "@/lib/kchat/comms-extra";
import { InviteQr } from "@/components/kchat/invite-qr";
import { inviteJoinPath } from "@/lib/kchat/qr";

export const Route = createFileRoute("/_app/inbox/$id")({ component: Thread });

function Thread() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const me = useMeQuery();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [look, setLook] = useState(false);
  const [panel, setPanel] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const [chatUpload, setChatUpload] = useState<{ phase: "preparing" | "uploading" | "processing" | "ready" | "failed"; pct: number; error: string | null } | null>(null);
  const appearance = useQuery({
    queryKey: ["chat-custom", id],
    queryFn: () => getChatCustomization({ data: { conversationId: id } }),
  });
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<
    { key: string; body: string; kind: string; mediaUrl?: string | null; durationMs?: number | null; viewOnce?: boolean; failed?: boolean }[]
  >([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pickForward, setPickForward] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);
  const [onceOpen, setOnceOpen] = useState<{ url: string; kind: string } | null>(null);
  const [mediaDraft, setMediaDraft] = useState<{ url: string; kind: "photo" | "video" } | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<{ dataUrl: string; durationMs: number } | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [silent, setSilent] = useState(false);
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({
    queryKey: ["thread", id, topicId],
    queryFn: () => listMessages({ data: { conversationId: id, topicId } }),
    refetchInterval: 1500,
  });
  const others = useQuery({
    queryKey: ["inbox"],
    queryFn: () => listConversations({ data: {} }),
    enabled: pickForward,
  });

  useEffect(() => {
    setOlder([]);
    setPending([]);
    setPanel(false);
    setLook(false);
    setMediaOpen(false);
    setSelected([]);
    setPickForward(false);
    setTopicId(null);
    setQrToken(null);
  }, [id]);

  useEffect(() => {
    if (q.isSuccess) void qc.invalidateQueries({ queryKey: ["inbox-unread"] });
  }, [q.isSuccess, q.dataUpdatedAt, qc]);

  const send = useMutation({
    mutationFn: (payload: {
      body?: string;
      kind?: string;
      mediaUrl?: string | null;
      durationMs?: number | null;
      replyToId?: string | null;
      viewOnce?: boolean;
      silent?: boolean;
      clientId?: string;
      albumId?: string | null;
      extra?: MessageExtra | null;
      scheduleAt?: string | null;
      topicId?: string | null;
      key: string;
    }) =>
      sendMessage({
        data: {
          conversationId: id,
          body: payload.body ?? "",
          kind: payload.kind ?? "text",
          mediaUrl: payload.mediaUrl,
          durationMs: payload.durationMs,
          replyToId: payload.replyToId,
          viewOnce: payload.viewOnce,
          silent: payload.silent,
          clientId: payload.clientId,
          albumId: payload.albumId,
          extra: payload.extra,
          scheduleAt: payload.scheduleAt,
          topicId: payload.topicId,
        },
      }),
    onSuccess: (r, payload) => {
      setText("");
      setPending((cur) => cur.filter((p) => p.key !== payload.key));
      setScheduleAt(null);
      playNyxSound("send", me.data?.soundPrefs);
      if (r.scheduled) toast.success("Scheduled");
      void qc.invalidateQueries({ queryKey: ["thread", id] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["inbox-unread"] });
      void qc.invalidateQueries({ queryKey: ["scheduled", id] });
    },
    onError: (e, payload) => {
      setPending((cur) => cur.map((p) => (p.key === payload.key ? { ...p, failed: true } : p)));
      toast.error(e instanceof Error ? e.message : "Failed to send. Tap Retry.");
    },
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: ChatMessage[] = [];
    for (const m of [...older, ...(q.data?.items ?? [])]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [older, q.data?.items]);

  const threadGallery = useMemo(() => {
    const out: LightboxItem[] = [];
    const ids: string[] = [];
    for (const m of items) {
      const kind = isVisualMediaUrl(m.kind, m.mediaUrl);
      if (!kind || !m.mediaUrl || m.deleted || m.viewOnce) continue;
      ids.push(m.id);
      out.push({
        url: m.mediaUrl,
        kind,
        sender: m.senderName,
        at: timeAgo(m.createdAt),
      });
    }
    return { items: out, ids };
  }, [items]);

  function openChatMedia(m: ChatMessage) {
    const kind = isVisualMediaUrl(m.kind, m.mediaUrl);
    if (!kind || !m.mediaUrl) return;
    const albumIds = m.albumId ? items.filter((x) => x.albumId === m.albumId) : null;
    if (albumIds && albumIds.length > 1) {
      const album: LightboxItem[] = [];
      let index = 0;
      for (const x of albumIds) {
        const k = isVisualMediaUrl(x.kind, x.mediaUrl);
        if (!k || !x.mediaUrl || x.deleted || x.viewOnce) continue;
        if (x.id === m.id) index = album.length;
        album.push({ url: x.mediaUrl, kind: k, sender: x.senderName, at: timeAgo(x.createdAt) });
      }
      if (album.length > 0) {
        setLightbox({ items: album, index });
        return;
      }
    }
    const index = threadGallery.ids.indexOf(m.id);
    if (index >= 0) {
      setLightbox({ items: threadGallery.items, index });
      return;
    }
    setLightbox({
      items: [{ url: m.mediaUrl, kind, sender: m.senderName, at: timeAgo(m.createdAt) }],
      index: 0,
    });
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length, pending.length]);

  const lastIncoming = useRef<string | null>(null);
  useEffect(() => {
    const last = [...items].reverse().find((m) => m.senderId !== me.data?.userId);
    if (!last || last.id === lastIncoming.current) return;
    if (lastIncoming.current) playNyxSound("receive", me.data?.soundPrefs);
    lastIncoming.current = last.id;
  }, [items, me.data?.userId]);

  useEffect(() => {
    const othersTyping = (q.data?.typing.length ?? 0) > 0;
    const run = typingLoopShouldRun({
      othersTyping,
      prefsOn: me.data?.soundPrefs?.typing !== false,
      hidden: typeof document !== "undefined" && document.hidden,
    });
    if (run) startTypingLoop(me.data?.soundPrefs);
    else stopTypingLoop();
    return () => stopTypingLoop();
  }, [q.data?.typing.join("|"), me.data?.soundPrefs]);

  useEffect(() => {
    let ignore = false;
    void getConversationDraft({ data: { conversationId: id } })
      .then((d) => {
        if (!ignore && d.body && !text) setText(d.body);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [id]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void saveConversationDraft({ data: { conversationId: id, body: text } }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(t);
  }, [id, text]);

  useEffect(() => {
    void setRemoteRecording({ data: { conversationId: id, recording } }).catch(() => undefined);
  }, [id, recording]);

  useEffect(() => {
    const live = (q.data?.items ?? []).find(
      (m) => m.senderId === me.data?.userId && m.kind === "location" && m.extra?.location?.liveUntil && new Date(m.extra.location.liveUntil).getTime() > Date.now(),
    );
    if (!live) return;
    const tick = () => {
      void getCurrentPosition().then((pos) => {
        if (!pos) return;
        setHere({ lat: pos.lat, lng: pos.lng });
        void updateLiveLocation({ data: { messageId: live.id, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy } }).catch(() => undefined);
      });
    };
    tick();
    const iv = window.setInterval(tick, 12_000);
    return () => window.clearInterval(iv);
  }, [id, q.data?.items, me.data?.userId]);

  useEffect(() => {
    const on = () => {
      setPending((cur) => {
        for (const p of cur.filter((x) => x.failed)) {
          send.mutate({
            key: p.key,
            clientId: p.key,
            body: p.body,
            kind: p.kind,
            mediaUrl: p.mediaUrl,
            durationMs: p.durationMs,
            viewOnce: p.viewOnce,
            replyToId: null,
            silent,
          });
        }
        return cur.map((x) => (x.failed ? { ...x, failed: false } : x));
      });
    };
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [id, silent]);

  const convo = q.data?.conversation;
  const isGroup = convo?.kind === "group";
  const members = convo?.members ?? q.data?.members ?? [];
  const supportStaff = Boolean(convo?.supportStaff);
  const other = supportStaff
    ? members.find((m) => m.userId !== OMNI_SUPPORT_USER_ID && m.userId !== me.data?.userId)
    : members.find((m) => m.userId !== me.data?.userId);
  const title = convo?.title || other?.displayName || "Chat";
  const staff = convo?.myRole === "owner" || convo?.myRole === "admin" || supportStaff;
  const isSupport =
    members.some(
      (m) =>
        m.userId === OMNI_SUPPORT_USER_ID ||
        m.username === "omnisupport" ||
        m.username === "nyxsupport",
    ) ||
    other?.userId === OMNI_SUPPORT_USER_ID ||
    other?.username === "omnisupport" ||
    other?.username === "nyxsupport" ||
    title === "NYX Support";
  const canCommandSupport = Boolean(me.data && canAccessSafety(me.data.role, me.data.verifyKind));
  const isBroadcast = Boolean(convo?.isBroadcast);
  const canPost = !isBroadcast || staff;
  const oneWay = Boolean(isBroadcast && !canPost);
  const scheduled = useQuery({
    queryKey: ["scheduled", id],
    queryFn: () => listScheduledMessages({ data: { conversationId: id } }),
    refetchInterval: 12_000,
  });
  const topics = useQuery({
    queryKey: ["topics", id],
    queryFn: () => listTopics({ data: { conversationId: id } }),
  });

  async function call(kind: "voice" | "video") {
    const usernames = (convo?.members ?? [])
      .filter((m) => m.userId !== me.data?.userId && m.username)
      .map((m) => m.username);
    if (usernames.length === 0) {
      toast.error("No one to call.");
      return;
    }
    try {
      const r = await startCall({ data: { usernames, kind, conversationId: id } });
      nav({ to: "/call/$id", params: { id: r.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start call.");
    }
  }

  function queueSend(payload: {
    body?: string;
    kind?: string;
    mediaUrl?: string | null;
    durationMs?: number | null;
    viewOnce?: boolean;
    extra?: MessageExtra | null;
    albumId?: string | null;
    scheduleAt?: string | null;
  }) {
    const key = newClientId();
    const scheduled = payload.scheduleAt ?? scheduleAt;
    if (!scheduled) {
      setPending((cur) => [
        ...cur,
        {
          key,
          body: payload.body ?? "",
          kind: payload.kind ?? "text",
          mediaUrl: payload.mediaUrl,
          durationMs: payload.durationMs,
          viewOnce: payload.viewOnce,
        },
      ]);
    }
    if (payload.body) setText("");
    send.mutate({
      ...payload,
      key,
      clientId: key,
      silent,
      scheduleAt: scheduled,
      replyToId: replyTo?.id ?? null,
      topicId,
    });
    setReplyTo(null);
    setViewOnce(false);
    setAttachOpen(false);
    setStickerOpen(false);
    void hideKeyboard();
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    try {
      if (file.type.startsWith("video")) {
        const up = new MediaUploader();
        const unsub = up.onChange((s) => {
          setChatUpload({ phase: s.phase === "failed" ? "failed" : s.phase === "ready" ? "ready" : s.phase === "processing" ? "processing" : s.phase === "preparing" ? "preparing" : "uploading", pct: s.pct, error: s.error });
        });
        const snap = await up.pick(file, { purpose: "chat", conversationId: id });
        unsub();
        if (snap.phase !== "ready" || !snap.mediaUrl) {
          throw new Error(snap.error || "Video processing failed. Retry processing.");
        }
        setChatUpload(null);
        setMediaDraft({ url: snap.mediaUrl, kind: "video" });
        return;
      }
      if (file.type.startsWith("image")) {
        const c = await compressImage(file, { maxEdge: 1080, maxBytes: 280_000 });
        setMediaDraft({ url: c.dataUrl, kind: "photo" });
        return;
      }
      if (file.size > 400_000) {
        const up = new MediaUploader();
        const snap = await up.pick(file, { purpose: "chat", conversationId: id });
        if (snap.phase !== "ready" || !snap.mediaUrl) throw new Error(snap.error || "Could not upload this file.");
        queueSend({ body: file.name.slice(0, 80), kind: "file", mediaUrl: snap.mediaUrl });
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read file."));
        r.readAsDataURL(file);
      });
      queueSend({ body: file.name.slice(0, 80), kind: "file", mediaUrl: dataUrl });
    } catch (e) {
      setChatUpload(null);
      toast.error(e instanceof Error ? e.message : "Could not send media.");
    }
  }

  async function attachMany(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image") && f.type !== "image/gif").slice(0, 10);
    const gifs = files.filter((f) => f.type === "image/gif" || f.name.toLowerCase().endsWith(".gif"));
    const rest = files.filter((f) => !f.type.startsWith("image") || f.type === "image/gif");
    if (images.length > 1) {
      const albumId = `al_${newClientId().slice(2)}`;
      for (const file of images) {
        const c = await compressImage(file, { maxEdge: 1080, maxBytes: 280_000 });
        queueSend({ body: "", kind: "image", mediaUrl: c.dataUrl, albumId });
      }
      return;
    }
    if (images.length === 1 && rest.length === 0 && gifs.length === 0) {
      await attach(images[0]);
      return;
    }
    if (gifs.length === 1 && files.length === 1) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read file."));
        r.readAsDataURL(gifs[0]!);
      });
      queueSend({ body: "", kind: "gif", mediaUrl: dataUrl });
      return;
    }
    await attach(files[0]);
  }

  async function loadOlder() {
    const first = items[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const r = await listMessages({ data: { conversationId: id, before: first.createdAt, topicId } });
      setOlder((cur) => {
        const seen = new Set(cur.map((m) => m.id));
        return [...r.items.filter((m) => !seen.has(m.id)), ...cur];
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load earlier messages.");
    } finally {
      setLoadingOlder(false);
    }
  }

  if (q.isError) {
    const raw = (q.error as Error)?.message ?? "";
    const safe =
      raw && !/sql|postgres|column|relation|syntax|\/workspace/i.test(raw)
        ? raw
        : "Couldn't open this conversation. Please try again.";
    return (
      <div className="kc-thread grid place-items-center p-6 text-center">
        <div>
          <p className="font-medium">Couldn’t open this conversation</p>
          <p className="mt-2 text-sm text-muted">{safe}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => void q.refetch()}>
              Try again
            </Button>
            <Button onClick={() => nav({ to: "/inbox" })}>Back to inbox</Button>
          </div>
        </div>
      </div>
    );
  }

  if (q.isLoading && !q.data) {
    return (
      <div className="kc-thread">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
          <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => nav({ to: "/inbox" })} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
          <span className="flex-1 font-medium">Opening conversation…</span>
        </header>
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <p className="font-medium">Opening conversation…</p>
            <p className="mt-2 text-sm text-muted">Loading messages…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kc-thread" style={appearance.data ? chatSurfaceStyle(appearance.data) : undefined}>
      <header className="flex h-14 items-center gap-2 border-b border-border px-2">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => nav({ to: "/inbox" })} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>
        {isGroup ? (
          <button type="button" className="min-w-0 flex-1 text-left font-medium" onClick={() => setPanel((v) => !v)}>
            <span className="flex items-center gap-1.5">
              <Users className="size-4 text-atlas" />
              <span className="truncate">{title}</span>
            </span>
            <span className="block text-xs font-normal text-muted">
              {convo?.username ? `@${convo.username} · ` : ""}
              {convo?.members.length ?? 0} {isBroadcast ? "subscribers" : "members"} · {convo?.myRole ?? "member"}
            </span>
          </button>
        ) : other?.username ? (
          <Link to="/u/$username" params={{ username: other.username }} className="min-w-0 flex-1">
            <NameMark name={title} verifyKind={other.verifyKind} isArc={other.isArc} isPremium={other.isPremium} className="font-medium" />
            <span className="block text-xs font-normal text-muted">
              {isSupport ? "Official safety messages" : "Private · just the two of you"}
            </span>
          </Link>
        ) : (
          <span className="flex-1 font-medium">{title}</span>
        )}
        {!isGroup && !isSupport ? (
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => void call("voice")} aria-label="Voice call">
              <Phone className="size-5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => void call("video")} aria-label="Video call">
              <Video className="size-5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setMediaOpen((v) => !v)} aria-label="Media, links, and documents">
              <Images className="size-5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setLook((v) => !v)} aria-label="Chat appearance">
              <Settings className="size-5" />
            </Button>
          </>
        ) : isGroup ? (
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => void call("voice")} aria-label="Group voice call">
              <Phone className="size-5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => void call("video")} aria-label="Group video call">
              <Video className="size-5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setMediaOpen((v) => !v)} aria-label="Media, links, and documents">
              <Images className="size-5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setLook((v) => !v)} aria-label="Chat appearance">
              <Sparkles className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setPanel((v) => !v)}
              aria-label="Group settings"
            >
              <Settings className="size-5" />
            </Button>
            {isBroadcast && convo?.linkedDiscussionId ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Discussion"
                onClick={() =>
                  void joinDiscussion({ data: { conversationId: id } })
                    .then((r) => nav({ to: "/inbox/$id", params: { id: r.id } }))
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't open discussion."))
                }
              >
                <Reply className="size-5" />
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => setMediaOpen((v) => !v)} aria-label="Media, links, and documents">
              <Images className="size-5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setLook((v) => !v)} aria-label="Chat appearance">
              <Settings className="size-5" />
            </Button>
          </>
        )}
      </header>
      {appearance.data?.disappearingEnabled ? (
        <p className="bg-black/25 px-3 py-1 text-center text-[11px] text-fg">
          Disappearing messages · {disappearLabel(appearance.data.disappearingDurationSec)}
        </p>
      ) : null}
      {q.data?.pinned && q.data.pinned.length > 0 ? (
        <button
          type="button"
          className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2 text-left text-xs"
          onClick={() => {
            const el = document.getElementById(`msg-${q.data!.pinned![0]!.id}`);
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        >
          <span className="font-medium">Pinned</span>
          <span className="truncate text-muted">{q.data.pinned[0]!.body || q.data.pinned[0]!.kind}</span>
        </button>
      ) : null}
      {(topics.data ?? []).length > 0 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2">
          <button
            type="button"
            className={cn("shrink-0 rounded-full px-3 py-1 text-xs", !topicId ? "bg-accent text-accent-fg" : "bg-elevated")}
            onClick={() => setTopicId(null)}
          >
            All
          </button>
          {topics.data!.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn("shrink-0 rounded-full px-3 py-1 text-xs", topicId === t.id ? "bg-accent text-accent-fg" : "bg-elevated")}
              onClick={() => setTopicId(t.id)}
            >
              {t.icon ? `${t.icon} ` : ""}
              {t.title}
            </button>
          ))}
        </div>
      ) : null}
      {look ? (
        <div className="max-h-[55%] overflow-y-auto border-b border-border bg-surface">
          <ChatAppearancePanel conversationId={id} />
          <div className="px-4 pb-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() =>
                void clearChatHistory({ data: { conversationId: id } })
                  .then((r) => {
                    toast.success(`Cleared ${r.n} messages for you`);
                    void q.refetch();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't clear."))
              }
            >
              Clear chat for me
            </Button>
          </div>
        </div>
      ) : null}
      {mediaOpen ? (
        <ChatMediaPanel
          conversationId={id}
          onClose={() => setMediaOpen(false)}
          onJump={(messageId) => {
            setMediaOpen(false);
            window.setTimeout(() => {
              document.getElementById(`msg-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 50);
          }}
        />
      ) : null}
      {panel && isGroup && convo ? (
        <GroupPanel
          conversationId={id}
          title={convo.title}
          myRole={convo.myRole}
          members={convo.members}
          staff={staff}
          isBroadcast={isBroadcast}
          username={convo.username ?? null}
          linkedDiscussionId={convo.linkedDiscussionId ?? null}
          qrToken={qrToken}
          onQr={setQrToken}
          onSelectTopic={(tid) => {
            setTopicId(tid);
            setPanel(false);
          }}
          onChanged={() => void q.refetch()}
          onLeave={() => nav({ to: "/inbox" })}
        />
      ) : null}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {q.data?.hasMore || older.length > 0 ? (
          <div className="flex justify-center">
            <Button size="sm" variant="ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "Loading…" : "Earlier messages"}
            </Button>
          </div>
        ) : null}
        {items.length === 0 && pending.length === 0 && !q.isLoading ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="font-medium">Start a conversation</p>
              <p className="mt-2 text-sm text-muted">
                {isGroup
                  ? `“${title}” is ready. Owners and admins can rename, add people, and promote admins.`
                  : `Private chat with ${title}. Only the two of you can see this. Type below — it sends to them, not a feed.`}
              </p>
            </div>
          </div>
        ) : null}
        {items.map((m) => {
          const mine =
            m.senderId === me.data?.userId ||
            (supportStaff && m.senderId === OMNI_SUPPORT_USER_ID);
          const omni = m.senderId === OMNI_AI_USER_ID;
          if (!m.deleted && m.kind === "flash") {
            return (
              <div key={m.id} className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
                <Link
                  to="/flash/$id"
                  params={{ id: m.body }}
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3 py-3 text-left",
                    mine ? "rounded-br-md bg-capture text-accent-fg" : "rounded-bl-md bg-elevated text-fg ring-1 ring-ai",
                  )}
                >
                  <p className="text-sm font-medium">Flash</p>
                  <p className="mt-0.5 text-xs opacity-80">{mine ? "Sent · they open once" : "Tap to open once"}</p>
                  <div className={cn("mt-1 text-[10px] tabular-nums", mine ? "opacity-70" : "opacity-80")}>
                    {timeAgo(m.createdAt)}
                  </div>
                </Link>
              </div>
            );
          }
          return (
            <SwipeReply
              key={m.id}
              onReply={() => {
                setReplyTo(m);
                setMenuId(null);
              }}
            >
            <div id={`msg-${m.id}`} className={cn("flex w-full flex-col", mine ? "items-end" : "items-start")}>
              <button
                type="button"
                onClick={() => setMenuId((cur) => (cur === m.id ? null : m.id))}
                className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3 py-2 text-left text-sm",
                    mine
                      ? "kc-msg-out rounded-br-md text-white"
                      : omni
                        ? "rounded-bl-md bg-ai/15 text-fg ring-1 ring-ai"
                        : isSupport
                          ? "kc-msg-in rounded-bl-md bg-atlas/15 text-fg"
                          : "kc-msg-in rounded-bl-md bg-elevated text-fg",
                    selected.includes(m.id) && "ring-2 ring-ai",
                  )}
                >
                  {omni || (isGroup && !mine) ? (
                    <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium opacity-80">
                      {omni ? <Sparkles className="size-3 text-ai" /> : null}
                      <NameMark
                        name={m.senderName}
                        verifyKind={omni ? "org" : convo?.members.find((x) => x.userId === m.senderId)?.verifyKind}
                        isArc={omni ? false : convo?.members.find((x) => x.userId === m.senderId)?.isArc}
                        isPremium={omni ? false : convo?.members.find((x) => x.userId === m.senderId)?.isPremium}
                      />
                    </p>
                  ) : null}
                  {m.viewOnce ? (
                    <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-80">
                      <Eye className="size-3" />
                      {mine ? senderViewOnceCopy(m.viewOnceState ?? "UNOPENED") : m.body}
                    </p>
                  ) : null}
                  {m.forwarded ? (
                    <p className="mb-1 text-[10px] uppercase tracking-wide opacity-70">
                      Forwarded{m.forwardedFrom ? ` · ${m.forwardedFrom}` : ""}
                    </p>
                  ) : null}
                  {m.expiresAt ? (
                    <p className="mb-1 text-[10px] uppercase tracking-wide opacity-70">
                      Disappears {remainLabel(m.expiresAt)}
                    </p>
                  ) : null}
                  {m.replyToId ? (
                    <button
                      type="button"
                      className="mb-1 w-full truncate border-l-2 border-current/40 pl-2 text-left text-[11px] opacity-70"
                      onClick={(e) => {
                        e.stopPropagation();
                        const el = document.getElementById(`msg-${m.replyToId}`);
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                        el?.classList.add("kc-flash");
                        window.setTimeout(() => el?.classList.remove("kc-flash"), 800);
                      }}
                    >
                      {quotePreview(items.find((x) => x.id === m.replyToId))}
                    </button>
                  ) : null}
                  {m.deleted ? (
                    <span className="italic opacity-70">Message deleted</span>
                  ) : m.viewOnce ? (
                    m.kind === "voice" && !mine ? (
                      m.opened || m.viewOnceState === "CONSUMED" ? (
                        <p className="text-xs opacity-80">Played once. This voice note isn’t available again.</p>
                      ) : (
                        <button
                          type="button"
                          className="mt-1 rounded-xl bg-black/20 px-3 py-3 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openViewOnce({ data: { id: m.id } })
                              .then((r) => {
                                if (r.mediaUrl) setOnceOpen({ url: r.mediaUrl, kind: r.kind });
                                void q.refetch();
                              })
                              .catch((err) => toast.error(err instanceof Error ? err.message : "Already opened."));
                          }}
                        >
                          Play once
                        </button>
                      )
                    ) : null
                  ) : m.kind === "voice" && m.mediaUrl ? (
                    <VoiceBubble src={m.mediaUrl} durationMs={m.durationMs ?? 0} mine={mine} />
                  ) : m.kind === "file" && m.mediaUrl ? (
                    <a href={mediaSrc(m.mediaUrl)} download={m.body || "file"} className="mt-1 inline-flex items-center gap-1 underline">
                      <FileText className="size-3.5" />
                      {m.body || "Document"}
                    </a>
                  ) : m.kind === "gift" ? (
                    <p className="text-sm">
                      Sent a {m.body || "gift"} {m.mediaUrl === "rose" ? "🌹" : m.mediaUrl === "heart" ? "❤️" : m.mediaUrl === "sparkle" ? "✨" : m.mediaUrl === "crown" ? "👑" : "🎁"}
                    </p>
                  ) : m.kind === "poll" && m.extra?.poll?.id ? (
                    <ChatPollBubble pollId={m.extra.poll.id} mine={mine} onChanged={() => void q.refetch()} />
                  ) : m.kind === "location" && m.extra?.location ? (
                    <a
                      href={osmLink(m.extra.location.lat, m.extra.location.lng)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block rounded-xl bg-black/10 px-3 py-2 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="inline-flex items-center gap-1 font-medium">
                        <MapPin className="size-3.5" />
                        {m.extra.location.liveUntil && new Date(m.extra.location.liveUntil).getTime() > Date.now()
                          ? "Live location"
                          : "Location"}
                      </span>
                      <p className="mt-0.5 text-[11px] opacity-80">
                        {m.extra.location.lat.toFixed(4)}, {m.extra.location.lng.toFixed(4)}
                        {here ? ` · ${formatDistance(haversineKm(here, m.extra.location))}` : ""}
                      </p>
                    </a>
                  ) : m.kind === "contact" && m.extra?.contact ? (
                    <Link
                      to="/u/$username"
                      params={{ username: m.extra.contact.username }}
                      className="mt-1 flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Avatar src={m.extra.contact.avatarUrl} name={m.extra.contact.displayName} size="sm" />
                      <span>
                        <span className="block text-sm font-medium">{m.extra.contact.displayName}</span>
                        <span className="text-[11px] opacity-80">@{m.extra.contact.username}</span>
                      </span>
                    </Link>
                  ) : m.kind === "sticker" ? (
                    <StickerBubble
                      packId={m.extra?.sticker?.packId}
                      stickerId={m.extra?.sticker?.stickerId}
                      mediaUrl={m.mediaUrl}
                      name={m.extra?.sticker?.name || m.extra?.sticker?.emoji}
                      mediaKind={m.extra?.sticker?.mediaKind}
                    />
                  ) : (
                    <>
                      <RichBody text={m.body} />
                      {m.extra?.linkPreview ? (
                        <button
                          type="button"
                          className="mt-2 block w-full overflow-hidden rounded-xl bg-black/10 text-left"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openExternalUrl(m.extra!.linkPreview!.url);
                          }}
                        >
                          {m.extra.linkPreview.imageUrl ? (
                            <img src={m.extra.linkPreview.imageUrl} alt="" className="max-h-32 w-full object-cover" referrerPolicy="no-referrer" />
                          ) : null}
                          <span className="block px-3 py-2">
                            <span className="block text-sm font-medium">{m.extra.linkPreview.title || m.extra.linkPreview.domain}</span>
                            {m.extra.linkPreview.description ? (
                              <span className="mt-0.5 line-clamp-2 text-[11px] opacity-80">{m.extra.linkPreview.description}</span>
                            ) : null}
                            <span className="mt-0.5 block text-[10px] uppercase tracking-wide opacity-60">{m.extra.linkPreview.domain}</span>
                          </span>
                        </button>
                      ) : null}
                    </>
                  )}
                  {!m.deleted && m.viewOnce && m.kind !== "voice" && !mine && !m.mediaUrl ? (
                    m.opened || m.viewOnceState === "CONSUMED" ? (
                      <p className="mt-1 text-xs opacity-80">
                        Opened. This isn’t available again. This browser cannot block screenshots.
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="mt-2 rounded-xl bg-black/20 px-3 py-6 text-center text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openViewOnce({ data: { id: m.id } })
                            .then((r) => {
                              if (r.mediaUrl) setOnceOpen({ url: r.mediaUrl, kind: r.kind });
                              void q.refetch();
                            })
                            .catch((err) => toast.error(err instanceof Error ? err.message : "Already opened."));
                        }}
                      >
                        Tap to open once
                      </button>
                    )
                  ) : !m.deleted && !m.viewOnce && m.mediaUrl && isVisualMediaUrl(m.kind, m.mediaUrl) ? (
                    <div
                      className="kc-chat-media mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        openChatMedia(m);
                      }}
                    >
                      {isVisualMediaUrl(m.kind, m.mediaUrl) === "video" ? (
                        <>
                          <video
                            src={mediaSrc(m.mediaUrl)}
                            preload="metadata"
                            playsInline
                            muted
                          />
                          <span className="kc-media-play" aria-hidden="true" />
                        </>
                      ) : (
                        <img src={mediaSrc(m.mediaUrl)} alt="" />
                      )}
                    </div>
                  ) : null}
                  <div className={cn("mt-1 text-[10px] tabular-nums", mine ? "opacity-70" : "text-subtle")}>
                    {timeAgo(m.createdAt)}
                    {m.editedAt ? " · Edited" : ""}
                    {m.silent ? " · Silent" : ""}
                    {mine ? (m.read ? " · Read" : " · Sent") : ""}
                  </div>
                  {m.reactions.length > 0 ? (
                    <div className="mt-1 flex gap-1 text-[11px]">
                      {m.reactions.map((r) => (
                        <span key={r.emoji}>
                          {r.emoji} {r.count}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </button>
              {menuId === m.id ? (
                <div className="mt-1 w-[min(100%,20rem)]">
                  <MessageMenu
                    message={m}
                    mine={mine}
                    conversationId={id}
                    onClose={() => setMenuId(null)}
                    onChanged={() => void q.refetch()}
                    onReply={() => {
                      setReplyTo(m);
                      setMenuId(null);
                    }}
                    onSelect={() =>
                      setSelected((cur) => (cur.includes(m.id) ? cur.filter((x) => x !== m.id) : [...cur, m.id]))
                    }
                  />
                </div>
              ) : null}
            </div>
            </SwipeReply>
          );
        })}
        {pending.map((p) => (
          <div key={p.key} className="flex w-full justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm text-accent-fg opacity-70">
              {p.viewOnce
                ? "View Once media sent"
                : p.body || (p.kind === "image" ? "Photo" : p.kind === "video" ? "Video" : p.kind === "file" ? "Document" : "Sending…")}
              {!p.viewOnce && p.mediaUrl && (p.kind === "image" || p.mediaUrl.startsWith("data:image")) ? (
                <div
                  className="kc-chat-media mt-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightbox({
                      items: [{ url: p.mediaUrl!, kind: "image" }],
                      index: 0,
                    });
                  }}
                >
                  <img src={p.mediaUrl} alt="" />
                </div>
              ) : !p.viewOnce && p.mediaUrl && (p.kind === "video" || p.mediaUrl.startsWith("data:video")) ? (
                <div
                  className="kc-chat-media mt-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightbox({
                      items: [{ url: p.mediaUrl!, kind: "video" }],
                      index: 0,
                    });
                  }}
                >
                  <video src={p.mediaUrl} preload="metadata" playsInline muted />
                  <span className="kc-media-play" aria-hidden="true" />
                </div>
              ) : null}
              <div className="mt-1 text-[10px] tabular-nums opacity-70">{p.failed ? "Not sent" : "Sending…"}</div>
              {p.failed ? (
                <button
                  type="button"
                  className="mt-1 text-[11px] underline"
                  onClick={() => {
                    setPending((cur) => cur.map((x) => (x.key === p.key ? { ...x, failed: false } : x)));
                    send.mutate({
                      key: p.key,
                      body: p.body,
                      kind: p.kind,
                      mediaUrl: p.mediaUrl,
                      durationMs: p.durationMs,
                      viewOnce: p.viewOnce,
                      replyToId: null,
                    });
                  }}
                >
                  Retry
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {(q.data?.typing.length ?? 0) > 0 ? (
          <p className="px-1 text-xs text-accent">{q.data!.typing.join(", ")} is typing…</p>
        ) : null}
        {(q.data?.recording ?? []).length > 0 ? (
          <p className="px-1 text-xs text-accent">{q.data!.recording.join(", ")} is recording…</p>
        ) : null}
        <div ref={bottom} />
      </div>
      {oneWay || !canPost ? (
        <div className="border-t border-border px-4 py-5 text-center" data-testid="omnisupport-oneway">
          <p className="text-sm font-medium">Channel</p>
          <p className="mt-1 text-xs text-muted">Only admins can post in this channel.</p>
        </div>
      ) : (
      <form
        className="kc-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) queueSend({ body: text, kind: "text" });
        }}
      >
        {selected.length > 0 ? (
          <div className="mb-2 rounded-xl bg-elevated px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span>{selected.length} selected</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPickForward((v) => !v)}>
                  Forward
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void bulkDeleteMessages({ data: { ids: selected, scope: "me" } }).then(() => {
                      setSelected([]);
                      void q.refetch();
                    })
                  }
                >
                  Delete for me
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setSelected([]); setPickForward(false); }}>
                  Cancel
                </Button>
              </div>
            </div>
            {pickForward ? (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                <button
                  type="button"
                  className="block w-full truncate rounded-lg px-2 py-1.5 text-left hover:bg-surface"
                  onClick={() => {
                    const first = items.find((m) => m.id === selected[0]);
                    if (!first) return;
                    try {
                      sessionStorage.setItem("omni-create-tab", "story");
                      sessionStorage.setItem(
                        "omni-create-draft",
                        JSON.stringify({
                          body: first.body,
                          mediaUrl: first.mediaUrl,
                          kind: first.kind,
                        }),
                      );
                    } catch {
                      /* ignore */
                    }
                    nav({ to: "/create" });
                  }}
                >
                  My Story
                </button>
                <button
                  type="button"
                  className="block w-full truncate rounded-lg px-2 py-1.5 text-left hover:bg-surface"
                  onClick={() => {
                    const first = items.find((m) => m.id === selected[0]);
                    if (!first) return;
                    try {
                      sessionStorage.setItem("omni-create-tab", "status");
                      sessionStorage.setItem(
                        "omni-create-draft",
                        JSON.stringify({
                          body: first.body,
                          mediaUrl: first.mediaUrl,
                          kind: first.kind,
                        }),
                      );
                    } catch {
                      /* ignore */
                    }
                    nav({ to: "/create" });
                  }}
                >
                  My Status
                </button>
                {(others.data ?? [])
                  .filter((c) => c.id !== id)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="block w-full truncate rounded-lg px-2 py-1.5 text-left hover:bg-surface"
                      onClick={() =>
                        void Promise.all(
                          selected
                            .filter((mid) => !items.find((x) => x.id === mid)?.viewOnce)
                            .map((mid) => forwardMessage({ data: { id: mid, conversationIds: [c.id] } })),
                        )
                          .then(() => {
                            toast.success(`Forwarded to ${c.title}`);
                            setSelected([]);
                            setPickForward(false);
                          })
                          .catch((e) => toast.error(e instanceof Error ? e.message : "Could not forward."))
                      }
                    >
                      {c.title}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {replyTo ? (
          <div className="mb-2 flex items-center justify-between rounded-xl bg-elevated px-3 py-2 text-xs">
            <span className="truncate">Replying to {replyTo.senderName}: {replyTo.body.slice(0, 40)}</span>
            <button type="button" onClick={() => setReplyTo(null)} className="text-muted">
              ×
            </button>
          </div>
        ) : null}
        {scheduleAt ? (
          <div className="mb-2 flex items-center justify-between rounded-xl bg-elevated px-3 py-2 text-xs">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              Scheduled {new Date(scheduleAt).toLocaleString()}
            </span>
            <button type="button" onClick={() => setScheduleAt(null)} className="text-muted">
              ×
            </button>
          </div>
        ) : null}
        {silent ? <p className="mb-2 text-[11px] text-muted">Silent send is on — they won’t get a notification sound.</p> : null}
        {(scheduled.data ?? []).length > 0 ? (
          <div className="mb-2 rounded-xl bg-elevated px-3 py-2 text-xs">
            <p className="font-medium">{scheduled.data!.length} scheduled</p>
            {scheduled.data!.slice(0, 3).map((s) => (
              <div key={s.id} className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate">{s.body || s.kind} · {new Date(s.send_at).toLocaleString()}</span>
                <button
                  type="button"
                  className="text-danger"
                  onClick={() => void cancelScheduledMessage({ data: { id: s.id } }).then(() => scheduled.refetch())}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {chatUpload ? (
          <div className="mb-2">
            <UploadProgress
              phase={chatUpload.phase}
              pct={chatUpload.pct}
              error={chatUpload.error}
            />
          </div>
        ) : null}
        {recording ? (
          <VoiceRecorder
            onSend={(p) => {
              setRecording(false);
              playNyxSound("recordStop", me.data?.soundPrefs);
              setVoiceDraft(p);
            }}
            onCancel={() => setRecording(false)}
          />
        ) : (
          <div className="kc-composer-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*,image/gif,.gif,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,text/plain"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                if (list.length > 1) void attachMany(list);
                else void attach(list[0]);
              }}
            />
            <Link to="/capture" className="kc-composer-icon" aria-label="Camera">
              <span className="kc-composer-icon-glyph">
                <Camera className="kc-composer-icon-svg" strokeWidth={1.75} />
              </span>
            </Link>
            <GiftSheet
              conversationId={id}
              recipientUsername={other?.username}
              triggerClassName="kc-composer-icon"
              onSent={() => {
                void qc.invalidateQueries({ queryKey: ["thread", id] });
                void qc.invalidateQueries({ queryKey: ["coin-wallet"] });
              }}
            />
            <ComposerIcon label="Photo, video, or document" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="kc-composer-icon-svg" strokeWidth={1.75} />
            </ComposerIcon>
            <ComposerIcon label="Stickers" pressed={stickerOpen} onClick={() => { setStickerOpen((v) => !v); setAttachOpen(false); setEmojiOpen(false); }}>
              <Sticker className="kc-composer-icon-svg" strokeWidth={1.75} />
            </ComposerIcon>
            <ComposerIcon label="More" pressed={attachOpen} onClick={() => { setAttachOpen((v) => !v); setStickerOpen(false); setEmojiOpen(false); }}>
              <Paperclip className="kc-composer-icon-svg" strokeWidth={1.75} />
            </ComposerIcon>
            <div className="kc-composer-field">
              <ComposerIcon
                label="Emoji"
                pressed={emojiOpen}
                className="kc-composer-icon-infield"
                onClick={() => setEmojiOpen((v) => !v)}
              >
                <Smile className="kc-composer-icon-svg" strokeWidth={1.75} />
              </ComposerIcon>
              <div className="min-w-0 flex-1">
                <MentionBox
                  variant="composer"
                  value={text}
                  onChange={(next) => {
                    setText(next);
                    void setTyping({ data: { conversationId: id } });
                  }}
                  placeholder={
                    isGroup
                      ? "Message"
                      : isSupport
                        ? supportStaff || canCommandSupport
                          ? "Reply as NYX Support"
                          : "Message NYX Support"
                        : "Message"
                  }
                  minHeightClass="min-h-10"
                  onSubmit={() => {
                    if (text.trim()) queueSend({ body: text, kind: "text" });
                  }}
                />
              </div>
            </div>
            {text.trim() ? (
              <ComposerIcon tone="send" label="Send" type="submit">
                <Send className="kc-composer-icon-svg" strokeWidth={1.9} />
              </ComposerIcon>
            ) : (
              <VoiceButton className="kc-composer-icon-record" onStart={() => { playNyxSound("record", me.data?.soundPrefs); setRecording(true); }} />
            )}
          </div>
        )}
        {emojiOpen ? (
          <div className="mt-2">
            <EmojiPicker
              onPick={(e) => {
                setText((t) => t + e);
                setEmojiOpen(false);
              }}
            />
          </div>
        ) : null}
        {stickerOpen ? (
          <div className="mt-2">
            <StickerPicker
              onPick={(s) =>
                queueSend({
                  body: s.name || s.emoji,
                  kind: "sticker",
                  mediaUrl: s.url || null,
                  extra: {
                    sticker: {
                      packId: s.packId,
                      stickerId: s.stickerId,
                      emoji: s.emoji,
                      name: s.name,
                      mediaKind: s.mediaKind,
                    },
                  },
                })
              }
            />
          </div>
        ) : null}
        {attachOpen ? (
          <div className="mt-2">
            <ChatAttachSheet
              silent={silent}
              onSilent={setSilent}
              onPoll={(poll) => queueSend({ kind: "poll", extra: { poll } })}
              onLocation={(loc) => queueSend({ kind: "location", extra: { location: loc } })}
              onContact={(c) => queueSend({ kind: "contact", extra: { contact: c } })}
              onSchedule={(iso) => {
                setScheduleAt(iso);
                setAttachOpen(false);
                toast.success("Time saved. Send to schedule it.");
              }}
              onClose={() => setAttachOpen(false)}
            />
          </div>
        ) : null}
      </form>
      )}
      {voiceDraft ? (
        <div className="fixed inset-x-0 bottom-0 z-40 space-y-3 border-t border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="text-sm font-medium">Voice note preview</p>
          <audio src={voiceDraft.dataUrl} controls className="w-full" />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={viewOnce} onChange={(e) => setViewOnce(e.target.checked)} />
            View once — they can play this one time. This browser cannot block recordings of the speaker.
          </label>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                queueSend({ body: "", kind: "voice", mediaUrl: voiceDraft.dataUrl, durationMs: voiceDraft.durationMs, viewOnce });
                setVoiceDraft(null);
                setViewOnce(false);
              }}
            >
              Send
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setVoiceDraft(null);
                setViewOnce(false);
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      ) : null}
      {mediaDraft ? (
        <div className="fixed inset-0 z-50">
          <MediaComposer
            url={mediaSrc(mediaDraft.url) || mediaDraft.url}
            kind={mediaDraft.kind}
            allowViewOnce
            title="Send"
            commitLabel="Send"
            onClose={() => setMediaDraft(null)}
            onCommit={(res) => {
              queueSend({
                body: res.caption,
                kind: res.kind === "video" ? "video" : "image",
                mediaUrl: mediaDraft.url,
                viewOnce: res.viewOnce,
              });
              setMediaDraft(null);
            }}
          />
        </div>
      ) : null}
      {onceOpen ? <ViewOnceViewer url={onceOpen.url} kind={onceOpen.kind} onClose={() => setOnceOpen(null)} /> : null}
      <ImageLightbox
        items={lightbox?.items}
        index={lightbox?.index ?? 0}
        onIndexChange={(i) => setLightbox((cur) => (cur ? { ...cur, index: i } : cur))}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}

function quotePreview(m?: ChatMessage): string {
  if (!m) return "Reply";
  const snippet = m.body || (m.kind === "image" ? "Photo" : m.kind === "video" ? "Video" : m.kind === "voice" ? "Voice message" : m.kind);
  return `${m.senderName}: ${snippet}`;
}

function remainLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  if (ms < 60_000) return `in ${Math.ceil(ms / 1000)}s`;
  if (ms < 3_600_000) return `in ${Math.ceil(ms / 60_000)}m`;
  if (ms < 86_400_000) return `in ${Math.ceil(ms / 3_600_000)}h`;
  return `in ${Math.ceil(ms / 86_400_000)}d`;
}

function SwipeReply({ children, onReply }: { children: ReactNode; onReply: () => void }) {
  const startX = useRef(0);
  const startY = useRef(0);
  const [dx, setDx] = useState(0);
  const axis = useRef<"h" | "v" | null>(null);
  return (
    <div
      className="relative w-full"
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx === 0 ? "transform 160ms ease" : undefined }}
      onTouchStart={(e) => {
        const t = e.changedTouches[0]!;
        startX.current = t.clientX;
        startY.current = t.clientY;
        axis.current = null;
      }}
      onTouchMove={(e) => {
        const t = e.changedTouches[0]!;
        const x = t.clientX - startX.current;
        const y = t.clientY - startY.current;
        if (!axis.current) {
          if (Math.abs(x) > 12 && Math.abs(x) > Math.abs(y)) axis.current = "h";
          else if (Math.abs(y) > 12) axis.current = "v";
        }
        if (axis.current === "h") setDx(Math.min(72, Math.max(0, x)));
      }}
      onTouchEnd={() => {
        if (dx > 48) onReply();
        setDx(0);
        axis.current = null;
      }}
    >
      {dx > 16 ? (
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-atlas" aria-hidden>
          <Reply className="size-4" />
        </span>
      ) : null}
      {children}
    </div>
  );
}

function GroupPanel({
  conversationId,
  title,
  myRole,
  members,
  staff,
  isBroadcast,
  username,
  linkedDiscussionId,
  qrToken,
  onQr,
  onSelectTopic,
  onChanged,
  onLeave,
}: {
  conversationId: string;
  title: string;
  myRole: "owner" | "admin" | "member";
  members: ChatMember[];
  staff: boolean;
  isBroadcast?: boolean;
  username?: string | null;
  linkedDiscussionId?: string | null;
  qrToken?: string | null;
  onQr?: (token: string | null) => void;
  onSelectTopic?: (id: string | null) => void;
  onChanged: () => void;
  onLeave: () => void;
}) {
  const nav = useNavigate();
  const [name, setName] = useState(title);
  const [q, setQ] = useState("");
  const [topicTitle, setTopicTitle] = useState("");
  const [chanUser, setChanUser] = useState(username ?? "");
  const search = useQuery({
    queryKey: ["search", q],
    queryFn: () => globalSearch({ data: { q } }),
    enabled: q.trim().length > 0 && staff,
  });
  const invites = useQuery({
    queryKey: ["invites", conversationId],
    queryFn: () => listInviteLinks({ data: { conversationId } }),
    enabled: staff,
  });
  const topics = useQuery({
    queryKey: ["topics", conversationId],
    queryFn: () => listTopics({ data: { conversationId } }),
  });
  const requests = useQuery({
    queryKey: ["join-requests", conversationId],
    queryFn: () => listJoinRequests({ data: { conversationId } }),
    enabled: staff,
  });
  const stats = useQuery({
    queryKey: ["channel-stats", conversationId],
    queryFn: () => channelStats({ data: { conversationId } }),
    enabled: staff && Boolean(isBroadcast),
  });

  return (
    <div className="border-b border-border bg-surface px-4 py-3">
      {staff ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void renameGroup({ data: { conversationId, title: name } })
              .then(onChanged)
              .catch((err) => toast.error(err instanceof Error ? err.message : "Could not rename."));
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Button type="submit" size="sm" variant="secondary">
            Rename
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted">You’re a member. The owner and admins manage the group.</p>
      )}
      <ul className="mt-3 space-y-2">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2">
            <Avatar src={m.avatarUrl} name={m.displayName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <NameMark name={m.displayName} verifyKind={m.verifyKind} isArc={m.isArc} isPremium={m.isPremium} />
              </p>
              <p className="text-xs capitalize text-muted">
                {m.role}
                {m.restricted ? " · restricted" : ""}
                {m.banned ? " · banned" : ""}
              </p>
            </div>
            {myRole === "owner" && m.role !== "owner" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void setGroupRole({
                    data: {
                      conversationId,
                      username: m.username,
                      role: m.role === "admin" ? "member" : "admin",
                    },
                  }).then(onChanged)
                }
              >
                {m.role === "admin" ? "Demote" : "Make admin"}
              </Button>
            ) : null}
            {staff && m.role !== "owner" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void removeGroupMember({ data: { conversationId, username: m.username } }).then(onChanged)
                }
              >
                Remove
              </Button>
            ) : null}
            {staff && m.role !== "owner" && m.username ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void setMemberAccess({
                      data: {
                        conversationId,
                        username: m.username,
                        action: m.restricted ? "unrestrict" : "restrict",
                      },
                    })
                      .then(onChanged)
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't update."))
                  }
                >
                  {m.restricted ? "Unrestrict" : "Restrict"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void setMemberAccess({
                      data: {
                        conversationId,
                        username: m.username,
                        action: m.banned ? "unban" : "ban",
                      },
                    })
                      .then(onChanged)
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't update."))
                  }
                >
                  {m.banned ? "Unban" : "Ban"}
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {staff ? (
        <div className="mt-3">
          <Input placeholder="Add by username" value={q} onChange={(e) => setQ(e.target.value)} />
          {(search.data?.users ?? []).slice(0, 5).map((u) => (
            <button
              key={u.userId}
              type="button"
              className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-elevated"
              onClick={() =>
                void addGroupMembers({ data: { conversationId, usernames: [u.username] } })
                  .then(() => {
                    setQ("");
                    onChanged();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Could not add."))
              }
            >
              <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
              <span className="min-w-0">
                Add <NameMark name={u.displayName} verifyKind={u.verifyKind} isArc={u.isArc} isPremium={u.isPremium} className="inline-flex" />
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {staff ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium">{isBroadcast ? "Channel invite links" : "Invite links"}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void createInviteLink({ data: { conversationId } })
                  .then((r) => {
                    const url = `${window.location.origin}${inviteJoinPath(r.token)}`;
                    void navigator.clipboard.writeText(url).then(() => toast.success("Invite link copied"));
                    void invites.refetch();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't create link."))
              }
            >
              New link
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void createInviteLink({ data: { conversationId, expiresHours: 24, maxUses: 50 } })
                  .then((r) => {
                    const url = `${window.location.origin}${inviteJoinPath(r.token)}`;
                    void navigator.clipboard.writeText(url);
                    toast.success("24-hour link copied");
                    void invites.refetch();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't create link."))
              }
            >
              24h / 50 uses
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void createInviteLink({ data: { conversationId, requireApproval: true } })
                  .then((r) => {
                    const url = `${window.location.origin}${inviteJoinPath(r.token)}`;
                    void navigator.clipboard.writeText(url);
                    toast.success("Approval link copied");
                    void invites.refetch();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't create link."))
              }
            >
              Needs approval
            </Button>
          </div>
          {(invites.data ?? []).filter((l) => !l.revoked_at).map((l) => (
            <div key={l.id} className="space-y-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="truncate text-atlas"
                  onClick={() => {
                    const url = `${window.location.origin}${inviteJoinPath(l.token)}`;
                    void navigator.clipboard.writeText(url).then(() => toast.success("Copied"));
                  }}
                >
                  /join/{l.token.slice(0, 8)}… · {l.use_count}{l.max_uses ? `/${l.max_uses}` : ""} used
                  {l.require_approval ? " · approval" : ""}
                </button>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onQr?.(qrToken === l.token ? null : l.token)}>
                    QR
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void revokeInviteLink({ data: { id: l.id } }).then(() => invites.refetch())}>
                    Revoke
                  </Button>
                </div>
              </div>
              {qrToken === l.token ? (
                <InviteQr value={`${window.location.origin}${inviteJoinPath(l.token)}`} label="Scan to join" />
              ) : null}
            </div>
          ))}
          {isBroadcast && myRole === "owner" ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void setChannelUsername({ data: { conversationId, username: chanUser.trim() || null } })
                  .then((r) => {
                    toast.success(r.username ? `@${r.username} saved` : "Public username removed");
                    onChanged();
                  })
                  .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't save username."));
              }}
            >
              <Input value={chanUser} onChange={(e) => setChanUser(e.target.value)} placeholder="public username" maxLength={20} />
              <Button type="submit" size="sm" variant="secondary">
                @
              </Button>
            </form>
          ) : username ? (
            <p className="text-xs text-muted">Public: @{username}</p>
          ) : null}
          {isBroadcast && staff && stats.data ? (
            <p className="text-xs text-muted">
              {stats.data.subscribers} subscribers · {stats.data.posts} posts · {stats.data.posts7d} this week · {stats.data.reactions} reactions
            </p>
          ) : null}
          {isBroadcast && staff ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void (linkedDiscussionId
                  ? joinDiscussion({ data: { conversationId } })
                  : createDiscussion({ data: { conversationId } }))
                  .then((r) => nav({ to: "/inbox/$id", params: { id: r.id } }))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't open discussion."))
              }
            >
              {linkedDiscussionId ? "Open discussion" : "Create discussion group"}
            </Button>
          ) : null}
          {(requests.data ?? []).length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium">Join requests</p>
              {requests.data!.map((r) => (
                <div key={r.userId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{r.displayName} @{r.username}</span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void resolveJoinRequest({ data: { conversationId, userId: r.userId, approve: true } })
                          .then(() => {
                            void requests.refetch();
                            onChanged();
                          })
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void resolveJoinRequest({ data: { conversationId, userId: r.userId, approve: false } }).then(() => requests.refetch())
                      }
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void createTopic({ data: { conversationId, title: topicTitle } })
                .then(() => {
                  setTopicTitle("");
                  void topics.refetch();
                })
                .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't create topic."));
            }}
          >
            <Input value={topicTitle} onChange={(e) => setTopicTitle(e.target.value)} placeholder="New topic" maxLength={40} />
            <Button type="submit" size="sm" variant="secondary">
              Topic
            </Button>
          </form>
          {(topics.data ?? []).length > 0 ? (
            <ul className="text-xs text-muted">
              {topics.data!.map((t) => (
                <li key={t.id}>
                  <button type="button" className="text-left" onClick={() => onSelectTopic?.(t.id)}>
                    {t.icon ? `${t.icon} ` : ""}{t.title}{t.closed ? " · closed" : ""}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <Button
        className="mt-3 w-full"
        variant="outline"
        onClick={() =>
          void leaveChat({ data: { conversationId } }).then(onLeave)
        }
      >
        Leave {isBroadcast ? "channel" : "group"}
      </Button>
    </div>
  );
}
