import { Heart, ImagePlus, Search, Send, Sticker, X } from "lucide-react";
import { useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MentionBox } from "@/components/kchat/mention-box";
import { ReportSheet } from "@/components/kchat/report-sheet";
import { RichBody } from "@/components/kchat/rich-body";
import { NameMark } from "@/components/kchat/verified-badge";
import { useMeQuery } from "@/lib/kchat/hooks";
import { compressImage } from "@/lib/kchat/media-client";
import { OMNI_AI_USER_ID } from "@/lib/kchat/omni-ids";
import { canDeleteComment } from "@/lib/kchat/safety";
import {
  addVideoComment,
  deleteVideoComment,
  editVideoComment,
  listVideoComments,
  toggleVideoCommentLike,
} from "@/lib/kchat/server/videos";
import { cn, timeAgo } from "@/lib/utils";
import { ImageLightbox } from "@/components/kchat/image-lightbox";
import { StickerPicker } from "@/components/kchat/sticker-picker";
import { StickerBubble } from "@/components/kchat/sticker-bubble";

type CommentRow = {
  id: string;
  body: string;
  createdAt: string;
  parentId: string | null;
  likes: number;
  liked: boolean;
  mediaUrl?: string | null;
  editedAt?: string | null;
  replyCount: number;
  sticker?: { id: string; name: string; url: string | null; mediaKind?: string; packId?: string } | null;
  author: {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    verifyKind: "none" | "org" | "founder" | "developer" | "arc";
    isArc: boolean;
  };
};

export function VideoComments({
  id,
  videoAuthorId,
  onClose,
}: {
  id: string;
  videoAuthorId: string;
  onClose: () => void;
}) {
  const me = useMeQuery();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [media, setMedia] = useState<string | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const list = useInfiniteQuery({
    queryKey: ["vcomments", id, search],
    queryFn: ({ pageParam }) =>
      listVideoComments({ data: { id, q: search || undefined, cursor: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.nextCursor,
    refetchInterval: 4000,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const count = items.reduce((n, c) => n + 1 + (c.replyCount ?? 0), 0);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["vcomments", id] });
  }

  async function submit(stickerId?: string | null) {
    const body = text.trim();
    if (!body && !media && !stickerId) return;
    try {
      await addVideoComment({
        data: { id, body, parentId: replyTo?.id ?? null, mediaUrl: media, stickerId: stickerId ?? null },
      });
      setText("");
      setMedia(null);
      setReplyTo(null);
      setStickerOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not comment.");
    }
  }

  return (
    <div className="kc-comments">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Search className="size-4 text-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setSearch(q.trim());
          }}
          placeholder="Search comments"
          className="h-9 border-0 bg-transparent px-0"
          aria-label="Search comments"
        />
        <p className="shrink-0 text-sm font-medium tabular-nums">{count}</p>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close comments">
          <X className="size-4" />
        </Button>
      </div>
      <ul
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 80) void list.fetchNextPage();
        }}
      >
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Be the first to comment.</p>
        ) : (
          items.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              videoId={id}
              videoAuthorId={videoAuthorId}
              viewerId={me.data?.userId ?? ""}
              role={me.data?.role ?? "user"}
              onReply={(row) => setReplyTo(row)}
              onReport={(id) => setReport(id)}
              onChanged={refresh}
            />
          ))
        )}
      </ul>
      {replyTo ? (
        <p className="flex items-center justify-between bg-elevated px-4 py-1.5 text-xs text-muted">
          Replying to {replyTo.author.displayName}
          <button type="button" onClick={() => setReplyTo(null)}>
            Cancel
          </button>
        </p>
      ) : null}
      {media ? (
        <div className="px-4 pt-2">
          <img src={media} alt="" className="h-16 rounded-lg object-cover" />
        </div>
      ) : null}
      <form
        className="flex items-end gap-2 border-t border-border px-3 py-3 pb-[max(0.75rem,var(--kc-safe-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <button
          type="button"
          className="grid size-11 place-items-center rounded-full bg-elevated"
          aria-label="Attach photo"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="size-4" />
        </button>
        <MentionBox
          value={text}
          onChange={setText}
          placeholder="Comment"
          minHeightClass="min-h-11"
          className="min-w-0 flex-1"
          onSubmit={() => void submit()}
        />
        <Button type="submit" size="icon" disabled={!text.trim() && !media} aria-label="Send comment">
          <Send className="size-4" />
        </Button>
        <button
          type="button"
          className="grid size-11 place-items-center rounded-full bg-elevated"
          aria-label="Stickers"
          onClick={() => setStickerOpen((v) => !v)}
        >
          <Sticker className="size-4" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            void compressImage(f, { maxEdge: 720, maxBytes: 180_000 })
              .then((r) => setMedia(r.dataUrl))
              .catch((err) => toast.error(err instanceof Error ? err.message : "Could not attach."));
          }}
        />
      </form>
      {stickerOpen ? (
        <div className="border-t border-border px-3 py-2">
          <StickerPicker compact onPick={(s) => void submit(s.stickerId)} />
        </div>
      ) : null}
      {report ? (
        <ReportSheet targetKind="video_comment" targetId={report} onClose={() => setReport(null)} />
      ) : null}
    </div>
  );
}

function CommentItem({
  comment: c,
  videoId,
  videoAuthorId,
  viewerId,
  role,
  onReply,
  onReport,
  onChanged,
  depth = 0,
}: {
  comment: CommentRow;
  videoId: string;
  videoAuthorId: string;
  viewerId: string;
  role: string;
  onReply: (c: CommentRow) => void;
  onReport: (id: string) => void;
  onChanged: () => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [kids, setKids] = useState<CommentRow[] | null>(null);
  const [photo, setPhoto] = useState(false);
  const mine = viewerId === c.author.userId;
  const canDel = canDeleteComment({
    viewerId,
    commentAuthorId: c.author.userId,
    postAuthorId: videoAuthorId,
    role,
  });
  const omni = c.author.userId === OMNI_AI_USER_ID;

  async function loadReplies() {
    if (open) {
      setOpen(false);
      return;
    }
    const page = await listVideoComments({ data: { id: videoId, parentId: c.id } });
    setKids(page.items);
    setOpen(true);
  }

  return (
    <li className={cn("flex gap-2", omni && "rounded-xl bg-ai/10 p-2", depth > 0 && "ml-8")}>
      <Avatar src={c.author.avatarUrl} name={c.author.displayName} className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <NameMark name={c.author.displayName} verifyKind={c.author.verifyKind} isArc={c.author.isArc} />
          <span className="ml-1.5 text-[11px] text-muted">{timeAgo(c.createdAt)}</span>
          {c.editedAt ? <span className="ml-1 text-[11px] text-muted">edited</span> : null}
        </p>
        {edit ? (
          <form
            className="mt-1 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void editVideoComment({ data: { id: c.id, body: draft } })
                .then(() => {
                  setEdit(false);
                  onChanged();
                })
                .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
            }}
          >
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        ) : (
          <p className="mt-0.5 text-sm leading-relaxed">
            <RichBody text={c.body} />
          </p>
        )}
        {c.mediaUrl ? (
          <button type="button" className="kc-chat-media mt-2" onClick={() => setPhoto(true)} aria-label="View photo">
            <img src={c.mediaUrl} alt="" />
          </button>
        ) : null}
        {c.sticker ? (
          <StickerBubble
            packId={c.sticker.packId}
            stickerId={c.sticker.id}
            mediaUrl={c.sticker.url}
            name={c.sticker.name}
            mediaKind={c.sticker.mediaKind}
            className="size-16"
          />
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted">
          <button
            type="button"
            className={cn("inline-flex items-center gap-1", c.liked && "text-like")}
            onClick={() => void toggleVideoCommentLike({ data: { id: c.id } }).then(onChanged)}
          >
            <Heart className={cn("size-3.5", c.liked && "fill-like")} />
            {c.likes}
          </button>
          <button type="button" onClick={() => onReply(c)}>
            Reply
          </button>
          {c.replyCount > 0 ? (
            <button type="button" onClick={() => void loadReplies()}>
              {open ? "Hide replies" : `View replies (${c.replyCount})`}
            </button>
          ) : null}
          {mine ? (
            <button type="button" onClick={() => setEdit((v) => !v)}>
              Edit
            </button>
          ) : null}
          {canDel ? (
            <button
              type="button"
              className="text-danger"
              onClick={() =>
                void deleteVideoComment({ data: { id: c.id } })
                  .then(onChanged)
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
              }
            >
              Delete
            </button>
          ) : null}
          {!mine ? (
            <button type="button" onClick={() => onReport(c.id)}>
              Report
            </button>
          ) : null}
        </div>
        {open && kids ? (
          <ul className="mt-3 space-y-3">
            {kids.map((k) => (
              <CommentItem
                key={k.id}
                comment={k}
                videoId={videoId}
                videoAuthorId={videoAuthorId}
                viewerId={viewerId}
                role={role}
                onReply={onReply}
                onReport={onReport}
                onChanged={onChanged}
                depth={depth + 1}
              />
            ))}
          </ul>
        ) : null}
      </div>
      {photo && c.mediaUrl ? (
        <ImageLightbox item={{ url: c.mediaUrl, kind: "image", sender: c.author.displayName }} onClose={() => setPhoto(false)} />
      ) : null}
    </li>
  );
}
