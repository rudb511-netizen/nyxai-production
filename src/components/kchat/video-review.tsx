import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatTimecode, isPlayableReady, playbackErrorMessage, videoAspectClass } from "@/lib/kchat/video-playback";
import { cn } from "@/lib/utils";

export function VideoReviewPlayer({
  src,
  onReady,
  onFail,
}: {
  src: string;
  onReady?: (info: { width: number; height: number; durationMs: number }) => void;
  onFail?: (reason: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aspect, setAspect] = useState<"portrait" | "landscape" | "square">("portrait");

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setBuffering(true);
    setError(null);
  }, [src]);

  function markReady(el: HTMLVideoElement) {
    if (!isPlayableReady(el)) return;
    setBuffering(false);
    setError(null);
    setDuration(el.duration);
    setAspect(videoAspectClass(el.videoWidth, el.videoHeight));
    onReady?.({
      width: el.videoWidth,
      height: el.videoHeight,
      durationMs: Math.round(el.duration * 1000),
    });
  }

  async function toggle() {
    const el = ref.current;
    if (!el) return;
    try {
      if (el.paused) {
        await el.play();
        setPlaying(true);
      } else {
        el.pause();
        setPlaying(false);
      }
    } catch (e) {
      if ((e as { name?: string })?.name === "NotAllowedError") {
        setPlaying(false);
        return;
      }
      setPlaying(false);
      setError(playbackErrorMessage(el.error?.code ?? null));
    }
  }

  return (
    <div
      className={cn(
        "relative mx-auto overflow-hidden rounded-2xl bg-black",
        aspect === "landscape" ? "w-full max-h-[52vh]" : aspect === "square" ? "w-full max-w-sm" : "w-full max-w-[22rem]",
      )}
    >
      <video
        ref={ref}
        src={src}
        className="mx-auto max-h-[70vh] w-full object-contain"
        playsInline
        preload="auto"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(el.duration || 0);
          setAspect(videoAspectClass(el.videoWidth, el.videoHeight));
        }}
        onCanPlay={(e) => markReady(e.currentTarget)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => {
          setBuffering(false);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onError={(e) => {
          const reason = playbackErrorMessage(e.currentTarget.error?.code ?? null);
          setError(reason);
          setBuffering(false);
          onFail?.(reason);
        }}
      />
      {buffering && !error ? (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-white/80">Loading playback…</p>
      ) : null}
      {error ? (
        <div className="absolute inset-0 grid place-items-center bg-black/70 px-4 text-center">
          <p className="text-sm text-white">{error}</p>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <button type="button" className="grid size-9 place-items-center text-white" onClick={() => void toggle()} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <span className="w-10 text-[11px] tabular-nums text-white/80">{formatTimecode(current)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.05}
          value={Math.min(current, duration || 0)}
          aria-label="Seek"
          className="min-w-0 flex-1"
          onChange={(e) => {
            const el = ref.current;
            const next = Number(e.target.value);
            if (el) el.currentTime = next;
            setCurrent(next);
          }}
        />
        <span className="w-10 text-right text-[11px] tabular-nums text-white/80">{formatTimecode(Math.max(0, duration - current))}</span>
        <button
          type="button"
          className="grid size-9 place-items-center text-white"
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={() => {
            const el = ref.current;
            const next = !muted;
            if (el) el.muted = next;
            setMuted(next);
          }}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      </div>
    </div>
  );
}

export function VideoReviewActions({
  playable,
  error,
  busy,
  onRetry,
  onReplace,
  onDraft,
  onPublish,
}: {
  playable: boolean;
  error: string | null;
  busy: boolean;
  onRetry: () => void;
  onReplace: () => void;
  onDraft: () => void;
  onPublish: () => void;
}) {
  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-warn">{error}</p> : null}
      {!playable && error ? (
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" disabled={busy} onClick={onRetry}>
            Retry
          </Button>
          <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={onReplace}>
            Replace video
          </Button>
        </div>
      ) : !playable ? (
        <p className="text-sm text-muted">Post is enabled after the video is ready.</p>
      ) : null}
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy || !playable} onClick={onPublish}>
          Publish
        </Button>
        <Button variant="outline" disabled={busy || !playable} onClick={onDraft}>
          Save draft
        </Button>
      </div>
    </div>
  );
}
