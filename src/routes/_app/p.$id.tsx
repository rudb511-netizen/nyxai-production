import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PostCard } from "@/components/kchat/post-card";
import { ReportSheet } from "@/components/kchat/report-sheet";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MentionBox } from "@/components/kchat/mention-box";
import { RichBody } from "@/components/kchat/rich-body";
import { NameMark } from "@/components/kchat/verified-badge";
import { useMeQuery } from "@/lib/kchat/hooks";
import { OMNI_AI_USER_ID } from "@/lib/kchat/omni-ids";
import { canDeleteComment } from "@/lib/kchat/safety";
import { addComment, deleteComment, editComment, getPost, listComments, pinComment, toggleCommentLike } from "@/lib/kchat/server/posts";
import type { CommentNode } from "@/lib/kchat/types";
import { timeAgo, cn } from "@/lib/utils";
import { StickerPicker } from "@/components/kchat/sticker-picker";
import { StickerBubble } from "@/components/kchat/sticker-bubble";

export const Route = createFileRoute("/_app/p/$id")({ component: PostPage });

function PostPage() {
  const { id } = Route.useParams();
  const me = useMeQuery();
  const post = useQuery({ queryKey: ["post", id], queryFn: () => getPost({ data: { id } }) });
  const [text, setText] = useState("");
  const [stickerOpen, setStickerOpen] = useState(false);
  const [sort, setSort] = useState<"newest" | "liked" | "relevant">("newest");
  const comments = useQuery({
    queryKey: ["comments", id, sort],
    queryFn: () => listComments({ data: { postId: id, sort } }),
    refetchInterval: 4_000,
  });
  const send = useMutation({
    mutationFn: (payload: { body: string; stickerId?: string | null }) =>
      addComment({ data: { postId: id, body: payload.body, stickerId: payload.stickerId } }),
    onSuccess: () => {
      setText("");
      setStickerOpen(false);
      void comments.refetch();
      void post.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (post.isError) return <p className="p-6 text-sm text-muted">{(post.error as Error).message}</p>;
  if (!post.data) return <p className="p-6 text-sm text-muted">Loading…</p>;

  return (
    <div>
      <PostCard post={post.data} onChange={() => void post.refetch()} />
      <form
        className="space-y-2 border-b border-border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send.mutate({ body: text });
        }}
      >
        <MentionBox
          value={text}
          onChange={setText}
          placeholder="Comment"
          minHeightClass="min-h-16"
          onSubmit={() => {
            if (text.trim()) send.mutate({ body: text });
          }}
        />
        <div className="flex items-center justify-between">
          <Button type="button" size="sm" variant="ghost" onClick={() => setStickerOpen((v) => !v)}>
            Stickers
          </Button>
          <Button type="submit" disabled={send.isPending || !text.trim()}>
            Reply
          </Button>
        </div>
        {stickerOpen ? (
          <StickerPicker
            compact
            onPick={(s) => send.mutate({ body: text, stickerId: s.stickerId })}
          />
        ) : null}
      </form>
      <div className="flex gap-2 px-4 pt-3 text-xs">
        {(["newest", "liked", "relevant"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSort(s)}
            className={cn("rounded-full px-3 py-1 capitalize", sort === s ? "bg-fg text-bg" : "bg-elevated text-muted")}
          >
            {s}
          </button>
        ))}
      </div>
      <ul className="px-4 py-2">
        {(comments.data ?? []).map((c) => (
          <li key={c.id} className="py-3">
            <CommentRow
              comment={c}
              postAuthorId={post.data.author.userId}
              viewerId={me.data?.userId ?? ""}
              role={me.data?.role ?? "user"}
              onChanged={() => {
                void comments.refetch();
                void post.refetch();
              }}
            />
            {c.replies.map((r) => (
              <div key={r.id} className="mt-2 ml-8">
                <CommentRow
                  comment={r}
                  postAuthorId={post.data.author.userId}
                  viewerId={me.data?.userId ?? ""}
                  role={me.data?.role ?? "user"}
                  onChanged={() => {
                    void comments.refetch();
                    void post.refetch();
                  }}
                  compact
                />
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CommentRow({
  comment,
  postAuthorId,
  viewerId,
  role,
  onChanged,
  compact,
}: {
  comment: CommentNode;
  postAuthorId: string;
  viewerId: string;
  role: string;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [report, setReport] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const mine = viewerId === comment.author.userId;
  const omni = comment.author.userId === OMNI_AI_USER_ID;
  const canDelete = canDeleteComment({
    viewerId,
    commentAuthorId: comment.author.userId,
    postAuthorId,
    role,
  });

  return (
    <div className={cn("flex gap-2", omni && "rounded-xl bg-ai/10 p-2")}>
      <Avatar src={comment.author.avatarUrl} name={comment.author.displayName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <NameMark name={comment.author.displayName} verifyKind={comment.author.verifyKind} isArc={comment.author.isArc} isPremium={comment.author.isPremium} className="font-medium" />{" "}
          {comment.pinned ? <span className="text-[10px] uppercase text-accent">Pinned</span> : null}{" "}
          <span className="text-subtle">{timeAgo(comment.createdAt)}</span>
          {comment.editedAt ? <span className="text-subtle"> · edited</span> : null}
        </p>
        <p className={compact ? "text-sm whitespace-pre-wrap" : "text-sm whitespace-pre-wrap"}>
          <RichBody text={comment.body} />
        </p>
        {comment.sticker ? (
          <StickerBubble
            packId={comment.sticker.packId}
            stickerId={comment.sticker.id}
            mediaUrl={comment.sticker.url}
            name={comment.sticker.name}
            mediaKind={comment.sticker.mediaKind}
            className="size-20"
          />
        ) : null}
        <div className="mt-1 flex gap-3 text-xs">
          <button
            type="button"
            className={comment.liked ? "text-like" : "text-muted"}
            onClick={() => void toggleCommentLike({ data: { id: comment.id } }).then(onChanged)}
          >
            {comment.liked ? "Liked" : "Like"} {comment.likes ? comment.likes : ""}
          </button>
          {viewerId === postAuthorId ? (
            <button
              type="button"
              className="text-muted"
              onClick={() => void pinComment({ data: { id: comment.id } }).then(onChanged)}
            >
              {comment.pinned ? "Unpin" : "Pin"}
            </button>
          ) : null}
          {mine ? (
            <button
              type="button"
              className="text-muted"
              onClick={() => {
                const next = window.prompt("Edit comment", comment.body);
                if (!next) return;
                void editComment({ data: { id: comment.id, body: next } })
                  .then(onChanged)
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"));
              }}
            >
              Edit
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className="text-danger"
              onClick={() => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                void deleteComment({ data: { id: comment.id } })
                  .then(() => {
                    toast.success("Comment deleted");
                    onChanged();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"));
              }}
            >
              {confirm ? "Confirm delete" : "Delete"}
            </button>
          ) : null}
          {!mine ? (
            <button type="button" className="text-muted" onClick={() => setReport(true)}>
              Report
            </button>
          ) : null}
        </div>
      </div>
      {report ? (
        <ReportSheet targetKind="comment" targetId={comment.id} onClose={() => setReport(false)} />
      ) : null}
    </div>
  );
}
