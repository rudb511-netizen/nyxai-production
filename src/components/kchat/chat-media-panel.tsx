import { useInfiniteQuery } from "@tanstack/react-query";
import { FileText, Link2, Search, X } from "lucide-react";
import { useState } from "react";
import { ImageLightbox, type LightboxItem } from "@/components/kchat/image-lightbox";
import { MediaActions } from "@/components/kchat/media-actions";
import { listConversationMedia } from "@/lib/kchat/server/messages";
import { mediaSrc } from "@/lib/kchat/media-upload";
import { cn, timeAgo } from "@/lib/utils";
import { openExternalUrl } from "@/utils/nativeCapabilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Tab = "image" | "video" | "file" | "link";

export function ChatMediaPanel({
  conversationId,
  onClose,
  onJump,
}: {
  conversationId: string;
  onClose?: () => void;
  onJump?: (messageId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("image");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [viewer, setViewer] = useState<number | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["chat-media", conversationId, tab, search],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listConversationMedia({
        data: { conversationId, kind: tab, cursor: pageParam, q: search || undefined },
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 12_000,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const gallery: LightboxItem[] = items.map((it) => ({
    url: it.mediaUrl ?? "",
    kind: it.kind === "video" ? "video" : "image",
    sender: it.senderName,
    at: timeAgo(it.createdAt),
    fileName: it.filename,
  }));
  const empty =
    tab === "image"
      ? "No photos in this chat yet."
      : tab === "video"
        ? "No videos in this chat yet."
        : tab === "file"
          ? "No documents in this chat yet."
          : "No links in this chat yet.";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Chat media">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <h2 className="flex-1 text-sm font-semibold">Shared media</h2>
        <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-elevated" onClick={onClose} aria-label="Close">
          <X className="size-5" />
        </button>
      </header>
      <form
        className="flex gap-2 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search this chat"
          aria-label="Search media"
        />
        <Button type="submit" size="icon" variant="secondary" aria-label="Search">
          <Search className="size-4" />
        </Button>
      </form>
      <div className="flex gap-1 px-3 pb-2">
        {([
          ["image", "Photos"],
          ["video", "Videos"],
          ["file", "Documents"],
          ["link", "Links"],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            type="button"
            className={cn(
              "min-h-11 flex-1 rounded-full px-2 text-sm font-medium",
              tab === t ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
            )}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[env(safe-area-inset-bottom)]">
        {query.isLoading ? <p className="py-8 text-center text-sm text-muted">Loading…</p> : null}
        {query.isError ? (
          <div className="py-8 text-center">
            <p className="text-sm text-danger">{query.error instanceof Error ? query.error.message : "Couldn't load media."}</p>
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}
        {!query.isLoading && !query.isError && items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{empty}</p>
        ) : null}
        {tab === "image" || tab === "video" ? (
          <div className="grid grid-cols-3 gap-1">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                className="relative aspect-square overflow-hidden rounded-lg bg-elevated"
                onClick={() => setViewer(items.findIndex((x) => x.id === it.id))}
              >
                {it.kind === "video" ? (
                  <>
                    <video src={mediaSrc(it.mediaUrl)} className="size-full object-cover" muted playsInline preload="metadata" />
                    <span className="kc-media-play" aria-hidden="true" />
                  </>
                ) : (
                  <img src={mediaSrc(it.mediaUrl)} alt="" className="size-full object-cover" />
                )}
              </button>
            ))}
          </div>
        ) : tab === "link" ? (
          <ul className="space-y-1">
            {items.map((it) => (
              <li key={it.id} className="rounded-xl bg-elevated/60">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left"
                  onClick={() => {
                    if (it.mediaUrl) void openExternalUrl(it.mediaUrl);
                  }}
                >
                  <Link2 className="size-4 shrink-0 text-atlas" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{it.title || it.domain || it.mediaUrl}</span>
                    <span className="block truncate text-xs text-muted">{it.domain} · {timeAgo(it.createdAt)}</span>
                  </span>
                </button>
                {onJump ? (
                  <button
                    type="button"
                    className="w-full px-3 pb-2 text-left text-xs text-accent"
                    onClick={() => onJump(it.messageId)}
                  >
                    Jump to message
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1">
            {items.map((it) => (
              <li key={it.id} className="rounded-xl bg-elevated/60 px-3 py-2">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 shrink-0 text-atlas" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{it.filename || it.title || "Document"}</span>
                    <span className="block text-xs text-muted">
                      {(it.mime ?? "file").replace(/^application\//, "")}
                      {it.bytes ? ` · ${Math.max(1, Math.round(it.bytes / 1024))} KB` : ""}
                      {` · ${timeAgo(it.createdAt)}`}
                    </span>
                  </span>
                </div>
                <MediaActions
                  className="mt-2"
                  url={it.mediaUrl ?? ""}
                  kind="file"
                  fileName={it.filename}
                  mime={it.mime}
                />
                {onJump ? (
                  <button type="button" className="mt-1 text-xs text-accent" onClick={() => onJump(it.messageId)}>
                    Jump to message
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage ? (
          <button
            type="button"
            className="mt-3 mb-6 w-full rounded-full py-3 text-sm text-muted"
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
      <ImageLightbox
        items={viewer != null ? gallery : null}
        index={viewer ?? 0}
        onIndexChange={setViewer}
        onClose={() => setViewer(null)}
        footer={
          viewer != null && onJump && items[viewer] ? (
            <button type="button" className="text-xs text-accent" onClick={() => onJump(items[viewer]!.messageId)}>
              Jump to message
            </button>
          ) : null
        }
      />
    </div>
  );
}
