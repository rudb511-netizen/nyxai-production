import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Quote,
  Repeat2,
  Share2,
  Eye,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NameMark } from "@/components/kchat/verified-badge";
import { StatusAvatar } from "@/components/kchat/status-avatar";
import { useLiveHostMap } from "@/components/kchat/use-live-hosts";
import { RichBody } from "@/components/kchat/rich-body";
import { ReportSheet } from "@/components/kchat/report-sheet";
import { Button } from "@/components/ui/button";
import { useMeQuery } from "@/lib/kchat/hooks";
import { canDeleteOwned } from "@/lib/kchat/safety";
import {
  deletePost,
  toggleLike,
  toggleSave,
  repostPost,
  votePoll,
  createPost,
  recordPostView,
} from "@/lib/kchat/server/posts";
import type { FeedPost } from "@/lib/kchat/types";
import { cn, formatCount, timeAgo } from "@/lib/utils";
import { triggerHaptic, copyText, nativeShare } from "@/utils/nativeCapabilities";
import { ImageLightbox } from "@/components/kchat/image-lightbox";
import { mediaSrc } from "@/lib/kchat/media-upload";

const recordedViews = new Set<string>();

export function PostCard({
  post,
  onChange,
  compact,
}: {
  post: FeedPost;
  onChange?: () => void;
  compact?: boolean;
}) {
  const nav = useNavigate();
  const me = useMeQuery();
  const liveHosts = useLiveHostMap();
  const liveId = liveHosts.get(post.author.userId) ?? null;
  const [menu, setMenu] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [report, setReport] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteBody, setQuoteBody] = useState("");
  const [translated, setTranslated] = useState<string | null>(null);
  const [views, setViews] = useState(post.views ?? 0);
  const [gallery, setGallery] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const mine = me.data?.userId === post.author.userId;
  const canDelete = canDeleteOwned(me.data?.userId ?? "", post.author.userId, me.data?.role ?? "user");

  useEffect(() => {
    setViews(post.views ?? 0);
  }, [post.views, post.id]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || recordedViews.has(post.id)) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || (entries[0].intersectionRatio ?? 0) < 0.55) return;
        if (recordedViews.has(post.id)) return;
        recordedViews.add(post.id);
        void recordPostView({ data: { id: post.id } })
          .then((r) => setViews(r.views))
          .catch(() => {
            recordedViews.delete(post.id);
          });
        io.disconnect();
      },
      { threshold: 0.55 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [post.id]);

  useEffect(() => {
    if (!menu) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenu(false);
        setConfirmDel(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    }
  }

  return (
    <article ref={rootRef} className="kc-row kc-card-hover border-b border-border px-4 py-4">
      <div className="flex gap-3">
        <Link
          to={liveId ? "/live/$id" : "/u/$username"}
          params={liveId ? { id: liveId } : { username: post.author.username }}
          aria-label={liveId ? `${post.author.displayName}, live now` : post.author.displayName}
        >
          <StatusAvatar
            src={post.author.avatarUrl}
            name={post.author.displayName}
            liveId={liveId}
            interactive={false}
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <Link
              to="/u/$username"
              params={{ username: post.author.username }}
              className="min-w-0 flex-1"
            >
              <div className="flex items-baseline gap-2">
                <NameMark
                  name={post.author.displayName}
                  verifyKind={post.author.verifyKind}
                  isArc={post.author.isArc}
                  isPremium={post.author.isPremium}
                  className="font-medium"
                />
                <span className="truncate text-sm text-muted">@{post.author.username}</span>
                <span className="text-sm text-subtle tabular-nums">{timeAgo(post.createdAt)}</span>
              </div>
            </Link>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="grid size-9 place-items-center rounded-full text-subtle hover:bg-elevated"
                onClick={() => {
                  setMenu((v) => !v);
                  setConfirmDel(false);
                }}
                aria-label="Post actions"
              >
                <MoreHorizontal className="size-4" />
              </button>
              {menu ? (
                <div className="absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-xl bg-surface py-1 text-left shadow-(--shadow-border-hover)">
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-sm hover:bg-elevated"
                    onClick={() => {
                      void copyText(`${window.location.origin}/p/${post.id}`).then((ok) => {
                        toast.success(ok ? "Link copied" : "Could not copy");
                      });
                      setMenu(false);
                    }}
                  >
                    Copy link
                  </button>
                  {canDelete ? (
                    confirmDel ? (
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-sm text-danger hover:bg-elevated"
                        onClick={() => {
                          void act(() => deletePost({ data: { id: post.id } })).then(() => {
                            toast.success("Post deleted");
                            setMenu(false);
                            setConfirmDel(false);
                          });
                        }}
                      >
                        Confirm delete
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-sm text-danger hover:bg-elevated"
                        onClick={() => setConfirmDel(true)}
                      >
                        Delete post
                      </button>
                    )
                  ) : null}
                  {!mine ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-sm hover:bg-elevated"
                      onClick={() => {
                        void act(() =>
                          import("@/lib/kchat/server/platform").then((m) =>
                            m.hideFromFeed({ data: { targetKind: "post", targetId: post.id, reason: "not_interested" } }),
                          ),
                        ).then(() => {
                          toast.success("We’ll show fewer posts like this.");
                          setMenu(false);
                        });
                      }}
                    >
                      Not interested
                    </button>
                  ) : null}
                  {!mine ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-sm hover:bg-elevated"
                      onClick={() => {
                        void act(() =>
                          import("@/lib/kchat/server/graph").then((m) =>
                            m.muteUser({ data: { username: post.author.username } }),
                          ),
                        ).then(() => {
                          toast.success(`Muted @${post.author.username}`);
                          setMenu(false);
                        });
                      }}
                    >
                      Mute @{post.author.username}
                    </button>
                  ) : null}
                  {post.body ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-sm hover:bg-elevated"
                      onClick={() => {
                        void import("@/lib/kchat/server/platform")
                          .then((m) => m.translateText({ data: { text: post.body } }))
                          .then((r) => {
                            setTranslated(r.text);
                            setMenu(false);
                          })
                          .catch((e) => toast.error(e instanceof Error ? e.message : "Could not translate."));
                      }}
                    >
                      Translate
                    </button>
                  ) : null}
                  {!mine ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-sm text-danger hover:bg-elevated"
                      onClick={() => {
                        setReport(true);
                        setMenu(false);
                      }}
                    >
                      Report post
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {post.body ? (
            <p
              className="mt-1 cursor-pointer whitespace-pre-wrap text-[15px] leading-relaxed"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) return;
                nav({ to: "/p/$id", params: { id: post.id } });
              }}
            >
              <RichBody text={post.body} />
            </p>
          ) : null}
          {translated ? (
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-elevated px-3 py-2 text-sm leading-relaxed text-muted">
              {translated}
            </p>
          ) : null}
          {post.media.length > 0 ? (
            <div
              className={cn(
                "mt-3 overflow-hidden rounded-2xl bg-elevated",
                post.media.length > 1 ? "kc-feed-media-grid" : "",
              )}
            >
              {post.media.map((m, i) => {
                const ratio =
                  post.media.length === 1 && m.width && m.height
                    ? { aspectRatio: `${m.width} / ${m.height}` }
                    : undefined;
                const label =
                  m.kind === "video"
                    ? `Play video ${i + 1} of ${post.media.length}`
                    : `View photo ${i + 1} of ${post.media.length}`;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="kc-feed-media"
                    style={ratio}
                    onClick={() => setGallery(i)}
                    aria-label={label}
                  >
                    {m.kind === "video" ? (
                      <>
                        <video
                          src={mediaSrc(m.url)}
                          poster={m.thumbUrl ?? undefined}
                          preload="metadata"
                          playsInline
                          muted
                        />
                        <span className="kc-media-play" aria-hidden="true" />
                      </>
                    ) : (
                      <img
                        src={mediaSrc(m.url)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                    {post.media.length > 1 ? (
                      <span className="absolute bottom-2 right-2 rounded-full bg-bg/70 px-2 py-0.5 text-[10px] tabular-nums">
                        {i + 1}/{post.media.length}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          {post.poll ? (
            <div className="mt-3 space-y-2">
              {post.poll.options.map((o) => {
                const pct = post.poll!.total ? Math.round((o.votes / post.poll!.total) * 100) : 0;
                const mineVote = post.poll!.myVote === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={Boolean(post.poll!.myVote)}
                    onClick={() => act(() => votePoll({ data: { postId: post.id, optionId: o.id } }))}
                    className={cn(
                      "relative w-full overflow-hidden rounded-xl border border-border px-3 py-2.5 text-left text-sm",
                      mineVote && "border-accent",
                    )}
                  >
                    <span
                      className="absolute inset-y-0 left-0 bg-accent/15"
                      style={{ width: post.poll!.myVote ? `${pct}%` : 0 }}
                    />
                    <span className="relative flex justify-between">
                      <span>{o.text}</span>
                      {post.poll!.myVote ? <span className="tabular-nums text-muted">{pct}%</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {post.quoteOf ? (
            <div className="mt-3 rounded-2xl border border-border p-3">
              <p className="text-xs text-muted">@{post.quoteOf.author.username}</p>
              <p className="mt-1 line-clamp-4 text-sm">{post.quoteOf.body}</p>
            </div>
          ) : null}
          {post.location ? <p className="mt-2 text-xs text-muted">{post.location}</p> : null}
          {!compact ? (
            <div className="mt-3 flex items-center justify-between text-muted">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 px-2 text-muted"
                onClick={() => nav({ to: "/p/$id", params: { id: post.id } })}
              >
                <MessageCircle className="size-4" />
                <span className="tabular-nums text-xs">{formatCount(post.comments)}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn("gap-1.5 px-2", post.reposted ? "text-ok" : "text-muted")}
                onClick={() => act(() => repostPost({ data: { id: post.id } }))}
              >
                <Repeat2 className="size-4" />
                <span className="tabular-nums text-xs">{formatCount(post.reposts)}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 px-2 text-muted"
                onClick={() => setQuoteOpen((v) => !v)}
                aria-label="Quote"
              >
                <Quote className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn("gap-1.5 px-2", post.liked ? "text-like" : "text-muted")}
                onClick={() => {
                  triggerHaptic();
                  void act(() => toggleLike({ data: { id: post.id } }));
                }}
              >
                <Heart className={cn("size-4", post.liked && "fill-current")} />
                <span className="tabular-nums text-xs">{formatCount(post.likes)}</span>
              </Button>
              <span className="inline-flex items-center gap-1 px-2 text-xs tabular-nums text-muted" title="Views">
                <Eye className="size-4" />
                {formatCount(views)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(post.saved ? "text-accent" : "text-muted")}
                onClick={() => act(() => toggleSave({ data: { id: post.id } }))}
                aria-label="Save"
              >
                <Bookmark className={cn("size-4", post.saved && "fill-current")} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted"
                aria-label="Share"
                onClick={() => {
                  const url = `${window.location.origin}/p/${post.id}`;
                  void nativeShare({ title: post.author.displayName, text: post.body.slice(0, 180), url }).then((ok) => {
                    if (!ok) toast.message("Link copied if share isn’t available.");
                  });
                }}
              >
                <Share2 className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {quoteOpen ? (
        <div className="mt-2 rounded-2xl border border-border p-3">
          <textarea
            value={quoteBody}
            onChange={(e) => setQuoteBody(e.target.value)}
            placeholder="Add a comment"
            maxLength={4000}
            className="min-h-20 w-full resize-none bg-transparent text-sm outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setQuoteOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void act(() =>
                  createPost({ data: { body: quoteBody, quoteOfId: post.id } }),
                ).then(() => {
                  toast.success("Quoted");
                  setQuoteBody("");
                  setQuoteOpen(false);
                })
              }
            >
              Quote
            </Button>
          </div>
        </div>
      ) : null}
      {report ? (
        <ReportSheet targetKind="post" targetId={post.id} onClose={() => setReport(false)} />
      ) : null}
      {gallery != null && post.media.length > 0 ? (
        <ImageLightbox
          items={post.media.map((m) => ({
            url: m.url,
            kind: m.kind === "video" ? "video" : m.kind === "gif" ? "gif" : "image",
            thumbUrl: m.thumbUrl ?? null,
          }))}
          index={gallery}
          onIndexChange={setGallery}
          onClose={() => setGallery(null)}
        />
      ) : null}
    </article>
  );
}
