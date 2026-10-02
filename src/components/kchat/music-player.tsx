import { Download, LoaderCircle, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, VolumeX, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadLicensedTrack, useMusicEngine } from "@/lib/kchat/music-engine";
import { getDownloadEntry, subscribeDownloads } from "@/lib/kchat/music-download";
import { downloadLocationHint } from "@/lib/kchat/music-offline";
import { formatClock, playbackLabel, playbackTypeOf, canDownload, canPlay } from "@/lib/kchat/music";
import { cn } from "@/lib/utils";

export function MusicMiniPlayer() {
  const track = useMusicEngine((s) => s.track);
  const status = useMusicEngine((s) => s.status);
  const currentMs = useMusicEngine((s) => s.currentMs);
  const durationMs = useMusicEngine((s) => s.durationMs);
  const error = useMusicEngine((s) => s.error);
  const buffering = useMusicEngine((s) => s.buffering);
  const needsUserInteraction = useMusicEngine((s) => s.needsUserInteraction);
  const muted = useMusicEngine((s) => s.muted);
  const pause = useMusicEngine((s) => s.pause);
  const resume = useMusicEngine((s) => s.resume);
  const tapPlay = useMusicEngine((s) => s.tapPlay);
  const unmute = useMusicEngine((s) => s.unmute);
  const seek = useMusicEngine((s) => s.seek);
  const next = useMusicEngine((s) => s.next);
  const prev = useMusicEngine((s) => s.prev);
  const stop = useMusicEngine((s) => s.stop);
  const retry = useMusicEngine((s) => s.retry);
  const officialUrl = useMusicEngine((s) => s.officialUrl);
  const repeat = useMusicEngine((s) => s.repeat);
  const shuffle = useMusicEngine((s) => s.shuffle);
  const toggleRepeat = useMusicEngine((s) => s.toggleRepeat);
  const toggleShuffle = useMusicEngine((s) => s.toggleShuffle);
  const [, bump] = useState(0);
  useEffect(() => subscribeDownloads(() => bump((n) => n + 1)), []);
  const entry = track ? getDownloadEntry(track.id) : null;
  const dlPct = entry?.phase === "downloading" ? entry.pct : null;

  if (!track) return null;
  const failed = status === "error";
  const dur = failed ? 0 : durationMs || track.durationMs || 0;
  const loading = status === "loading";
  const playing = status === "playing";
  const blocked = needsUserInteraction || status === "blocked";
  const statusCopy = blocked
    ? null
    : failed
      ? null
      : loading
        ? "Finding audio…"
        : buffering
          ? "Buffering..."
          : null;

  return (
    <div className="kc-mini-player">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface/95 p-3 shadow-border-hover backdrop-blur-md">
        <div className="flex items-center gap-3">
          {track.artworkUrl ? (
            <img src={track.artworkUrl} alt="" className="size-12 rounded-lg object-cover" />
          ) : (
            <div className="grid size-12 place-items-center rounded-lg bg-elevated text-xs text-muted">NYX</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{track.title}</p>
            <p className="truncate text-xs text-muted">{track.artist}</p>
            <p className="truncate text-xs text-subtle">{officialUrl ? "Official player" : playbackLabel(track)}</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Previous" onClick={prev}>
            <SkipBack className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            aria-label={blocked ? "Tap Play to start audio" : playing ? "Pause" : "Play audio"}
            onClick={() => {
              if (playing) pause();
              else if (blocked) tapPlay();
              else if (failed) retry();
              else resume();
            }}
          >
            {loading && !blocked ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : playing ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next" onClick={() => next({ fromUserGesture: true })}>
            <SkipForward className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={shuffle ? "Shuffle on" : "Shuffle off"}
            aria-pressed={shuffle}
            onClick={toggleShuffle}
          >
            <Shuffle className={cn("size-4", shuffle && "text-accent")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat off"}
            aria-pressed={repeat !== "off"}
            onClick={toggleRepeat}
          >
            {repeat === "one" ? <Repeat1 className="size-4 text-accent" /> : <Repeat className={cn("size-4", repeat === "all" && "text-accent")} />}
          </Button>
          {canDownload(track) ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Download ${track.title}`}
              disabled={entry?.phase === "downloading"}
              onClick={() => {
                if (!track) return;
                void downloadLicensedTrack(track)
                  .then(() => toast.message(downloadLocationHint()))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Download failed. Please try again."));
              }}
            >
              {dlPct != null && dlPct < 100 ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" aria-label="Stop" onClick={stop}>
            <X className="size-4" />
          </Button>
        </div>
        {officialUrl ? (
          <iframe
            title={`Official player for ${track.title}`}
            src={officialUrl}
            className="mt-3 h-40 w-full rounded-xl border border-border bg-black"
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            allow="autoplay; encrypted-media"
          />
        ) : (
          <input
            type="range"
            min={0}
            max={Math.max(1, dur)}
            value={Math.min(currentMs, dur || currentMs)}
            aria-label="Seek"
            className="mt-2 w-full accent-accent"
            onChange={(e) => seek(Number(e.target.value))}
          />
        )}
        {officialUrl ? null : (
          <div className="mt-0.5 flex justify-between text-xs tabular-nums text-subtle">
            <span>{failed ? "—" : formatClock(currentMs)}</span>
            <span>{failed ? "Not playing" : dur ? `-${formatClock(Math.max(0, dur - currentMs))}` : formatClock(dur)}</span>
          </div>
        )}
        {statusCopy ? (
          <p className="mt-1 text-xs text-muted" aria-live="polite">
            {statusCopy}
          </p>
        ) : null}
        {muted && playing ? (
          <Button type="button" variant="secondary" size="sm" className="mt-2 min-h-11 w-full gap-2" onClick={unmute}>
            <VolumeX className="size-4" />
            Unmute
          </Button>
        ) : null}
        {error ? (
          <p className="mt-1 text-xs text-danger" role="alert">
            {error}{" "}
            <button type="button" className="underline" onClick={retry}>
              Retry
            </button>
          </p>
        ) : null}
        {dlPct != null ? <p className="mt-1 text-xs text-subtle">Downloading {dlPct}%</p> : null}
        {canDownload(track) ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2 min-h-11 w-full gap-2"
            aria-label={`Download ${track.title}`}
            disabled={entry?.phase === "downloading"}
            onClick={() => {
              void downloadLicensedTrack(track)
                .then(() => toast.message(downloadLocationHint()))
                .catch((e) => toast.error(e instanceof Error ? e.message : "Download failed. Please try again."));
            }}
          >
            <Download className="size-4" />
            {entry?.phase === "downloading"
              ? dlPct == null
                ? "Downloading…"
                : `Downloading ${dlPct}%`
              : entry?.phase === "done"
                ? "Downloaded ✓"
                : "Download Track"}
          </Button>
        ) : null}

        {blocked ? (
          <button
            type="button"
            className="absolute inset-0 z-10 flex min-h-11 items-center justify-center bg-bg/80 text-fg backdrop-blur-sm"
            aria-label="Tap Play to start audio"
            onClick={tapPlay}
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold tracking-wide text-accent-fg">
              <Play className="size-4 fill-current" />
              TAP PLAY
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TrackPlayButton({
  track,
  queue,
  className,
}: {
  track: import("@/lib/kchat/music").MusicTrack;
  queue?: import("@/lib/kchat/music").MusicTrack[];
  className?: string;
}) {
  const current = useMusicEngine((s) => s.track);
  const status = useMusicEngine((s) => s.status);
  const needsUserInteraction = useMusicEngine((s) => s.needsUserInteraction);
  const play = useMusicEngine((s) => s.play);
  const retry = useMusicEngine((s) => s.retry);
  const pause = useMusicEngine((s) => s.pause);
  const resume = useMusicEngine((s) => s.resume);
  const tapPlay = useMusicEngine((s) => s.tapPlay);
  const mine = current?.id === track.id;
  const playing = mine && status === "playing";
  const loading = mine && status === "loading";
  const blocked = mine && (needsUserInteraction || status === "blocked");
  const type = playbackTypeOf(track);
  const verb = type === "PREVIEW" ? "Preview" : "Play";
  if (!canPlay(track)) {
    const href = track.providerUrl?.startsWith("https://") ? track.providerUrl : null;
    if (!href) return null;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn("inline-flex min-h-11 items-center px-2 text-xs text-accent", className)}
      >
        View
      </a>
    );
  }
  return (
    <Button
      size="sm"
      variant={mine ? "default" : "ghost"}
      className={cn("min-h-11 shrink-0 px-3", className)}
      aria-label={blocked ? "Tap Play to start audio" : playing ? "Pause" : `${verb} ${track.title}`}
      title={blocked ? "TAP PLAY" : playing ? "Pause" : verb}
      onClick={() => {
        if (playing) pause();
        else if (blocked) tapPlay();
        else if (mine && status === "error") retry();
        else if (mine && (status === "paused" || status === "ended")) resume();
        else play(track, queue);
      }}
    >
      {loading && !blocked ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : playing ? (
        <Pause className="size-4" />
      ) : (
        verb
      )}
    </Button>
  );
}
