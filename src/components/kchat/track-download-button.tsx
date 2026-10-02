import { Check, Download, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getDownloadEntry, startTrackDownload, subscribeDownloads } from "@/lib/kchat/music-download";
import { downloadLocationHint } from "@/lib/kchat/music-offline";
import { canDownload, downloadBlockReason, type MusicTrack } from "@/lib/kchat/music";
import { cn } from "@/lib/utils";

export function TrackDownloadButton({
  track,
  saved = false,
  onDone,
  className,
}: {
  track: MusicTrack;
  saved?: boolean;
  onDone?: () => void;
  className?: string;
}) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDownloads(() => bump((n) => n + 1)), []);
  const entry = getDownloadEntry(track.id);
  const allowed = canDownload(track);
  const downloading = entry?.phase === "downloading";
  const done = saved || entry?.phase === "done";
  const reason = downloadBlockReason(track);
  const pct = entry?.pct;

  if (!allowed && !downloading && !done) return null;

  let label = "Download";
  if (downloading) label = pct == null ? "Downloading…" : `Downloading ${pct}%`;
  else if (done) label = "Downloaded ✓";

  return (
    <Button
      type="button"
      size="sm"
      variant={done ? "secondary" : "outline"}
      className={cn(
        "min-h-11 shrink-0 gap-1.5 border-accent/70 px-3 text-accent",
        !allowed && "opacity-50",
        className,
      )}
      aria-label={done ? `Downloaded ${track.title}` : downloading ? `Downloading ${track.title}` : `Download ${track.title}`}
      aria-disabled={!allowed || downloading}
      title={allowed ? label : reason || "Full download unavailable"}
      onClick={(event) => {
        event.stopPropagation();
        if (downloading) return;
        if (!allowed) {
          toast.error(reason || "Full download unavailable");
          return;
        }
        if (done && entry?.phase !== "error") {
          toast.message("Already downloaded.", {
            action: {
              label: "Download again",
              onClick: () => {
                void startTrackDownload(track, undefined, { force: true })
                  .then(() => {
                    toast.message(downloadLocationHint());
                    onDone?.();
                  })
                  .catch((error) => toast.error(error instanceof Error ? error.message : "Download failed. Please try again."));
              },
            },
          });
          return;
        }
        void startTrackDownload(track)
          .then(() => {
            toast.message(downloadLocationHint());
            onDone?.();
          })
          .catch((error) => toast.error(error instanceof Error ? error.message : "Download failed. Please try again."));
      }}
    >
      {downloading ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : done ? (
        <Check className="size-4" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      <span className="max-[380px]:sr-only">{label}</span>
    </Button>
  );
}
