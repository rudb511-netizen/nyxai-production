import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Phone, PhoneOff, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { acceptCall, declineCall, incomingCalls } from "@/lib/kchat/server/more";
import { getCallMedia, networkVideoTier } from "@/lib/kchat/call-audio";
import { stashCallMedia } from "@/lib/kchat/call-session";
import { openSystemSettings } from "@/utils/nativeCapabilities";
import { useMeQuery } from "@/lib/kchat/hooks";

/** Soft two-tone ring. Fails silently if the browser blocks autoplay. */
export function useCallRing(active: boolean) {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    let ctx: AudioContext | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = async () => {
      try {
        ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const beep = () => {
          if (!ctx || stopped) return;
          const now = ctx.currentTime;
          for (const [i, freq] of [880, 1046].entries()) {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(0.06, now + 0.02 + i * 0.18);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16 + i * 0.18);
            osc.connect(g).connect(ctx.destination);
            osc.start(now + i * 0.18);
            osc.stop(now + 0.2 + i * 0.18);
          }
        };
        beep();
        timer = setInterval(beep, 1800);
      } catch {
        /* autoplay / AudioContext blocked */
      }
    };
    void start();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      void ctx?.close().catch(() => {});
    };
  }, [active]);
}

export function IncomingCallHost() {
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const me = useMeQuery();
  const q = useQuery({
    queryKey: ["incoming-calls"],
    queryFn: () => incomingCalls(),
    refetchInterval: 2000,
  });
  const shown = useRef<Set<string>>(new Set());
  const [permHelp, setPermHelp] = useState(false);
  const ringing = (q.data ?? []).filter((c) => !path.startsWith(`/call/${c.id}`))[0];
  useCallRing(Boolean(ringing) && me.data?.soundPrefs?.calls !== false);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!ringing || shown.current.has(ringing.id)) return;
    shown.current.add(ringing.id);
    const kind = ringing.kind === "video" ? "video" : "voice";
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification(`${ringing.caller?.displayName ?? "Someone"} is calling`, {
          body: ringing.isGroup ? `Incoming group ${kind} call` : `Incoming ${kind} call`,
          tag: ringing.id,
        });
      } catch {
        /* ignore */
      }
    }
    if (me.data?.soundPrefs?.vibration !== false) {
      try {
        navigator.vibrate?.([400, 120, 400]);
      } catch {
        /* ignore */
      }
    }
  }, [ringing?.id]);

  const accept = useMutation({
    mutationFn: async (id: string) => {
      const kind = ringing?.kind === "video";
      const got = await getCallMedia({
        video: kind,
        facing: "user",
        mode: "auto",
        tier: networkVideoTier(),
      });
      stashCallMedia(id, got.stream, got.label);
      await acceptCall({ data: { id } });
      return id;
    },
    onSuccess: (id) => nav({ to: "/call/$id", params: { id } }),
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Could not accept.";
      setPermHelp(/permission is required/i.test(msg));
      toast.error(msg);
    },
  });
  const decline = useMutation({
    mutationFn: (id: string) => declineCall({ data: { id } }),
    onSuccess: () => void q.refetch(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not decline."),
  });

  if (!ringing) return null;
  const name = ringing.caller?.displayName ?? "Someone";
  const kind = ringing.kind === "video" ? "video" : "voice";

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center p-3 pt-[max(12px,env(safe-area-inset-top))]">
      <div className="pointer-events-auto kc-sheet flex w-full items-center gap-3 rounded-3xl border border-accent/30 bg-surface/90 p-3 shadow-border backdrop-blur-xl kc-incoming-pulse">
        <Avatar src={ringing.caller?.avatarUrl} name={name} className="size-14" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{name}</p>
          <p className="text-xs text-muted">
            Incoming {ringing.isGroup ? `group ${kind}` : kind} call
          </p>
        </div>
        <Button
          size="icon"
          variant="danger"
          aria-label="Decline"
          className="size-12 rounded-full"
          onClick={() => decline.mutate(ringing.id)}
        >
          <PhoneOff className="size-5" />
        </Button>
        <Button
          size="icon"
          aria-label="Accept"
          className="size-12 rounded-full"
          onClick={() => accept.mutate(ringing.id)}
        >
          {ringing.kind === "video" ? <Video className="size-5" /> : <Phone className="size-5" />}
        </Button>
      </div>
      {permHelp ? (
        <div className="pointer-events-auto mt-2 w-full rounded-2xl bg-surface/90 p-3 text-center shadow-border">
          <p className="text-xs text-muted">Camera or microphone is blocked for NYX.</p>
          <Button className="mt-2" size="sm" variant="secondary" onClick={() => void openSystemSettings()}>
            Open Settings
          </Button>
        </div>
      ) : null}
    </div>
  );
}
