import { ChevronLeft, ChevronRight, LoaderCircle, Maximize2, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { mediaSrc } from "@/lib/kchat/media-upload";
import { cn } from "@/lib/utils";
import { MediaActions } from "@/components/kchat/media-actions";
import { hideKeyboard, setOrientationLock, triggerHaptic } from "@/utils/nativeCapabilities";

export type LightboxItem = {
  url: string;
  kind?: "image" | "video" | "gif";
  sender?: string;
  at?: string;
  fileName?: string | null;
  mime?: string | null;
  thumbUrl?: string | null;
};

export function isVisualMediaUrl(kind: string | undefined, url?: string | null): "image" | "video" | null {
  if (!url) return null;
  if (kind === "voice" || kind === "file" || kind === "sticker" || kind === "location" || kind === "poll") return null;
  if (kind === "video" || url.startsWith("data:video") || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return "video";
  if (kind === "image" || kind === "gif" || url.startsWith("data:image") || /\.(jpe?g|png|gif|webp|avif|heic)(\?|$)/i.test(url)) {
    return "image";
  }
  return null;
}

function isVideo(item: LightboxItem) {
  return item.kind === "video" || item.url.startsWith("data:video") || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(item.url);
}

function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function ImageLightbox({
  item,
  items,
  index = 0,
  onIndexChange,
  onClose,
  footer,
}: {
  item?: LightboxItem | null;
  items?: LightboxItem[] | null;
  index?: number;
  onIndexChange?: (i: number) => void;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const list = items && items.length > 0 ? items : item ? [item] : [];
  const [internal, setInternal] = useState(index);
  const i = Math.min(Math.max(0, onIndexChange ? index : internal), Math.max(0, list.length - 1));
  const current = list[i] ?? null;
  const wrap = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closedByPop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [ready, setReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const start = useRef({
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    dist: 0,
    scale: 1,
    pointers: new Map<number, { x: number; y: number }>(),
    lastTap: 0,
    swiping: false,
    moved: false,
  });
  const open = Boolean(current);

  useEffect(() => {
    setInternal(index);
  }, [index]);

  const go = useCallback(
    (next: number) => {
      if (list.length < 2) return;
      const n = (next + list.length) % list.length;
      triggerHaptic("light");
      if (onIndexChange) onIndexChange(n);
      else setInternal(n);
    },
    [list.length, onIndexChange],
  );

  useEffect(() => {
    setScale(1);
    setTx(0);
    setTy(0);
    setPlaying(true);
    setProgress(0);
    setDuration(0);
    setReady(false);
    setFailed(false);
    setBuffering(true);
  }, [current?.url, i]);

  useLayoutEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("kc-media-open");
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void hideKeyboard();
    void setOrientationLock("unlock");
    closedByPop.current = false;
    const onPop = () => {
      closedByPop.current = true;
      onCloseRef.current();
    };
    if (typeof window !== "undefined" && !window.history.state?.nyxMedia) {
      window.history.pushState({ nyxMedia: true }, "");
    }
    window.addEventListener("popstate", onPop);
    return () => {
      document.documentElement.classList.remove("kc-media-open");
      document.body.style.overflow = prev;
      window.removeEventListener("popstate", onPop);
      if (!closedByPop.current && window.history.state?.nyxMedia) {
        window.history.back();
      }
    };
  }, [open]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !current || !isVideo(current)) return;
    el.volume = volume;
    el.muted = muted;
    void el.play().catch(() => {
      el.muted = true;
      setMuted(true);
      void el.play().catch(() => setPlaying(false));
    });
    return () => {
      el.pause();
    };
  }, [current?.url, i]);

  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      el.volume = volume;
      el.muted = muted;
    }
  }, [muted, volume]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
      if (e.key === "ArrowLeft") go(i - 1);
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === " " && isVideo(current)) {
        e.preventDefault();
        const el = videoRef.current;
        if (!el) return;
        if (el.paused) void el.play();
        else el.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, go, i]);

  const bumpChrome = useCallback(() => {
    setChrome(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChrome(false), 3200);
  }, []);

  useEffect(() => {
    bumpChrome();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [i, bumpChrome]);

  const distOf = useCallback((pts: Map<number, { x: number; y: number }>) => {
    const arr = [...pts.values()];
    if (arr.length < 2) return 0;
    const a = arr[0]!;
    const b = arr[1]!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }, []);

  if (!current || typeof document === "undefined") return null;
  const src = mediaSrc(current.url);
  const video = isVideo(current);
  const showChrome = chrome || !ready || failed;

  const node = (
    <div
      className="kc-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      data-nyx-overlay="media"
    >
      <div className={cn("kc-lightbox-chrome", showChrome ? "is-on" : "is-off")}>
        <button type="button" className="kc-lightbox-close" onClick={() => onCloseRef.current()} aria-label="Close">
          <X className="size-5" />
        </button>
        <div className="kc-lightbox-meta">
          {current.sender ? <span>{current.sender}</span> : null}
          {current.at ? <span>{current.at}</span> : null}
          {list.length > 1 ? (
            <span aria-live="polite" className="kc-lightbox-count">
              {i + 1} / {list.length}
            </span>
          ) : null}
        </div>
      </div>
      {list.length > 1 && showChrome ? (
        <>
          <button
            type="button"
            className="kc-lightbox-nav kc-lightbox-nav-prev"
            onClick={() => go(i - 1)}
            aria-label="Previous"
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            className="kc-lightbox-nav kc-lightbox-nav-next"
            onClick={() => go(i + 1)}
            aria-label="Next"
          >
            <ChevronRight className="size-6" />
          </button>
        </>
      ) : null}
      <div
        ref={wrap}
        className="kc-lightbox-stage"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("input, button")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const s = start.current;
          s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          s.x = e.clientX;
          s.y = e.clientY;
          s.tx = tx;
          s.ty = ty;
          s.scale = scale;
          s.dist = distOf(s.pointers);
          s.swiping = false;
          s.moved = false;
          const now = Date.now();
          if (s.pointers.size === 1 && now - s.lastTap < 280) {
            if (scale > 1.2) {
              setScale(1);
              setTx(0);
              setTy(0);
            } else if (!video) {
              setScale(2.6);
            }
            s.lastTap = 0;
          } else {
            s.lastTap = now;
          }
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s.pointers.has(e.pointerId)) return;
          s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (s.pointers.size >= 2) {
            const d = distOf(s.pointers);
            if (s.dist > 8) {
              const next = Math.min(5, Math.max(1, s.scale * (d / s.dist)));
              setScale(next);
              s.moved = true;
            }
            return;
          }
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.hypot(dx, dy) > 8) s.moved = true;
          if (scale > 1.05) {
            setTx(s.tx + dx);
            setTy(s.ty + dy);
            return;
          }
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 18) {
            s.swiping = true;
            setTx(dx);
            return;
          }
          if (dy > 0) setTy(dy);
        }}
        onPointerUp={(e) => {
          const s = start.current;
          s.pointers.delete(e.pointerId);
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* already released */
          }
          if (s.pointers.size === 0) {
            if (s.swiping && Math.abs(tx) > 56 && list.length > 1) {
              go(tx < 0 ? i + 1 : i - 1);
              setTx(0);
              setTy(0);
            } else if (scale <= 1.05 && ty > 88) {
              onCloseRef.current();
            } else {
              setTx(0);
              if (scale <= 1.05) setTy(0);
              if (!s.moved) {
                setChrome((v) => !v);
                if (hideTimer.current) window.clearTimeout(hideTimer.current);
                hideTimer.current = window.setTimeout(() => setChrome(false), 3200);
              }
            }
          }
        }}
        onPointerCancel={(e) => {
          start.current.pointers.delete(e.pointerId);
        }}
      >
        {!ready && !failed ? (
          <div className="kc-lightbox-loading" aria-live="polite">
            <LoaderCircle className="size-8 animate-spin" />
          </div>
        ) : null}
        {failed ? (
          <p className="kc-lightbox-fail">Couldn’t load this media.</p>
        ) : null}
        {video ? (
          <video
            ref={videoRef}
            src={src}
            poster={current.thumbUrl ?? undefined}
            playsInline
            autoPlay
            preload="auto"
            className="kc-lightbox-media"
            style={{ transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})` }}
            muted={muted}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => {
              setBuffering(false);
              setReady(true);
            }}
            onCanPlay={() => {
              setBuffering(false);
              setReady(true);
            }}
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration || 0);
              setReady(true);
            }}
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (el.duration) setProgress(el.currentTime / el.duration);
            }}
            onError={() => {
              setFailed(true);
              setReady(true);
            }}
          />
        ) : (
          <img
            src={src}
            alt=""
            draggable={false}
            className="kc-lightbox-media"
            style={{
              transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
              opacity: scale <= 1.05 ? Math.max(0.4, 1 - ty / 280) : 1,
            }}
            onLoad={() => setReady(true)}
            onError={() => {
              setFailed(true);
              setReady(true);
            }}
          />
        )}
        {video && buffering && ready ? (
          <div className="kc-lightbox-loading is-overlay">
            <LoaderCircle className="size-8 animate-spin" />
          </div>
        ) : null}
      </div>
      {video ? (
        <div
          className={cn("kc-lightbox-video-chrome", showChrome ? "is-on" : "is-off")}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="kc-lightbox-ctl"
            onClick={() => {
              const el = videoRef.current;
              if (!el) return;
              if (el.paused) void el.play();
              else el.pause();
              bumpChrome();
            }}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </button>
          <span className="kc-lightbox-time">{fmtTime(progress * duration)}</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            aria-label="Seek"
            className="kc-lightbox-seek"
            onChange={(e) => {
              const el = videoRef.current;
              if (!el || !el.duration) return;
              el.currentTime = (Number(e.target.value) / 1000) * el.duration;
              bumpChrome();
            }}
          />
          <span className="kc-lightbox-time">{fmtTime(duration)}</span>
          <button
            type="button"
            className="kc-lightbox-ctl"
            onClick={() => {
              const el = videoRef.current;
              const next = !muted;
              setMuted(next);
              if (el) el.muted = next;
              bumpChrome();
            }}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            aria-label="Volume"
            className="kc-lightbox-vol"
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setVolume(v);
              const el = videoRef.current;
              if (el) {
                el.volume = v;
                if (v > 0 && muted) {
                  setMuted(false);
                  el.muted = false;
                }
              }
              bumpChrome();
            }}
          />
          <button
            type="button"
            className="kc-lightbox-ctl"
            onClick={() => {
              const el = videoRef.current;
              if (!el) return;
              const anyEl = el as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
              if (el.requestFullscreen) void el.requestFullscreen();
              else anyEl.webkitEnterFullscreen?.();
              bumpChrome();
            }}
            aria-label="Fullscreen"
          >
            <Maximize2 className="size-5" />
          </button>
        </div>
      ) : null}
      <div className={cn("kc-lightbox-actions", showChrome ? "is-on" : "is-off")}>
        <MediaActions
          className="kc-lightbox-action-row"
          url={current.url}
          kind={video ? "video" : "image"}
          fileName={current.fileName}
          mime={current.mime}
        />
        {footer}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
