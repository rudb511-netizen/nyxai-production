import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Heart, Mic, MicOff, Radio, Settings, Share2, SwitchCamera, UserPlus, Video, VideoOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GiftSheet } from "@/components/kchat/gift-sheet";
import { JoinLiveSheet } from "@/components/kchat/join-live-sheet";
import { MentionBox } from "@/components/kchat/mention-box";
import { StickerBubble } from "@/components/kchat/sticker-bubble";
import { StickerPicker } from "@/components/kchat/sticker-picker";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatLiveDuration } from "@/lib/kchat/live-session";
import { MediaRoom } from "@/lib/kchat/media-room";
import { useMeQuery } from "@/lib/kchat/hooks";
import { giftByKey } from "@/lib/kchat/coins";
import { banLiveViewer, endLive, getLive, liveComment } from "@/lib/kchat/server/more";
import { listSpeakers, requestSpeak, setSpeakerRole } from "@/lib/kchat/server/graph";
import { bumpLiveHearts, claimGuestSeat, failLive, heartbeatLive, inviteToLive, leaveGuestSeat, leaveLive } from "@/lib/kchat/server/live-session";
import { listLiveGifts } from "@/lib/kchat/server/coins";
import { listFriends } from "@/lib/kchat/server/social";
import { nativeShare } from "@/utils/nativeCapabilities";

export const Route = createFileRoute("/_app/live/$id")({ component: LiveRoom });

type LiveComment = {
  id: string;
  body: string;
  createdAt: string;
  userId?: string;
  sticker?: { id: string; name: string; url: string | null; mediaKind?: string; packId?: string } | null;
  author: { userId: string; username: string; displayName: string; avatarUrl: string | null };
};

type FloatHeart = { id: number; x: number };
type RemoteFeed = { id: string; name: string; stream: MediaStream };

function GuestTile({ stream, name }: { stream: MediaStream; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline className="h-36 w-24 rounded-2xl object-cover ring-1 ring-white/20" aria-label={`${name} live`} />;
}

function LiveRoom() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const me = useMeQuery();
  const live = useQuery({
    queryKey: ["live-one", id],
    queryFn: () => getLive({ data: { id } }),
    refetchInterval: (q) => (q.state.data?.status === "live" ? 12_000 : false),
  });
  const gifts = useQuery({
    queryKey: ["live-gifts", id],
    queryFn: () => listLiveGifts({ data: { liveId: id } }),
    refetchInterval: 5000,
    enabled: live.data?.status === "live",
  });
  const speakers = useQuery({
    queryKey: ["live-speakers", id],
    queryFn: () => listSpeakers({ data: { streamId: id } }),
    refetchInterval: 5000,
    enabled: live.data?.status === "live",
  });
  const friends = useQuery({
    queryKey: ["friends"],
    queryFn: () => listFriends(),
    enabled: false,
  });

  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pipRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<MediaRoom | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const heartQueue = useRef(0);
  const heartsSeen = useRef(0);
  const heartsReady = useRef(false);
  const localHearts = useRef(0);
  const seenGifts = useRef<Set<string>>(new Set());
  const floatId = useRef(0);

  const [text, setText] = useState("");
  const [stickerOpen, setStickerOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [micOn, setMicOn] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [hearts, setHearts] = useState(0);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [floats, setFloats] = useState<FloatHeart[]>([]);
  const [giftPop, setGiftPop] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [endedLocal, setEndedLocal] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [camOn, setCamOn] = useState(true);
  const [remotes, setRemotes] = useState<RemoteFeed[]>([]);

  const info = live.data;
  const isHost = Boolean(info?.isHost);
  const ended = endedLocal || (info != null && info.status !== "live");

  useEffect(() => {
    if (info?.comments) setComments(info.comments);
  }, [info?.id]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!info || info.status !== "live") return;
    let stop = false;
    async function tick() {
      try {
        const beat = await heartbeatLive({ data: { id } });
        if (stop) return;
        setViewers(beat.viewers);
        if (!heartsReady.current) {
          heartsReady.current = true;
          heartsSeen.current = beat.hearts;
          setHearts(beat.hearts);
        } else {
          const remoteDelta = beat.hearts - heartsSeen.current;
          const mine = localHearts.current;
          localHearts.current = 0;
          const others = remoteDelta - mine;
          if (others > 0) spawnHearts(Math.min(others, 6));
          heartsSeen.current = beat.hearts;
          setHearts(beat.hearts);
        }
        setComments((cur) => {
          const map = new Map(cur.map((c) => [c.id, c]));
          for (const c of beat.comments) map.set(c.id, c);
          return [...map.values()].slice(-80);
        });
        setMediaError(null);
      } catch (e) {
        if (stop) return;
        const msg = e instanceof Error ? e.message : "Connection problem. Retrying…";
        if (/ended|removed|not found/i.test(msg)) {
          setEndedLocal(true);
          roomRef.current?.close();
        }
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 4000);
    return () => {
      stop = true;
      window.clearInterval(timer);
      void leaveLive({ data: { id } }).catch(() => undefined);
    };
    // spawnHearts is stable enough for this session; hearts state updates inside the tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, info?.status]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const n = heartQueue.current;
      if (n < 1) return;
      heartQueue.current = 0;
      void bumpLiveHearts({ data: { id, n } })
        .then((r) => setHearts(r.hearts))
        .catch(() => {
          heartQueue.current += n;
        });
    }, 800);
    return () => window.clearInterval(timer);
  }, [id]);

  useEffect(() => {
    for (const g of gifts.data ?? []) {
      if (seenGifts.current.has(g.id)) continue;
      seenGifts.current.add(g.id);
      if (seenGifts.current.size === 1 && (gifts.data ?? []).length > 1) continue;
      const meta = giftByKey(g.giftKey);
      setGiftPop(meta?.name ?? "Gift");
      window.setTimeout(() => setGiftPop(null), 1600);
    }
  }, [gifts.data]);

  useEffect(() => {
    if (!info || !me.data || info.status !== "live" || roomRef.current) return;
    let cancelled = false;
    const host = info.isHost;
    const audioOnly = info.kind === "audio";
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: host && !audioOnly ? { facingMode: "user" } : false,
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const audio = stream.getAudioTracks()[0];
        if (audio) audio.enabled = host;
        setMicOn(host);
        streamRef.current = stream;
        const show = host ? localRef.current : remoteRef.current;
        if (host && localRef.current) localRef.current.srcObject = stream;
        if (pipRef.current && !host) pipRef.current.srcObject = stream;
        const room = new MediaRoom({ room: info.room_code, name: me.data.username, local: stream });
        room.onRemote = (peerId, remote) => {
          setRemotes((prev) => {
            const name = prev.find((p) => p.id === peerId)?.name ?? "";
            return [...prev.filter((p) => p.id !== peerId), { id: peerId, name, stream: remote }];
          });
        };
        room.onPeers = (peers) => {
          setRemotes((prev) =>
            prev.map((r) => ({ ...r, name: peers.find((p) => p.id === r.id)?.name || r.name })),
          );
        };
        room.onGone = (peerId) => setRemotes((prev) => prev.filter((p) => p.id !== peerId));
        room.onState = (s) => setReconnecting(s.reconnecting);
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            setReconnecting(true);
            void recoverVideo();
          };
        }
        roomRef.current = room;
        await room.join();
        if (!cancelled) {
          setReady(true);
          setMediaError(null);
          void show;
        }
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        setMediaError(
          name === "NotAllowedError"
            ? host
              ? "Camera or microphone permission was denied. Allow both, then retry. Cancel this live if you do not want it to stay open."
              : "Microphone permission was denied. You can still watch if the host is sending video. Allow the mic to talk."
            : e instanceof Error
              ? e.message
              : "Could not open the camera.",
        );
      }
    })();
    return () => {
      cancelled = true;
      roomRef.current?.close();
      roomRef.current = null;
      streamRef.current = null;
    };
  }, [info?.room_code, info?.isHost, info?.status, me.data?.username]);

  function spawnHearts(count: number) {
    const next: FloatHeart[] = [];
    for (let i = 0; i < count; i++) {
      floatId.current += 1;
      next.push({ id: floatId.current, x: 12 + Math.round(Math.random() * 36) });
    }
    setFloats((cur) => [...cur, ...next].slice(-24));
    window.setTimeout(() => {
      const ids = new Set(next.map((h) => h.id));
      setFloats((cur) => cur.filter((h) => !ids.has(h.id)));
    }, 900);
  }

  function tapHeart() {
    if (ended) return;
    heartQueue.current = Math.min(30, heartQueue.current + 1);
    localHearts.current += 1;
    heartsSeen.current += 1;
    setHearts((n) => n + 1);
    spawnHearts(1);
  }

  async function recoverVideo() {
    const room = roomRef.current;
    if (!room || !isHost || info?.kind === "audio") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("No camera.");
      await room.replaceTrack("video", track);
      if (localRef.current && streamRef.current) {
        const old = streamRef.current.getVideoTracks()[0];
        if (old && old !== track) {
          streamRef.current.removeTrack(old);
        }
        if (!streamRef.current.getVideoTracks().includes(track)) streamRef.current.addTrack(track);
        localRef.current.srcObject = streamRef.current;
      }
      setReconnecting(false);
      setMediaError(null);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "Reconnect failed.");
    }
  }

  async function flipCamera() {
    if (info?.kind === "audio") return;
    if (!isHost && !guestLive) return;
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    const room = roomRef.current;
    if (!room) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("No camera.");
      await room.replaceTrack("video", track);
      setMediaError(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch cameras.");
    }
  }

  function toggleCam() {
    if (info?.kind === "audio") return;
    const video = streamRef.current?.getVideoTracks()[0];
    if (!video || video.readyState === "ended") {
      toast.error("No camera is available.");
      return;
    }
    video.enabled = !video.enabled;
    setCamOn(video.enabled);
  }

  function toggleMic() {
    const mine = (speakers.data ?? []).find((s) => s.userId === me.data?.userId);
    if (mine?.muted && !isHost) {
      toast.error("The host muted your microphone.");
      return;
    }
    const audio = streamRef.current?.getAudioTracks()[0];
    if (!audio) {
      toast.error("No microphone is available.");
      return;
    }
    audio.enabled = !audio.enabled;
    setMicOn(audio.enabled);
  }

  const mySeat = (speakers.data ?? []).find((s) => s.userId === me.data?.userId);
  const guestLive = mySeat?.role === "speaker" || mySeat?.role === "cohost";
  const invited = mySeat?.role === "invited";

  useEffect(() => {
    try {
      if (sessionStorage.getItem("nyx-join-live") === id) {
        sessionStorage.removeItem("nyx-join-live");
        setJoinOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, [id]);

  useEffect(() => {
    if (isHost || !remoteRef.current) return;
    const hostName = info?.host?.username;
    const hostFeed =
      remotes.find((r) => hostName && r.name === hostName && r.stream.getVideoTracks().length > 0) ??
      remotes.find((r) => r.stream.getVideoTracks().length > 0);
    if (hostFeed) remoteRef.current.srcObject = hostFeed.stream;
  }, [remotes, isHost, info?.host?.username]);

  useEffect(() => {
    if (!guestLive || isHost || !roomRef.current) return;
    const hasVideo = streamRef.current?.getVideoTracks().some((t) => t.readyState === "live");
    if (info?.kind !== "audio" && hasVideo) return;
    let cancel = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: info?.kind === "audio" ? false : { facingMode: facing },
        });
        if (cancel || !roomRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = stream.getVideoTracks()[0];
        const audio = stream.getAudioTracks()[0];
        if (video) await roomRef.current.replaceTrack("video", video);
        if (audio) {
          audio.enabled = !mySeat?.muted;
          await roomRef.current.replaceTrack("audio", audio);
          setMicOn(audio.enabled);
        }
        if (localRef.current && streamRef.current) localRef.current.srcObject = streamRef.current;
        setPublishing(true);
        setCamOn(Boolean(video));
        setMediaError(null);
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        setMediaError(
          name === "NotAllowedError"
            ? "Camera or microphone permission was denied. You are still in the live, but other people cannot see or hear you until you allow access."
            : e instanceof Error
              ? e.message
              : "Could not start your camera.",
        );
      }
    })();
    return () => {
      cancel = true;
    };
  }, [guestLive, isHost, info?.kind]);

  useEffect(() => {
    if (!publishing || isHost || !localRef.current || !streamRef.current) return;
    localRef.current.srcObject = streamRef.current;
  }, [publishing, isHost]);

  useEffect(() => {
    if (isHost || guestLive) return;
    const videos = streamRef.current?.getVideoTracks() ?? [];
    for (const track of videos) {
      track.stop();
      streamRef.current?.removeTrack(track);
    }
    if (videos.length) {
      setPublishing(false);
      setMicOn(false);
    }
  }, [guestLive, isHost]);

  useEffect(() => {
    if (!mySeat?.muted || isHost) return;
    const audio = streamRef.current?.getAudioTracks()[0];
    if (audio) audio.enabled = false;
    setMicOn(false);
  }, [mySeat?.muted, isHost]);

  async function sendComment(stickerId?: string) {
    const body = text;
    if (!body.trim() && !stickerId) return;
    setText("");
    setStickerOpen(false);
    try {
      await liveComment({ data: { id, body, stickerId } });
      const beat = await heartbeatLive({ data: { id } });
      setComments(beat.comments);
    } catch (e) {
      setText(body);
      toast.error(e instanceof Error ? e.message : "Could not send that comment.");
    }
  }

  async function finish(mode: "end" | "fail" | "leave") {
    roomRef.current?.close();
    roomRef.current = null;
    try {
      if (mode === "end") await endLive({ data: { id } });
      else if (mode === "fail") await failLive({ data: { id, reason: mediaError || "host ended after a failure" } });
      else await leaveLive({ data: { id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not leave.");
    }
    setEndedLocal(true);
    nav({ to: "/live" });
  }

  async function share() {
    const url = `${window.location.origin}/live/${id}`;
    const ok = await nativeShare({ title: info?.title || "NYX Live", url, text: info?.title || "Live on NYX" });
    if (!ok) toast.error("Could not share this live.");
  }

  if (live.isError) {
    return <p className="p-6 text-sm text-muted">{(live.error as Error).message}</p>;
  }
  if (!info) return <p className="p-6 text-sm text-muted">Connecting…</p>;

  const duration = formatLiveDuration(info.started_at, now);
  const showVideo = info.kind !== "audio";
  const requests = (speakers.data ?? []).filter((s) => s.role === "requested");
  const guestFeeds = remotes.filter(
    (r) => r.stream.getVideoTracks().length > 0 && r.name && r.name !== info.host?.username && r.name !== me.data?.username,
  );
  const canJoin = !ended && !isHost && !guestLive && info.status === "live";

  return (
    <div className="relative min-h-dvh bg-black text-white">
      {showVideo ? (
        <video
          ref={isHost ? localRef : remoteRef}
          autoPlay
          playsInline
          muted={isHost}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-zinc-900 to-black">
          <div className="px-6 text-center">
            <Radio className="mx-auto size-8" />
            <p className="mt-2 text-lg font-semibold">{info.title}</p>
            <p className="mt-1 text-sm text-white/70">Audio room</p>
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              {(speakers.data ?? [])
                .filter((s) => s.role === "host" || s.role === "speaker" || s.role === "cohost")
                .map((s) => (
                  <div key={s.userId} className="w-16 text-center">
                    <div className="relative mx-auto">
                      <Avatar src={s.avatarUrl} name={s.displayName} />
                      <span className="nyx-onair-dot" aria-hidden />
                    </div>
                    <p className="mt-1 truncate text-[11px]">{s.displayName}</p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
      {!isHost ? <video ref={pipRef} autoPlay playsInline muted className="absolute bottom-36 right-3 z-10 hidden h-28 w-20 rounded-xl object-cover" /> : <video ref={remoteRef} autoPlay playsInline className="hidden" />}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent p-4 pt-[max(1rem,var(--kc-safe-top))]">
        <div className="pointer-events-auto flex items-center gap-2">
          <span className="rounded-full bg-live px-2 py-0.5 text-[11px] font-semibold">
            {ended ? "ENDED" : "LIVE"}
          </span>
          <span className="text-xs tabular-nums" aria-label={`Duration ${duration}`}>
            {duration}
          </span>
          <span className="text-xs" aria-label={`${viewers} watching`}>
            {viewers} watching
          </span>
          {reconnecting ? <span className="text-xs text-warn">Reconnecting…</span> : null}
          {!ready && !mediaError && !ended ? <span className="text-xs text-white/70">Connecting camera…</span> : null}
        </div>
        <div className="pointer-events-auto mt-3 flex items-center gap-2">
          <Link to="/u/$username" params={{ username: info.host?.username || me.data?.username || "me" }} className="relative">
            <Avatar src={info.host?.avatarUrl} name={info.host?.displayName || "Host"} size="sm" />
            {!ended ? <span className="nyx-onair-ring" aria-hidden /> : null}
            <span className="sr-only">{ended ? "Host" : "Host is live"}</span>
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{info.host?.displayName}</p>
            <p className="truncate text-xs text-white/70">{info.title}</p>
          </div>
        </div>
      </div>

      {mediaError ? (
        <div className="absolute inset-x-4 top-28 z-30 rounded-2xl bg-black/80 p-4 text-sm" role="alert">
          <p>{mediaError}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void recoverVideo()}>
              Retry
            </Button>
            {isHost ? (
              <Button size="sm" variant="danger" onClick={() => void finish("fail")}>
                Close session
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showVideo && (guestFeeds.length > 0 || (publishing && !isHost)) ? (
        <div className="absolute right-3 top-24 z-10 flex max-h-[46vh] flex-col gap-2 overflow-y-auto">
          {guestFeeds.map((g) => (
            <GuestTile key={g.id} stream={g.stream} name={g.name || "Guest"} />
          ))}
          {publishing && !isHost ? (
            <video ref={localRef} autoPlay playsInline muted className="h-36 w-24 rounded-2xl object-cover ring-1 ring-white/30" aria-label="Your camera" />
          ) : null}
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-28 right-3 z-20 flex h-64 w-16 flex-col justify-end">
        {floats.map((h) => (
          <Heart key={h.id} className="kc-heart-pop absolute text-live" style={{ right: h.x, bottom: 8 }} aria-hidden />
        ))}
      </div>
      {giftPop ? (
        <div className="absolute left-4 top-1/3 z-20 rounded-full bg-black/70 px-3 py-1 text-sm" role="status">
          {giftPop}
        </div>
      ) : null}

      <div className="absolute bottom-28 right-3 z-20 flex flex-col items-center gap-3">
        <button type="button" className="grid size-11 place-items-center rounded-full bg-white/15" aria-label="Like this live" onClick={tapHeart}>
          <Heart className="size-5" />
        </button>
        <span className="text-[11px] tabular-nums">{hearts}</span>
        {!isHost ? (
          <GiftSheet liveId={id} recipientUsername={info.host?.username} onSent={() => void gifts.refetch()} triggerClassName="grid size-11 place-items-center rounded-full bg-white/15 text-white" />
        ) : null}
        <button type="button" className="grid size-11 place-items-center rounded-full bg-white/15" aria-label="Share live" onClick={() => void share()}>
          <Share2 className="size-5" />
        </button>
        {canJoin ? (
          <button
            type="button"
            className="kc-pay-glow min-h-11 rounded-full px-3 text-xs font-semibold !text-white"
            onClick={() => setJoinOpen(true)}
          >
            Join Live
          </button>
        ) : null}
        {isHost ? (
          <button
            type="button"
            className="grid size-11 place-items-center rounded-full bg-white/15"
            aria-label="Invite people"
            onClick={() => {
              setInviteOpen(true);
              void friends.refetch();
            }}
          >
            <UserPlus className="size-5" />
          </button>
        ) : null}
        {showVideo && (isHost || guestLive) ? (
          <button type="button" className="grid size-11 place-items-center rounded-full bg-white/15" aria-label={camOn ? "Turn camera off" : "Turn camera on"} aria-pressed={camOn} onClick={toggleCam}>
            {camOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
          </button>
        ) : null}
        {showVideo && (isHost || guestLive) ? (
          <button type="button" className="grid size-11 place-items-center rounded-full bg-white/15" aria-label="Switch camera" onClick={() => void flipCamera()}>
            <SwitchCamera className="size-5" />
          </button>
        ) : null}
        <button type="button" className="grid size-11 place-items-center rounded-full bg-white/15" aria-pressed={micOn} aria-label={micOn ? "Mute microphone" : "Unmute microphone"} onClick={toggleMic}>
          {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
        </button>
        <button type="button" className="grid size-11 place-items-center rounded-full bg-white/15" aria-label="Live settings" onClick={() => setMoreOpen(true)}>
          <Settings className="size-5" />
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-[max(0.75rem,var(--kc-safe-bottom))] pt-10">
        <ul className="mb-2 max-h-36 space-y-1 overflow-y-auto text-sm" aria-live="polite">
          {comments.slice(-40).map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <Avatar src={c.author.avatarUrl} name={c.author.displayName} size="sm" />
              <p className="min-w-0 flex-1">
                <span className="font-medium">{c.author.displayName}</span> {c.body}
              </p>
              {c.sticker ? (
                <StickerBubble packId={c.sticker.packId} stickerId={c.sticker.id} mediaUrl={c.sticker.url} name={c.sticker.name} mediaKind={c.sticker.mediaKind} className="mt-0 size-8" />
              ) : null}
              {isHost && c.author.userId && c.author.userId !== me.data?.userId ? (
                <button
                  type="button"
                  className="text-[11px] text-white/70"
                  aria-label={`Remove ${c.author.displayName}`}
                  onClick={() =>
                    void banLiveViewer({ data: { streamId: id, userId: c.author.userId } })
                      .then(() => toast.success("Removed from this live"))
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not remove them"))
                  }
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {info.kind === "audio" && !isHost ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mb-2 border-white/20 text-white"
            onClick={() =>
              void requestSpeak({ data: { streamId: id } })
                .then(() => {
                  toast.success("Asked to speak");
                  void speakers.refetch();
                })
                .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
            }
          >
            Request to speak
          </Button>
        ) : null}
        {requests.length > 0 && isHost ? (
          <div className="mb-2 space-y-1 rounded-2xl bg-black/50 p-2">
            {requests.map((req) => (
              <div key={req.userId} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{req.displayName} wants to join</span>
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    void setSpeakerRole({ data: { streamId: id, userId: req.userId, role: "speaker" } })
                      .then(() => speakers.refetch())
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not accept"))
                  }
                >
                  Accept
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-white/20 text-white"
                  onClick={() =>
                    void setSpeakerRole({ data: { streamId: id, userId: req.userId, role: "listener" } })
                      .then(() => speakers.refetch())
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not decline"))
                  }
                >
                  Decline
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void sendComment();
          }}
        >
          <MentionBox
            value={text}
            onChange={setText}
            placeholder="Comment"
            variant="composer"
            minHeightClass="min-h-10"
            className="min-w-0 flex-1"
            onSubmit={() => void sendComment()}
          />
          <Button type="button" size="sm" variant="outline" className="border-white/20 text-white" onClick={() => setStickerOpen((v) => !v)}>
            Stickers
          </Button>
          <Button type="submit" size="sm">
            Send
          </Button>
        </form>
        {stickerOpen ? (
          <StickerPicker
            compact
            onPick={(s) => {
              void sendComment(s.stickerId);
            }}
          />
        ) : null}
      </div>

      {inviteOpen ? (
        <div className="absolute inset-0 z-40 bg-black/70 p-4" role="dialog" aria-label="Invite to live">
          <div className="mx-auto mt-16 max-w-md rounded-2xl bg-zinc-900 p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">Invite friends</p>
              <button type="button" aria-label="Close invites" onClick={() => setInviteOpen(false)}>
                <X className="size-5" />
              </button>
            </div>
            <ul className="mt-3 max-h-72 overflow-y-auto">
              {(friends.data ?? []).length === 0 ? <li className="py-4 text-sm text-white/60">No friends to invite yet.</li> : null}
              {(friends.data ?? []).map((f) => (
                <li key={f.userId} className="flex items-center gap-2 py-2">
                  <Avatar src={f.avatarUrl} name={f.displayName} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">{f.displayName}</span>
                  <Button
                    size="sm"
                    onClick={() =>
                      void inviteToLive({ data: { streamId: id, username: f.username } })
                        .then(() => toast.success(`Invited @${f.username}`))
                        .catch((e) => toast.error(e instanceof Error ? e.message : "Could not invite"))
                    }
                  >
                    Invite
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {moreOpen ? (
        <div className="absolute inset-0 z-40 bg-black/70 p-4" role="dialog" aria-label="Live settings">
          <div className="mx-auto mt-24 max-w-md space-y-2 rounded-2xl bg-zinc-900 p-4">
            <p className="font-medium">Live</p>
            <p className="text-sm text-white/70">
              {viewers} watching · {hearts} likes · {duration}
            </p>
            <Button className="w-full" variant="outline" onClick={toggleMic}>
              {micOn ? "Mute microphone" : "Unmute microphone"}
            </Button>
            {isHost ? (
              <Button className="w-full" variant="danger" onClick={() => void finish("end")}>
                End Live
              </Button>
            ) : guestLive ? (
              <Button
                className="w-full"
                variant="outline"
                onClick={() =>
                  void leaveGuestSeat({ data: { streamId: id } })
                    .then(() => {
                      toast.success("You left the guest spot");
                      void speakers.refetch();
                      setMoreOpen(false);
                    })
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Could not leave"))
                }
              >
                Leave guest spot
              </Button>
            ) : (
              <Button className="w-full" variant="outline" onClick={() => void finish("leave")}>
                Leave
              </Button>
            )}
            {isHost
              ? (speakers.data ?? [])
                  .filter((s) => s.role === "speaker" || s.role === "cohost")
                  .map((s) => (
                    <div key={s.userId} className="flex gap-2">
                      <Button
                        className="flex-1"
                        variant="outline"
                        onClick={() =>
                          void setSpeakerRole({
                            data: { streamId: id, userId: s.userId, role: s.role === "cohost" ? "cohost" : "speaker", muted: !s.muted },
                          })
                            .then(() => speakers.refetch())
                            .catch((e) => toast.error(e instanceof Error ? e.message : "Could not update the microphone"))
                        }
                      >
                        {s.muted ? "Unmute" : "Mute"} {s.displayName}
                      </Button>
                      <Button
                        className="flex-1"
                        variant="outline"
                        onClick={() =>
                          void setSpeakerRole({ data: { streamId: id, userId: s.userId, role: "listener" } })
                            .then(() => {
                              toast.success(`Removed ${s.displayName}`);
                              void speakers.refetch();
                            })
                            .catch((e) => toast.error(e instanceof Error ? e.message : "Could not remove them"))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))
              : null}
            <Button className="w-full" variant="ghost" onClick={() => setMoreOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
      {joinOpen && canJoin ? (
        <JoinLiveSheet
          title={invited ? "Join this live" : "Request to join"}
          confirmLabel={invited ? "Join live" : "Request to Join"}
          allowVideo={info.kind !== "audio"}
          onCancel={() => setJoinOpen(false)}
          onConfirm={async () => {
            try {
              if (invited) await claimGuestSeat({ data: { streamId: id } });
              else await requestSpeak({ data: { streamId: id } });
              setJoinOpen(false);
              toast.success(invited ? "You're joining the live" : "Request sent. The host can accept or decline.");
              void speakers.refetch();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not join");
            }
          }}
        />
      ) : null}
    </div>
  );
}
