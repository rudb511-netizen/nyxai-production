import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Images } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/kchat/empty";
import { ImageLightbox } from "@/components/kchat/image-lightbox";
import { Button } from "@/components/ui/button";
import { listMemories } from "@/lib/kchat/server/flashes";
import { timeAgo } from "@/lib/utils";

export const Route = createFileRoute("/_app/memories")({ component: Memories });

function Memories() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["memories"], queryFn: () => listMemories() });
  const items = q.data ?? [];
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="kc-page px-4 py-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Memories</h1>
          <p className="mt-1 text-sm text-muted">Private. Only you can see these.</p>
        </div>
        <Button size="sm" onClick={() => nav({ to: "/capture" })}>
          Capture
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={Images}
          title="Nothing kept yet"
          body="After a Flash, tap Keep. This vault never leaves your account."
          action={
            <Button variant="secondary" onClick={() => nav({ to: "/capture" })}>
              Open camera
            </Button>
          }
        />
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-1">
          {items.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className="relative aspect-square overflow-hidden rounded-lg bg-elevated"
              onClick={() => setOpen(i)}
              aria-label={m.caption || (m.media_kind === "video" ? "Play video" : "View photo")}
            >
              {m.media_kind === "video" ? (
                <>
                  <video src={m.media_url} className="size-full object-cover" muted playsInline />
                  <span className="kc-media-play" aria-hidden="true" />
                </>
              ) : (
                <img src={m.media_url} alt={m.caption || ""} className="size-full object-cover" />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-bg/70 px-1.5 py-1 text-left text-xs text-fg">
                {timeAgo(m.created_at)}
              </span>
            </button>
          ))}
        </div>
      )}
      {open != null && items.length > 0 ? (
        <ImageLightbox
          items={items.map((m) => ({
            url: m.media_url,
            kind: m.media_kind === "video" ? "video" : "image",
          }))}
          index={open}
          onIndexChange={setOpen}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
