import { Download, LoaderCircle, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createStatus } from "@/lib/kchat/server/status";
import { mediaSrc } from "@/lib/kchat/media-upload";
import { cn } from "@/lib/utils";
import { saveMediaToDevice, triggerHaptic } from "@/utils/nativeCapabilities";

export function MediaActions({
  url,
  kind,
  fileName,
  mime,
  className,
}: {
  url: string;
  kind: "image" | "video" | "file";
  fileName?: string | null;
  mime?: string | null;
  className?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);

  async function save() {
    setSaving(true);
    setPct(0);
    try {
      const r = await saveMediaToDevice(url, {
        fileName: fileName ?? undefined,
        mime: mime ?? undefined,
        onProgress: setPct,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      triggerHaptic("success");
      toast.success(r.fileName ? `Saved ${r.fileName}` : "Saved");
    } finally {
      setSaving(false);
      setPct(null);
    }
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save()}>
        {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
        {saving ? (pct != null ? `${pct}%` : "Saving…") : "Save to device"}
      </Button>
      {kind === "image" || kind === "video" ? (
        <Button size="sm" variant="secondary" onClick={() => setStatusOpen(true)}>
          <Send className="size-4" />
          Post to Status
        </Button>
      ) : null}
      {statusOpen ? (
        <PostToStatusSheet
          url={url}
          kind={kind === "video" ? "video" : "photo"}
          onClose={() => setStatusOpen(false)}
        />
      ) : null}
    </div>
  );
}

export function PostToStatusSheet({
  url,
  kind,
  onClose,
}: {
  url: string;
  kind: "photo" | "video";
  onClose: () => void;
}) {
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const src = mediaSrc(url);

  async function publish() {
    setBusy(true);
    try {
      await createStatus({
        data: {
          mediaUrl: url,
          mediaKind: kind,
          textBody: caption.trim() || null,
        },
      });
      triggerHaptic("success");
      toast.success("Posted to your status");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't post that status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-end bg-fg/40 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="Post to Status">
      <div
        className="kc-sheet w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium">Post to Status</p>
        <p className="mt-1 text-xs text-muted">Uses your current status privacy. Expires in 24 hours.</p>
        <div className="mt-3 overflow-hidden rounded-xl bg-elevated">
          {kind === "video" ? (
            <video src={src} controls playsInline className="max-h-64 w-full object-contain" />
          ) : (
            <img src={src} alt="" className="max-h-64 w-full object-contain" />
          )}
        </div>
        <Input
          className="mt-3"
          value={caption}
          maxLength={280}
          placeholder="Add a caption"
          onChange={(e) => setCaption(e.target.value)}
          aria-label="Status caption"
        />
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => void publish()}>
            {busy ? "Posting…" : "Post"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
