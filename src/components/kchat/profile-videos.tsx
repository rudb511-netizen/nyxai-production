import { Pin, Play, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ShortVideo } from "@/lib/kchat/types";
import { formatCount } from "@/lib/utils";

export function ProfileVideoGrid({
  items,
  mine,
  onPin,
  onDelete,
}: {
  items: ShortVideo[];
  mine?: boolean;
  onPin?: (id: string, pin: boolean) => void;
  onDelete?: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="p-8 text-center text-sm text-muted">No videos yet. Capture a clip to appear here.</p>;
  }
  return (
    <div className="kc-video-grid">
      {items.map((v) => (
        <Link
          key={v.id}
          to="/watch"
          className="relative aspect-[3/4] bg-elevated"
          search={{ v: v.id } as never}
        >
          {v.thumbUrl ? (
            <img src={v.thumbUrl} alt="" className="size-full object-cover" />
          ) : (
            <video src={v.mediaUrl} muted playsInline className="size-full object-cover" />
          )}
          <span className="absolute bottom-1 left-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-white drop-shadow">
            <Play className="size-3 fill-white" />
            {formatCount(v.views)}
          </span>
          {v.pinned ? (
            <Pin className="absolute right-1 top-1 size-3.5 fill-white text-white" />
          ) : null}
          {mine ? (
            <span className="absolute left-1 top-1 flex gap-1">
              <button
                type="button"
                className="grid size-7 place-items-center rounded-full bg-black/50"
                aria-label={v.pinned ? "Unpin" : "Pin"}
                onClick={(e) => {
                  e.preventDefault();
                  onPin?.(v.id, !v.pinned);
                }}
              >
                <Pin className="size-3.5 text-white" />
              </button>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-full bg-black/50"
                aria-label="Delete video"
                onClick={(e) => {
                  e.preventDefault();
                  onDelete?.(v.id);
                }}
              >
                <Trash2 className="size-3.5 text-white" />
              </button>
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
