import {
  Download,
  Eye,
  Highlighter,
  Music2,
  PenLine,
  RotateCw,
  Sparkles,
  Type,
  X,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MusicPicker, type PickedSound } from "./music-picker";
import { TrackPlayButton } from "./music-player";

import { NYX_FILTERS, filterCss } from "@/lib/kchat/camera-filters";

export const MEDIA_FILTERS = NYX_FILTERS;


export type MediaKind = "photo" | "video" | "voice";

export type ComposerResult = {
  url: string;
  kind: MediaKind;
  caption: string;
  viewOnce: boolean;
  filter: string;
  rotation: number;
  hd: boolean;
  music: PickedSound | null;
  overlay: string;
};

export function MediaComposer({
  url,
  kind,
  onClose,
  onCommit,
  allowViewOnce = false,
  title = "Compose",
  commitLabel = "Send",
  extraActions,
  slot,
}: {
  url: string;
  kind: MediaKind;
  onClose: () => void;
  onCommit: (result: ComposerResult) => void | Promise<void>;
  allowViewOnce?: boolean;
  title?: string;
  commitLabel?: string;
  extraActions?: (result: ComposerResult, busy: boolean) => ReactNode;
  slot?: ReactNode;
}) {
  const [caption, setCaption] = useState("");
  const [overlay, setOverlay] = useState("");
  const [filter, setFilter] = useState<(typeof MEDIA_FILTERS)[number]["id"]>("none");
  const [rotation, setRotation] = useState(0);
  const [hd, setHd] = useState(true);
  const [viewOnce, setViewOnce] = useState(false);
  const [textOn, setTextOn] = useState(false);
  const [drawOn, setDrawOn] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [music, setMusic] = useState<PickedSound | null>(null);
  const [busy, setBusy] = useState(false);
  const css = filterCss(filter);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function snapshot(): ComposerResult {
    return { url, kind, caption, viewOnce, filter, rotation, hd, music, overlay };
  }

  async function bakeIfNeeded(): Promise<string> {
    if (kind !== "photo" || (rotation % 360 === 0 && !overlay.trim() && !drawOn && filter === "none")) return url;
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {});
    const rad = ((rotation % 360) * Math.PI) / 180;
    const swap = Math.abs(rotation % 180) === 90;
    const canvas = document.createElement("canvas");
    canvas.width = swap ? img.height : img.width;
    canvas.height = swap ? img.width : img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return url;
    ctx.filter = css;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = "none";
    if (overlay.trim()) {
      ctx.fillStyle = "white";
      ctx.font = `600 ${Math.round(canvas.width / 16)}px Outfit, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 8;
      ctx.fillText(overlay.trim().slice(0, 48), canvas.width / 2, canvas.height * 0.86);
    }
    const draw = canvasRef.current;
    if (draw && drawOn) ctx.drawImage(draw, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", hd ? 0.92 : 0.78);
  }

  async function commit() {
    setBusy(true);
    try {
      const baked = await bakeIfNeeded();
      await onCommit({ ...snapshot(), url: baked });
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "video" ? "nyx-clip.webm" : kind === "voice" ? "nyx-voice.webm" : "nyx-photo.jpg";
    a.click();
  }

  function onDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawOn) return;
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "white";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineTo(((e.clientX - rect.left) / rect.width) * c.width, ((e.clientY - rect.top) / rect.height) * c.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(((e.clientX - rect.left) / rect.width) * c.width, ((e.clientY - rect.top) / rect.height) * c.height);
  }

  return (
    <div className="kc-immersive relative flex flex-col bg-bg text-fg">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} className="bg-bg/50 backdrop-blur-md">
          <X className="size-5" />
        </Button>
        <p className="text-sm font-medium">{title}</p>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn("bg-bg/50 backdrop-blur-md", hd && "text-accent")}
            onClick={() => setHd((v) => !v)}
          >
            {hd ? "HD" : "SD"}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Save" className="bg-bg/50 backdrop-blur-md" onClick={download}>
            <Download className="size-4" />
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-bg">
        {kind === "video" ? (
          <video
            src={url}
            className="max-h-dvh w-full object-contain"
            style={{ filter: css, transform: `rotate(${rotation}deg)` }}
            controls
            playsInline
            autoPlay
            loop
          />
        ) : kind === "voice" ? (
          <div className="flex flex-col items-center gap-4 px-6">
            <audio src={url} controls className="w-full" />
            <p className="text-sm text-muted">Voice note preview</p>
          </div>
        ) : (
          <img
            src={url}
            alt=""
            className="max-h-dvh w-full object-contain"
            style={{ filter: css, transform: `rotate(${rotation}deg)` }}
          />
        )}
        {kind === "photo" && drawOn ? (
          <canvas
            ref={canvasRef}
            width={1080}
            height={1440}
            className="absolute inset-0 size-full"
            onPointerDown={(e) => {
              const c = canvasRef.current;
              const ctx = c?.getContext("2d");
              ctx?.beginPath();
              onDraw(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons) onDraw(e);
            }}
          />
        ) : null}
        {overlay.trim() ? (
          <p className="pointer-events-none absolute inset-x-6 bottom-36 text-center text-2xl font-semibold text-fg drop-shadow-md">
            {overlay}
          </p>
        ) : null}
      </div>

      <aside className="absolute right-3 top-24 z-20 flex flex-col gap-2">
        <RailBtn label="Rotate" onClick={() => setRotation((r) => (r + 90) % 360)}>
          <RotateCw className="size-5" />
        </RailBtn>
        <RailBtn label="Text" active={textOn} onClick={() => setTextOn((v) => !v)}>
          <Type className="size-5" />
        </RailBtn>
        <RailBtn label="Draw" active={drawOn} onClick={() => setDrawOn((v) => !v)}>
          <PenLine className="size-5" />
        </RailBtn>
        <RailBtn label="Music" active={Boolean(music)} onClick={() => setMusicOpen(true)}>
          <Music2 className="size-5" />
        </RailBtn>
        <RailBtn label="Filters" onClick={() => setFilter((f) => (f === "none" ? "glow" : "none"))}>
          <Sparkles className="size-5" />
        </RailBtn>
        {allowViewOnce ? (
          <RailBtn label="View once" active={viewOnce} onClick={() => setViewOnce((v) => !v)}>
            <Eye className="size-5" />
          </RailBtn>
        ) : null}
      </aside>

      <div className="absolute inset-x-0 bottom-0 z-20 space-y-3 bg-gradient-to-t from-bg via-bg/90 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10">
        {textOn ? (
          <Input
            value={overlay}
            onChange={(e) => setOverlay(e.target.value)}
            placeholder="Text on media"
            maxLength={48}
            className="bg-bg/70"
          />
        ) : null}
        {music ? (
          <p className="flex items-center gap-2 text-xs text-muted">
            <TrackPlayButton
              track={{
                id: music.id || music.soundId,
                provider: music.provider || "itunes",
                providerTrackId: music.providerTrackId || music.soundId,
                title: music.title,
                artist: music.artist,
                album: music.album ?? null,
                artworkUrl: music.artworkUrl,
                audioUrl: music.audioUrl ?? music.previewUrl,
                previewUrl: music.previewUrl,
                downloadUrl: music.downloadUrl ?? null,
                durationMs: music.durationMs ?? null,
                genre: music.genre ?? null,
                license: music.license,
                previewAvailable: music.previewAvailable,
                playback: music.playback ?? (music.previewAvailable ? "preview" : "none"),
                downloadable: Boolean(music.downloadable),
              }}
            />
            {music.title} · {music.artist}
            <button type="button" className="underline" onClick={() => setMusic(null)}>
              Remove
            </button>
          </p>
        ) : null}
        <div className="kc-hide-scrollbar flex gap-2 overflow-x-auto">
          {MEDIA_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm",
                filter === f.id ? "bg-accent text-accent-fg" : "bg-elevated/80 text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {allowViewOnce && viewOnce ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <Highlighter className="size-3.5" />
            View once is on. They can open this one time. This browser cannot block screenshots.
          </p>
        ) : null}
        {slot}
        <Input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={kind === "voice" ? "Add a caption (optional)" : "Caption"}
          maxLength={120}
          className="bg-bg/70"
        />
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => void commit()}>
            {commitLabel}
          </Button>
          {extraActions?.(snapshot(), busy)}
        </div>
      </div>
      <MusicPicker open={musicOpen} onClose={() => setMusicOpen(false)} onPick={setMusic} />
    </div>
  );
}

function RailBtn({
  label,
  children,
  onClick,
  active,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid size-11 place-items-center rounded-full bg-bg/55 text-fg backdrop-blur-md",
        active && "bg-accent text-accent-fg",
      )}
    >
      {children}
    </button>
  );
}
