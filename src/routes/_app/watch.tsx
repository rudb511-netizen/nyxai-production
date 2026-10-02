import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Bookmark,
  Camera,
  Clapperboard,
  Heart,
  House,
  MessageCircle,
  Music2,
  Pause,
  Play,
  Repeat2,
  Share2,
  MoreHorizontal,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VideoComments } from "@/components/kchat/video-comments";
import { ReportSheet } from "@/components/kchat/report-sheet";
import { RichBody } from "@/components/kchat/rich-body";
import { NameMark } from "@/components/kchat/verified-badge";
import {
  deleteVideo,
  getVideo,
  recordVideoView,
  repostVideo,
  shareVideo,
  toggleVideoLike,
  toggleVideoSave,
  videoFeed,
} from "@/lib/kchat/server/videos";
import { followUser } from "@/lib/kchat/server/social";
import { createWatchParty, hideFromFeed, saveClip, syncWatchParty } from "@/lib/kchat/server/platform";
import type { ShortVideo } from "@/lib/kchat/types";
import { pickAdaptive, type QualityId } from "@/lib/kchat/video-quality";
import { downloadWatermarked } from "@/lib/kchat/watermark";
import { cn, formatCount } from "@/lib/utils";
import { mediaSrc } from "@/lib/kchat/media-upload";
import { copyText, nativeShare, triggerHaptic } from "@/utils/nativeCapabilities";

export const Route = createFileRoute("/_app/watch")({
  component: Watch,
  validateSearch: (s: Record<string, unknown>): { v?: string; party?: string } => ({
    v: typeof s.v === "string" && s.v.trim() ? s.v.trim() : undefined,
    party: typeof s.party === "string" && s.party.trim() ? s.party.trim() : undefined,
  }),
});

function Watch() {
  const { v: openId, party } = Route.useSearch();
  const [tab, setTab] = useState<"fyp" | "following">("fyp");
  const feed = useInfiniteQuery({
    queryKey: ["watch", tab],
    queryFn: ({ pageParam }) => videoFeed({ data: { cursor: pageParam, tab } }),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
  });
  const featured = useQuery({
    queryKey: ["watch-video", openId],
    queryFn: () => getVideo({ data: { id: openId! } }),
    enabled: Boolean(openId),
  });
  const feedItems = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const items =
    featured.data && openId
      ? [featured.data, ...feedItems.filter((x) => x.id !== featured.data!.id)]
      : feedItems;
  const [open, setOpen] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [chrome, setChrome] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setMuted(localStorage.getItem("nyx-watch-muted") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !feed.hasNextPage) return;
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight > el.scrollHeight - el.clientHeight * 1.5) {
        void feed.fetchNextPage();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [feed.hasNextPage, feed.fetchNextPage]);

  if (items.length === 0 && !feed.isLoading) {
    return (
      <div className="kc-watch-stage">
        <div className="grid h-full place-items-center px-6 pb-20 text-center">
          <div>
            <Clapperboard className="mx-auto size-10 text-white/70" />
            <p className="mt-4 font-medium">No videos yet</p>
            <p className="mt-1 text-sm text-white/70">
              {tab === "following"
                ? "Follow creators to fill this row."
                : "Upload a short from Capture or Create."}
            </p>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center gap-6 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
          {(["fyp", "following"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn(
                "pointer-events-auto text-sm font-semibold",
                tab === t ? "text-white" : "text-white/55",
              )}
              onClick={() => setTab(t)}
            >
              {t === "fyp" ? "For you" : "Following"}
            </button>
          ))}
        </div>
        <WatchNav />
      </div>
    );
  }

  return (
    <div className="kc-watch-stage">
      <div
        ref={scroller}
        className="kc-watch-scroller h-full snap-y snap-mandatory overflow-y-auto"
      >
        {items.map((v) => (
          <WatchCard
            key={v.id}
            video={v}
            muted={muted}
            chrome={chrome}
            partyId={party}
            onToggleChrome={() => setChrome((c) => !c)}
            onToggleMute={() =>
              setMuted((m) => {
                const next = !m;
                try {
                  localStorage.setItem("nyx-watch-muted", next ? "1" : "0");
                } catch {
                  /* ignore */
                }
                return next;
              })
            }
            onComments={() => setOpen(v.id)}
            onReport={() => setReportId(v.id)}
            onChanged={() => void feed.refetch()}
          />
        ))}
      </div>
      {chrome ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center gap-6 bg-gradient-to-b from-black/55 to-transparent px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-8">
          {(["fyp", "following"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn(
                "pointer-events-auto text-sm font-semibold",
                tab === t ? "text-white" : "text-white/55",
              )}
              onClick={() => setTab(t)}
            >
              {t === "fyp" ? "For you" : "Following"}
              {tab === t ? <span className="mx-auto mt-1 block h-0.5 w-8 rounded-full bg-white" /> : null}
            </button>
          ))}
        </div>
      ) : null}
      <WatchNav />
      {open ? (
        <VideoComments
          id={open}
          videoAuthorId={items.find((v) => v.id === open)?.author.userId ?? ""}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {reportId ? (
        <ReportSheet targetKind="video" targetId={reportId} onClose={() => setReportId(null)} />
      ) : null}
    </div>
  );
}

function WatchNav() {
  const nav = useNavigate();
  return (
    <nav className="absolute inset-x-0 bottom-0 z-20 flex h-16 items-center justify-around bg-gradient-to-t from-black/80 to-transparent pb-[env(safe-area-inset-bottom)] text-white">
      <button type="button" className="grid place-items-center gap-0.5" onClick={() => nav({ to: "/" })}>
        <House className="size-5" />
        <span className="text-[10px]">Home</span>
      </button>
      <button type="button" className="grid place-items-center gap-0.5 text-white">
        <Clapperboard className="size-5" strokeWidth={2.2} />
        <span className="text-[10px] font-medium">Watch</span>
      </button>
      <button
        type="button"
        className="grid size-11 place-items-center rounded-full bg-capture text-accent-fg"
        onClick={() => nav({ to: "/capture" })}
        aria-label="Capture"
      >
        <Camera className="size-5" />
      </button>
      <button type="button" className="grid place-items-center gap-0.5" onClick={() => nav({ to: "/inbox" })}>
        <MessageCircle className="size-5" />
        <span className="text-[10px]">Inbox</span>
      </button>
      <button type="button" className="grid place-items-center gap-0.5" onClick={() => nav({ to: "/me" })}>
        <span className="text-[10px] font-medium">You</span>
      </button>
    </nav>
  );
}

function playbackSrc(v: ShortVideo, choice: "auto" | string): string {
  const rungs = v.renditions ?? [];
  if (choice !== "auto") {
    const hit = rungs.find((r) => r.quality === choice);
    if (hit) return mediaSrc(hit.url);
  }
  const conn =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType
      : undefined;
  if (rungs.length) {
    const id = pickAdaptive(
      rungs.map((r) => ({ quality: r.quality as QualityId, height: r.height })),
      conn,
    );
    return mediaSrc(rungs.find((r) => r.quality === id)?.url ?? v.mediaUrl);
  }
  return mediaSrc(v.mediaUrl);
}

function WatchCard({
  video: v,
  muted,
  chrome,
  partyId,
  onToggleChrome,
  onToggleMute,
  onComments,
  onReport,
  onChanged,
}: {
  video: ShortVideo;
  muted: boolean;
  chrome: boolean;
  partyId?: string;
  onToggleChrome: () => void;
  onToggleMute: () => void;
  onComments: () => void;
  onReport: () => void;
  onChanged: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [quality, setQuality] = useState<"auto" | string>("auto");
  const [heart, setHeart] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const nav = useNavigate();
  const lastTap = useRef(0);
  const userPausedRef = useRef(false);
  const viewedRef = useRef(false);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const src = playbackSrc(v, quality);
  const rungs = v.renditions ?? [];
  const playLabel =
    quality === "auto"
      ? (rungs.length
          ? pickAdaptive(
              rungs.map((r) => ({ quality: r.quality as QualityId, height: r.height })),
              typeof navigator !== "undefined"
                ? (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType
                : undefined,
            )
          : v.playbackLabel) ?? v.playbackLabel
      : quality;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    viewedRef.current = false;
    userPausedRef.current = false;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries[0]?.isIntersecting && (entries[0]?.intersectionRatio ?? 0) > 0.65;
        if (vis) {
          if (userPausedRef.current) return;
          void el.play()
            .then(() => {
              setPlaying(true);
              setAutoplayBlocked(false);
            })
            .catch(() => {
              const wasMuted = el.muted;
              el.muted = true;
              void el.play()
                .then(() => {
                  setPlaying(true);
                  if (!wasMuted) setAutoplayBlocked(true);
                })
                .catch(() => setPlaying(false));
            });
        } else {
          el.pause();
          setPlaying(false);
          userPausedRef.current = false;
        }
      },
      { threshold: [0.65] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [v.id, src]);

  function markView() {
    if (viewedRef.current) return;
    viewedRef.current = true;
    void recordVideoView({ data: { id: v.id, watchMs: 800 } }).catch(() => {
      viewedRef.current = false;
    });
  }

  useEffect(() => {
    if (!v.musicPreviewUrl) return;
    const a = new Audio(v.musicPreviewUrl);
    a.loop = true;
    a.volume = 0.7;
    musicRef.current = a;
    return () => {
      a.pause();
      musicRef.current = null;
    };
  }, [v.musicPreviewUrl]);

  useEffect(() => {
    if (!partyId) return;
    const tick = () => {
      const el = videoRef.current;
      void syncWatchParty({
        data: {
          id: partyId,
          positionMs: el ? Math.floor(el.currentTime * 1000) : undefined,
          playing,
        },
      })
        .then((s) => {
          if (!el || s.videoId !== v.id) return;
          if (!s.isHost) {
            const drift = Math.abs(el.currentTime * 1000 - s.positionMs);
            if (drift > 1500) el.currentTime = s.positionMs / 1000;
            if (s.playing) void el.play().catch(() => {});
            else el.pause();
          }
        })
        .catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 2000);
    return () => window.clearInterval(t);
  }, [partyId, playing, v.id]);

  useEffect(() => {
    const a = musicRef.current;
    if (!a) return;
    a.muted = muted;
    if (playing) void a.play().catch(() => {});
    else a.pause();
  }, [muted, playing, v.musicPreviewUrl]);

  function onTap() {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      setHeart(true);
      window.setTimeout(() => setHeart(false), 700);
      if (!v.liked) {
        void toggleVideoLike({ data: { id: v.id } })
          .then(onChanged)
          .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"));
      }
      return;
    }
    lastTap.current = now;
    window.setTimeout(() => {
      if (Date.now() - lastTap.current >= 260) {
        const el = videoRef.current;
        if (!el) return;
        if (el.paused) {
          userPausedRef.current = false;
          setAutoplayBlocked(false);
          void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
          userPausedRef.current = true;
          el.pause();
          setPlaying(false);
        }
        onToggleChrome();
      }
    }, 280);
  }

  return (
    <section className="kc-watch-card">
      <video
        ref={videoRef}
        src={src}
        className="size-full object-contain"
        playsInline
        loop
        muted={muted}
        onPlay={() => {
          setPlaying(true);
          markView();
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration) setProgress(el.currentTime / el.duration);
        }}
        onClick={onTap}
      />
      {!playing ? (
        <button
          type="button"
          className="absolute left-1/2 top-1/2 z-10 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white"
          aria-label="Play"
          onClick={() => {
            const el = videoRef.current;
            if (!el) return;
            userPausedRef.current = false;
            setAutoplayBlocked(false);
            void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
          }}
        >
          <Play className="size-7 fill-current" />
        </button>
      ) : null}
      {autoplayBlocked ? (
        <button
          type="button"
          className="absolute left-1/2 top-[58%] z-10 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1.5 text-xs"
          onClick={onToggleMute}
        >
          Tap for sound
        </button>
      ) : null}
      {heart ? (
        <Heart className="kc-heart-pop absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 fill-like text-like" />
      ) : null}
      <div
        className="kc-watch-progress absolute inset-x-0 top-0 z-10 h-3 cursor-pointer"
        onPointerDown={(e) => {
          const el = videoRef.current;
          if (!el || !el.duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          el.currentTime = pct * el.duration;
          setProgress(pct);
        }}
      >
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      {chrome ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-16 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-4 pb-4 pt-16">
            <Link
              to="/u/$username"
              params={{ username: v.author.username }}
              className="pointer-events-auto inline-flex items-center gap-2 font-medium"
            >
              <NameMark name={v.author.displayName} verifyKind={v.author.verifyKind} isArc={v.author.isArc} isPremium={v.author.isPremium} />
              <span className="text-white/70">@{v.author.username}</span>
            </Link>
            <p className="mt-1 max-w-[calc(100%-5.5rem)] text-sm leading-relaxed">
              <RichBody text={v.caption} />
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-white/75">
              <Music2 className="size-3.5" />
              {v.musicTitle || (v.originalAudio ? "Original audio" : "Sound")}
              {v.musicLicense ? ` · ${v.musicLicense}` : ""}
            </p>
            <p className="mt-1 text-[11px] text-white/55">
              {v.sourceLabel && playLabel && v.sourceLabel !== playLabel
                ? `Source was ${v.sourceLabel} · playing ${playLabel}`
                : `Playing ${playLabel ?? v.playbackLabel ?? "auto"}`}
              {v.hdr ? " · HDR not kept after encode" : ""}
              {" · no CDN — clip is stored here"}
            </p>
          </div>
          <div className="absolute bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-2 z-10 flex max-h-[70%] flex-col items-center gap-3 overflow-y-auto pb-1">
            <Link to="/u/$username" params={{ username: v.author.username }} className="relative" aria-label={`${v.author.displayName} profile`}>
              <span className="grid size-11 place-items-center overflow-hidden rounded-full ring-2 ring-white">
                {v.author.avatarUrl ? <img src={v.author.avatarUrl} alt="" className="size-full object-cover" /> : <UserRound className="size-5" />}
              </span>
            </Link>
            <WatchAction label="Like" count={v.likes} pressed={v.liked} onClick={() => {
              triggerHaptic("light");
              void toggleVideoLike({ data: { id: v.id } }).then(onChanged).catch((e) => toast.error(e instanceof Error ? e.message : "Could not update the like"));
            }}>
              <Heart className={cn("size-7", v.liked && "fill-like text-like")} />
            </WatchAction>
            <WatchAction label="Comment" count={v.comments} onClick={onComments}>
              <MessageCircle className="size-7" />
            </WatchAction>
            <WatchAction label="Save" count={v.saveCount ?? 0} pressed={v.saved} onClick={() => {
              triggerHaptic("light");
              void toggleVideoSave({ data: { id: v.id } }).then(onChanged).catch((e) => toast.error(e instanceof Error ? e.message : "Could not save"));
            }}>
              <Bookmark className={cn("size-7", v.saved && "fill-current text-accent")} />
            </WatchAction>
            <WatchAction label="Share" count={v.shareCount ?? 0} onClick={() => setShareOpen(true)}>
              <Share2 className="size-7" />
            </WatchAction>
            <WatchAction label="Repost" onClick={() => {
              triggerHaptic("light");
              void repostVideo({ data: { id: v.id } }).then((r) => { toast.success(r.reposted ? "Reposted" : "Repost removed"); onChanged(); }).catch((e) => toast.error(e instanceof Error ? e.message : "Could not repost"));
            }}>
              <Repeat2 className="size-7" />
            </WatchAction>
            <WatchAction label="Remix" onClick={() => {
              try {
                sessionStorage.setItem("nyx-remix-of", v.id);
                sessionStorage.setItem("omni-create-tab", "video");
              } catch { /* ignore */ }
              nav({ to: "/capture" });
            }}>
              <Camera className="size-7" />
            </WatchAction>
            <WatchAction label="Party" onClick={() => {
              void createWatchParty({ data: { videoId: v.id } }).then((r) => {
                const url = `${window.location.origin}/watch?v=${encodeURIComponent(v.id)}&party=${encodeURIComponent(r.id)}`;
                void copyText(url);
                toast.success("Watch party link copied");
              }).catch((e) => toast.error(e instanceof Error ? e.message : "Could not start a party"));
            }}>
              <Clapperboard className="size-7" />
            </WatchAction>
            <WatchAction label="More" onClick={() => setMoreOpen(true)}>
              <MoreHorizontal className="size-7" />
            </WatchAction>
          </div>
          {shareOpen ? (
            <ShareSheet
              title={v.caption || "NYX Watch"}
              url={typeof window !== "undefined" ? `${window.location.origin}/watch?v=${encodeURIComponent(v.id)}` : ""}
              onClose={() => setShareOpen(false)}
              onShared={() => { void shareVideo({ data: { id: v.id } }).then(onChanged).catch(() => undefined); }}
            />
          ) : null}
          {moreOpen ? (
            <div className="absolute inset-x-0 bottom-0 z-30 rounded-t-3xl bg-zinc-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white" role="dialog" aria-label="More">
              <p className="mb-2 text-sm font-medium">More</p>
              <div className="grid gap-1">
                <SheetBtn label="Copy link" onClick={() => { void copyText(`${window.location.origin}/watch?v=${encodeURIComponent(v.id)}`); toast.success("Link copied"); setMoreOpen(false); }} />
                <SheetBtn label="Report" onClick={() => { setMoreOpen(false); onReport(); }} />
                {!v.mine ? <SheetBtn label="Not interested" onClick={() => { void hideFromFeed({ data: { targetKind: "video", targetId: v.id } }).then(() => { toast.success("We'll show fewer videos like this."); onChanged(); }).catch((e) => toast.error(e instanceof Error ? e.message : "Could not hide")); setMoreOpen(false); }} /> : null}
                {v.downloadAllowed !== false ? <SheetBtn label="Download" onClick={() => { void downloadWatermarked({ src: v.mediaUrl, kind: "video", username: v.author.username }).then(() => toast.success("Saved with NYX watermark")).catch((e) => toast.error(e instanceof Error ? e.message : "Could not download.")); setMoreOpen(false); }} /> : null}
                {v.mine ? <SheetBtn label="Delete" onClick={() => { void deleteVideo({ data: { id: v.id } }).then(() => { toast.success("Video deleted"); onChanged(); }).catch((e) => toast.error(e instanceof Error ? e.message : "Could not delete.")); setMoreOpen(false); }} /> : null}
                <SheetBtn label={muted ? "Unmute" : "Mute"} onClick={() => { onToggleMute(); setMoreOpen(false); }} />
                <label className="flex items-center justify-between rounded-xl px-3 py-2 text-sm">
                  Quality
                  <select className="rounded-full bg-white/10 px-2 py-1" value={quality} onChange={(e) => setQuality(e.target.value)}>
                    <option value="auto">Auto</option>
                    {rungs.map((r) => <option key={r.quality} value={r.quality}>{r.quality}</option>)}
                  </select>
                </label>
                <SheetBtn label="Close" onClick={() => setMoreOpen(false)} />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function WatchAction({
  label,
  count,
  pressed,
  onClick,
  children,
}: {
  label: string;
  count?: number;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="kc-press flex min-h-11 min-w-11 flex-col items-center gap-0.5" aria-label={label} aria-pressed={pressed} onClick={onClick}>
      {children}
      <span className="text-[11px] tabular-nums">{count != null ? formatCount(count) : label}</span>
    </button>
  );
}

function SheetBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="rounded-xl px-3 py-3 text-left text-sm hover:bg-white/10" onClick={onClick}>
      {label}
    </button>
  );
}

function ShareSheet({ title, url, onClose, onShared }: { title: string; url: string; onClose: () => void; onShared: () => void }) {
  function go(href: string) {
    onShared();
    window.open(href, "_blank", "noopener,noreferrer");
    onClose();
  }
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 rounded-t-3xl bg-zinc-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white" role="dialog" aria-label="Share">
      <p className="mb-2 text-sm font-medium">Share</p>
      <div className="grid gap-1">
        <SheetBtn label="Copy link" onClick={() => { void copyText(url); toast.success("Link copied"); onShared(); onClose(); }} />
        <SheetBtn label="Share…" onClick={() => {
          void (async () => {
            const ok = await nativeShare({ title, url, text: title });
            if (!ok) {
              await copyText(url);
              toast.message("Sharing isn't available here. Link copied.");
            }
            onShared();
            onClose();
          })();
        }} />
        <SheetBtn label="WhatsApp" onClick={() => go(`https://wa.me/?text=${encodeURIComponent(url)}`)} />
        <SheetBtn label="Telegram" onClick={() => go(`https://t.me/share/url?url=${encodeURIComponent(url)}`)} />
        <SheetBtn label="Facebook" onClick={() => go(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`)} />
        <SheetBtn label="SMS" onClick={() => { onShared(); window.location.href = `sms:?&body=${encodeURIComponent(url)}`; onClose(); }} />
        <SheetBtn label="Close" onClick={onClose} />
      </div>
    </div>
  );
}

