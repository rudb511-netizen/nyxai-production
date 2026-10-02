import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useCallRing } from "@/components/kchat/incoming-call";
import { MediaRoom } from "@/lib/kchat/media-room";
import { applyVoiceMode, bindLocalPreview, getCallMedia, networkVideoTier, type VoiceMode } from "@/lib/kchat/call-audio";
import { stashCallMedia, takeCallMedia } from "@/lib/kchat/call-session";
import { openSystemSettings } from "@/utils/nativeCapabilities";
import { useMeQuery } from "@/lib/kchat/hooks";
import { acceptCall, declineCall, endCall, getCall, getIceConfig } from "@/lib/kchat/server/more";
import { cn } from "@/lib/utils";
import { setOrientationLock, setStatusBarHidden } from "@/utils/nativeCapabilities";

export const Route = createFileRoute("/_app/call/$id")({ component: CallPage });

type RemoteSlot = { id: string; name: string; stream: MediaStream };

function RemoteMedia({
  stream,
  name,
  voice,
}: {
  stream: MediaStream;
  name: string;
  voice: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.muted = false;
    el.volume = 1;
    el.setAttribute("playsinline", "true");
    el.setAttribute("webkit-playsinline", "true");
    void el.play().catch(() => undefined);
  }, [stream]);
  if (voice) {
    return (
      <div className="grid place-items-center">
        <video ref={ref} autoPlay playsInline className="sr-only" />
        <div className="text-center">
          <Avatar name={name} className="mx-auto size-20" />
          <p className="mt-2 text-sm font-medium">{name}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="relative min-h-0 overflow-hidden rounded-xl bg-zinc-900">
      <video ref={ref} autoPlay playsInline className="size-full object-cover" />
      <p className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px]">{name}</p>
    </div>
  );
}

function CallPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const me = useMeQuery();
  const call = useQuery({
    queryKey: ["call", id],
    queryFn: () => getCall({ data: { id } }),
    refetchInterval: 2000,
  });
  const localRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<MediaRoom | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [remotes, setRemotes] = useState<RemoteSlot[]>([]);
  const [speaker, setSpeaker] = useState(true);
  const [mode, setMode] = useState<VoiceMode>("auto");
  const [quality, setQuality] = useState("voice");
  const [reconnecting, setReconnecting] = useState(false);

  const [permHelp, setPermHelp] = useState(false);

  const data = call.data;
  const isCaller = data && me.data ? data.created_by === me.data.userId : false;
  const ringing = data?.status === "ringing";
  const live = data?.status === "live";
  const ended = data?.status === "ended" || data?.status === "missed";
  const connected = remotes.length > 0;
  useCallRing(Boolean(ringing && isCaller));

  useEffect(() => {
    void setOrientationLock("portrait");
    void setStatusBarHidden(true);
    return () => {
      void setOrientationLock("unlock");
      void setStatusBarHidden(false);
    };
  }, []);

  useEffect(() => {
    if (!data || !me.data || ended) return;
    if (ringing && !isCaller) return;
    if (roomRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const ice = await getIceConfig().catch(() => ({ iceServers: undefined as RTCIceServer[] | undefined }));
        const held = takeCallMedia(id);
        const got = held
          ? { stream: held.stream, label: held.label, actualHeight: 0 }
          : await getCallMedia({
              video: data.kind === "video",
              facing,
              mode,
              tier: networkVideoTier(),
            });
        if (cancelled) {
          got.stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const s = got.stream;
        streamRef.current = s;
        setQuality(got.label);
        await bindLocalPreview(localRef.current, s);
        const room = new MediaRoom({
          room: data.room_code,
          name: me.data.username,
          local: s,
          iceServers: ice.iceServers as RTCIceServer[] | undefined,
        });
        room.onState = (st) => setReconnecting(st.reconnecting);
        room.onRemote = (peerId, remote) => {
          setRemotes((cur) => {
            const name = room.selfId === peerId ? me.data.username : peerId;
            const next = cur.filter((r) => r.id !== peerId);
            return [...next, { id: peerId, name, stream: remote }];
          });
        };
        room.onGone = (peerId) => {
          setRemotes((cur) => cur.filter((r) => r.id !== peerId));
        };
        room.onPeers = (peers) => {
          setRemotes((cur) =>
            cur.map((r) => {
              const p = peers.find((x) => x.id === r.id);
              return p ? { ...r, name: p.name } : r;
            }),
          );
        };
        roomRef.current = room;
        await room.join();
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : data.kind === "video"
              ? "Camera permission is required for video calls."
              : "Microphone permission is required for video calls.";
        setPermHelp(/permission is required/i.test(msg));
        toast.error(msg);
      }
    })();
    return () => {
      cancelled = true;
      roomRef.current?.close();
      roomRef.current = null;
      streamRef.current = null;
      setRemotes([]);
    };
  }, [data?.room_code, data?.kind, data?.status, me.data?.username, isCaller, ended, ringing]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    void applyVoiceMode(stream, mode);
  }, [mode]);

  async function flipCamera() {
    if (data?.kind !== "video") return;
    const next = facing === "user" ? "environment" : "user";
    try {
      const got = await getCallMedia({ video: true, facing: next, mode, tier: networkVideoTier() });
      const track = got.stream.getVideoTracks()[0];
      if (!track) return;
      await roomRef.current?.replaceTrack("video", track);
      const audio = streamRef.current?.getAudioTracks()[0];
      const mixed = new MediaStream([track, ...(audio ? [audio] : [])]);
      streamRef.current = mixed;
      await bindLocalPreview(localRef.current, mixed);
      setFacing(next);
      setQuality(got.label);
    } catch {
      toast.error("Could not switch camera on this device.");
    }
  }

  if (call.isError) return <p className="p-6 text-sm">{(call.error as Error).message}</p>;
  if (!data) return <p className="p-6 text-sm text-muted">Connecting…</p>;

  const others = (data.participants ?? []).filter((p) => p.userId !== me.data?.userId);
  const title = others.length
    ? others.map((p) => p.displayName).join(", ")
    : isCaller
      ? "Calling…"
      : data.callerName || "Call";

  if (ended) {
    return (
      <div className="grid min-h-dvh place-items-center bg-black p-6 text-center text-white">
        <div>
          <p className="text-lg font-medium">{data.status === "missed" ? "Missed call" : "Call ended"}</p>
          <Button className="mt-4" onClick={() => nav({ to: "/inbox" })}>
            Back to inbox
          </Button>
        </div>
      </div>
    );
  }

  if (ringing && !isCaller) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-black px-6 text-white kc-call-chrome">
        <Avatar src={data.callerAvatar} name={data.callerName} className="size-24" />
        <p className="mt-4 text-xl font-medium">{data.callerName}</p>
        <p className="mt-1 text-sm text-white/70">
          Incoming {data.is_group ? "group " : ""}
          {data.kind === "video" ? "video" : "voice"} call
        </p>
        <div className="mt-10 flex gap-8">
          <Button
            size="icon"
            variant="danger"
            aria-label="Decline"
            onClick={() => void declineCall({ data: { id } }).then(() => nav({ to: "/inbox" }))}
          >
            <PhoneOff />
          </Button>
          <Button
            size="icon"
            aria-label="Accept"
            onClick={() => {
              void (async () => {
                try {
                  const got = await getCallMedia({
                    video: data.kind === "video",
                    facing,
                    mode,
                    tier: networkVideoTier(),
                  });
                  stashCallMedia(id, got.stream, got.label);
                  await acceptCall({ data: { id } });
                  await call.refetch();
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "Camera permission is required for video calls.";
                  setPermHelp(/permission is required/i.test(msg));
                  toast.error(msg);
                }
              })();
            }}
          >
            <Phone />
          </Button>
        </div>
        {permHelp ? (
          <Button className="mt-6" variant="secondary" onClick={() => void openSystemSettings()}>
            Open Settings
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-black text-white kc-call-chrome">
      <div className="relative flex-1">
        {data.kind === "video" ? (
          <div
            className={cn(
              "grid size-full gap-1 p-1",
              remotes.length > 1 ? "grid-cols-2" : "grid-cols-1",
            )}
          >
            {remotes.length === 0 ? (
              <div className="grid place-items-center">
                <p className="text-sm text-white/70">
                  {ringing ? "Ringing…" : live ? "Connecting…" : "Calling…"}
                </p>
              </div>
            ) : (
              remotes.map((r) => (
                <RemoteMedia key={r.id} stream={r.stream} name={r.name} voice={false} />
              ))
            )}
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            {remotes.map((r) => (
              <RemoteMedia key={r.id} stream={r.stream} name={r.name} voice />
            ))}
            {remotes.length === 0 ? (
              <div className="text-center">
                <Avatar src={data.callerAvatar} name={title} className="mx-auto size-24" />
                <p className="mt-4 text-xl font-medium">{title}</p>
                <p className="mt-1 text-sm text-white/70">
                  {connected ? "Connected" : ringing ? "Ringing…" : live ? "Connecting…" : "Calling…"}
                </p>
              </div>
            ) : null}
          </div>
        )}
        {data.kind === "video" ? (
          <video
            ref={localRef}
            autoPlay
            muted
            playsInline
            className="absolute h-32 w-24 rounded-xl object-cover ring-1 ring-white/20 kc-call-pip"
          />
        ) : (
          <video ref={localRef} autoPlay muted playsInline className="sr-only" />
        )}
        <p className="absolute left-4 top-[max(1rem,calc(var(--kc-safe-top)+0.5rem))] rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/80">
          {reconnecting ? "Connection unstable — reconnecting…" : quality === "voice" ? "Voice" : `Capture ${quality}`}
        </p>
        {permHelp ? (
          <Button
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            variant="secondary"
            onClick={() => void openSystemSettings()}
          >
            Open Settings
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2 px-4">
        {(["auto", "standard", "clear", "noise"] as VoiceMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={cn(
              "rounded-full px-3 py-1 text-[11px]",
              mode === m ? "bg-white text-black" : "bg-white/10 text-white/80",
            )}
            onClick={() => setMode(m)}
          >
            {m === "auto" ? "Automatic" : m === "standard" ? "Standard" : m === "clear" ? "Clear voice" : "Noise reduction"}
          </button>
        ))}
      </div>
      <div className="flex justify-center gap-4 p-6">
        <Button
          size="icon"
          variant="secondary"
          onClick={() => {
            streamRef.current?.getAudioTracks().forEach((t) => {
              t.enabled = muted;
            });
            setMuted((v) => !v);
          }}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff /> : <Mic />}
        </Button>
        {data.kind === "video" ? (
          <>
            <Button
              size="icon"
              variant="secondary"
              onClick={() => {
                streamRef.current?.getVideoTracks().forEach((t) => {
                  t.enabled = camOff;
                });
                setCamOff((v) => !v);
              }}
              aria-label={camOff ? "Camera on" : "Camera off"}
            >
              {camOff ? <VideoOff /> : <Video />}
            </Button>
            <Button size="icon" variant="secondary" onClick={() => void flipCamera()} aria-label="Switch camera">
              <SwitchCamera />
            </Button>
          </>
        ) : null}
        <Button
          size="icon"
          variant="secondary"
          onClick={() => setSpeaker((v) => !v)}
          aria-label={speaker ? "Speaker" : "Earpiece"}
        >
          {speaker ? <Volume2 /> : <VolumeX />}
        </Button>
        <Button
          size="icon"
          variant="danger"
          onClick={() => void endCall({ data: { id } }).then(() => nav({ to: "/inbox" }))}
          aria-label="Hang up"
        >
          <PhoneOff />
        </Button>
      </div>
    </div>
  );
}
