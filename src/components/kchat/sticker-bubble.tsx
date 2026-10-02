import { mediaSrc } from "@/lib/kchat/media-upload";
import { stickerRenderUrl } from "@/lib/kchat/stickers";
import { cn } from "@/lib/utils";

export function StickerBubble({
  packId,
  stickerId,
  mediaUrl,
  name,
  mediaKind,
  className,
}: {
  packId?: string | null;
  stickerId?: string | null;
  mediaUrl?: string | null;
  name?: string | null;
  mediaKind?: string | null;
  className?: string;
}) {
  const url = stickerRenderUrl({ packId, stickerId, mediaUrl });
  if (!url) {
    return <span className="text-xs text-muted">Sticker unavailable</span>;
  }
  const video =
    mediaKind === "video" ||
    url.startsWith("data:video") ||
    /\.(webm|mp4|mov)(\?|$)/i.test(url);
  if (video) {
    return (
      <video
        src={mediaSrc(url)}
        autoPlay
        loop
        muted
        playsInline
        className={cn("mt-1 size-28 object-contain", className)}
        aria-label={name || "Sticker"}
      />
    );
  }
  return (
    <img
      src={mediaSrc(url)}
      alt={name || "Sticker"}
      className={cn("mt-1 size-28 object-contain", className)}
      loading="lazy"
      decoding="async"
    />
  );
}
