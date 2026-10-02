import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addCustomSticker,
  createStickerPack,
} from "@/lib/kchat/server/stickers";
import { listStickerPacks } from "@/lib/kchat/server/comms";
import {
  applyCanvasFilter,
  blobToDataUrl,
  dataUrlToFile,
  exportPng,
  loadImage,
  probeVideo,
  removeBackground,
  rotateCanvas,
  sniffFile,
  STICKER_GIF_MAX_BYTES,
  STICKER_VIDEO_MAX_MS,
  trimVideoClip,
} from "@/lib/kchat/sticker-process";
import {
  openSystemSettings,
  pickFromLibrary,
  takeNativePhoto,
  takeNativeVideo,
  triggerHaptic,
} from "@/utils/nativeCapabilities";
import { cn } from "@/lib/utils";

type Tool = "crop" | "erase" | "draw" | "text";
type Mode = "photo" | "video";

const EMOJIS = ["😂", "❤️", "🔥", "✨", "😭", "😍", "💀", "👀", "🙌", "💯"];

function permissionToast(message: string) {
  toast.error(message, {
    action: {
      label: "Settings",
      onClick: () => {
        void openSystemSettings();
      },
    },
  });
}

export function StickerStudio() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const packs = useQuery({ queryKey: ["sticker-packs"], queryFn: () => listStickerPacks() });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>("photo");
  const [name, setName] = useState("");
  const [packId, setPackId] = useState<string>("");
  const [newPack, setNewPack] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("crop");
  const [color, setColor] = useState("#f4efe6");
  const [font, setFont] = useState("600 28px ui-sans-serif, system-ui, sans-serif");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("none");
  const [history, setHistory] = useState<string[]>([]);
  const [redo, setRedo] = useState<string[]>([]);
  const [hasImage, setHasImage] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [gifFile, setGifFile] = useState<File | null>(null);
  const [gifUntouched, setGifUntouched] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(2);
  const [duration, setDuration] = useState(0);
  const drawing = useRef(false);

  const mine = (packs.data?.packs ?? []).filter((p) => p.mine);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  function ctx() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d", { willReadFrequently: true });
  }

  function snapshot() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHistory((h) => [...h.slice(-14), canvas.toDataURL("image/png")]);
    setRedo([]);
  }

  async function restore(url: string) {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    const img = await loadImage(url);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  async function undo() {
    const canvas = canvasRef.current;
    if (!canvas || history.length === 0) return;
    const current = canvas.toDataURL("image/png");
    const prev = history[history.length - 1]!;
    setHistory((h) => h.slice(0, -1));
    setRedo((r) => [...r, current]);
    await restore(prev);
  }

  async function redoOne() {
    if (!redo.length) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = redo[redo.length - 1]!;
    setRedo((r) => r.slice(0, -1));
    snapshot();
    await restore(next);
  }

  async function loadPhoto(src: string): Promise<boolean> {
    setProgress("Loading photo…");
    try {
      const img = await loadImage(src);
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const edge = Math.min(512, Math.max(img.width, img.height));
      const scale = edge / Math.max(img.width, img.height);
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const c = ctx();
      if (!c) throw new Error("Could not process image.");
      c.clearRect(0, 0, canvas.width, canvas.height);
      c.drawImage(img, 0, 0, canvas.width, canvas.height);
      setHasImage(true);
      setHistory([]);
      setRedo([]);
      snapshot();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load photo.");
      return false;
    } finally {
      setProgress(null);
    }
  }

  async function ingestGalleryFile(file: File | undefined) {
    if (!file) return;
    setProgress("Opening from gallery…");
    try {
      const sniff = await sniffFile(file);
      if (!sniff) {
        toast.error("That file type isn’t supported. Use a photo, GIF, or short video.");
        return;
      }
      const typed =
        file.type && file.type === sniff.mime
          ? file
          : new File([file], file.name || (sniff.kind === "video" ? "clip" : sniff.kind === "gif" ? "sticker.gif" : "photo"), {
              type: sniff.mime,
            });
      if (sniff.kind === "gif") {
        if (typed.size > STICKER_GIF_MAX_BYTES) {
          toast.error("That GIF is too large (max 1.8MB).");
          return;
        }
        const url = URL.createObjectURL(typed);
        try {
          const ok = await loadPhoto(url);
          if (!ok) return;
        } finally {
          URL.revokeObjectURL(url);
        }
        setGifFile(typed);
        setGifUntouched(true);
        setVideoFile(null);
        setMode("photo");
        toast.message("GIF loaded. Save keeps the animation unless you edit it.");
        return;
      }
      if (sniff.kind === "video") {
        await onVideoFile(typed, true);
        return;
      }
      const url = URL.createObjectURL(typed);
      try {
        const ok = await loadPhoto(url);
        if (!ok) return;
        setGifFile(null);
        setGifUntouched(false);
        setMode("photo");
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open that file.");
    } finally {
      setProgress(null);
    }
  }

  async function ingestPicked(item: { kind: "image" | "video" | "gif"; dataUrl: string; fileName?: string }) {
    const file = dataUrlToFile(item.dataUrl, item.fileName || item.kind);
    await ingestGalleryFile(file);
  }

  async function openGallery() {
    if (busy) return;
    triggerHaptic();
    setBusy(true);
    setProgress("Opening gallery…");
    try {
      const items = await pickFromLibrary({ media: "any", limit: 1 });
      if (items[0]) await ingestPicked(items[0]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not open library.";
      if (/permission|denied|settings/i.test(msg)) permissionToast(msg);
      else toast.error(msg);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function openCamera() {
    if (busy) return;
    triggerHaptic();
    setBusy(true);
    setProgress("Opening camera…");
    try {
      const shot = await takeNativePhoto();
      if (shot) await ingestPicked(shot);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not open the camera.";
      if (/permission|denied|settings/i.test(msg)) permissionToast(msg);
      else toast.error(msg);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function openRecord() {
    if (busy) return;
    triggerHaptic();
    setBusy(true);
    setProgress("Opening recorder…");
    try {
      const clip = await takeNativeVideo();
      if (clip) await ingestPicked(clip);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not record video.";
      if (/permission|denied|settings/i.test(msg)) permissionToast(msg);
      else toast.error(msg);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function onVideoFile(file: File | undefined, sniffed = false) {
    if (!file) return;
    if (!sniffed) {
      const sniff = await sniffFile(file);
      if (sniff && sniff.kind !== "video") {
        await ingestGalleryFile(file);
        return;
      }
      if (!sniff) {
        toast.error("Pick a video or GIF.");
        return;
      }
    }
    setProgress("Reading video…");
    try {
      const info = await probeVideo(file);
      if (info.durationMs < 250) throw new Error("That clip is too short.");
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(file);
      setVideoFile(file);
      setVideoUrl(url);
      setGifFile(null);
      setGifUntouched(false);
      const seconds = Math.max(0.4, info.durationMs / 1000);
      setDuration(seconds);
      setClipStart(0);
      setClipEnd(Math.min(STICKER_VIDEO_MAX_MS / 1000, seconds));
      setMode("video");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that video.");
    } finally {
      setProgress(null);
    }
  }

  function markEdited() {
    if (gifUntouched) setGifUntouched(false);
  }

  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    if (tool !== "draw" && tool !== "erase") return;
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c || !drawing.current) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    c.save();
    if (tool === "erase") {
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "#000";
    } else {
      c.globalCompositeOperation = "source-over";
      c.fillStyle = color;
    }
    c.beginPath();
    c.arc(x, y, tool === "erase" ? 14 : 6, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  function stampText(value: string, opts?: { size?: number; face?: string }) {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c || !value.trim()) return;
    snapshot();
    markEdited();
    c.save();
    c.font = opts?.face || (opts?.size ? `700 ${opts.size}px ui-sans-serif, system-ui, Apple Color Emoji, Segoe UI Emoji, sans-serif` : font);
    c.textAlign = "center";
    c.lineJoin = "round";
    c.strokeStyle = "#10140f";
    c.lineWidth = 6;
    c.strokeText(value.trim(), canvas.width / 2, canvas.height - 28);
    c.fillStyle = color;
    c.fillText(value.trim(), canvas.width / 2, canvas.height - 28);
    c.restore();
  }

  function addText() {
    if (!text.trim()) return;
    stampText(text.trim());
    setText("");
  }

  function cropIn() {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    snapshot();
    markEdited();
    const m = Math.round(Math.min(canvas.width, canvas.height) * 0.08);
    const w = canvas.width - m * 2;
    const h = canvas.height - m * 2;
    const cut = c.getImageData(m, m, w, h);
    canvas.width = w;
    canvas.height = h;
    c.putImageData(cut, 0, 0);
  }

  function scaleBy(factor: number) {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c || !hasImage) return;
    snapshot();
    markEdited();
    const w = Math.max(48, Math.min(512, Math.round(canvas.width * factor)));
    const h = Math.max(48, Math.min(512, Math.round(canvas.height * factor)));
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d")!.drawImage(canvas, 0, 0, w, h);
    canvas.width = w;
    canvas.height = h;
    c.clearRect(0, 0, w, h);
    c.drawImage(out, 0, 0);
  }

  function addOutline() {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c || !hasImage) return;
    snapshot();
    markEdited();
    const src = c.getImageData(0, 0, canvas.width, canvas.height);
    const out = c.createImageData(src.width, src.height);
    const d = src.data;
    const o = out.data;
    o.set(d);
    const w = src.width;
    const h = src.height;
    const hex = color.replace("#", "");
    const cr = parseInt(hex.slice(0, 2), 16) || 16;
    const cg = parseInt(hex.slice(2, 4), 16) || 20;
    const cb = parseInt(hex.slice(4, 6), 16) || 15;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if ((d[i + 3] ?? 0) > 32) continue;
        let edge = false;
        for (let dy = -2; dy <= 2 && !edge; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if ((d[(ny * w + nx) * 4 + 3] ?? 0) > 64) {
              edge = true;
              break;
            }
          }
        }
        if (edge) {
          o[i] = cr;
          o[i + 1] = cg;
          o[i + 2] = cb;
          o[i + 3] = 255;
        }
      }
    }
    c.putImageData(out, 0, 0);
  }

  function bgRemove() {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    snapshot();
    markEdited();
    setProgress("Removing background…");
    const data = c.getImageData(0, 0, canvas.width, canvas.height);
    c.putImageData(removeBackground(data), 0, 0);
    setProgress(null);
  }

  function applyFilter(next: string) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    snapshot();
    markEdited();
    const out = applyCanvasFilter(canvas, next);
    const c = ctx();
    if (!c) return;
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(out, 0, 0);
    setFilter(next);
  }

  function spin() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    snapshot();
    markEdited();
    const out = rotateCanvas(canvas, 90);
    canvas.width = out.width;
    canvas.height = out.height;
    ctx()?.drawImage(out, 0, 0);
  }

  async function ensurePack(): Promise<string> {
    if (packId) return packId;
    if (mine[0]) return mine[0].id;
    const title = newPack.trim() || "My Stickers";
    const created = await createStickerPack({ data: { title } });
    void packs.refetch();
    setPackId(created.id);
    return created.id;
  }

  async function afterSave() {
    await qc.invalidateQueries({ queryKey: ["sticker-packs"] });
    nav({ to: "/stickers" });
  }

  async function savePhoto() {
    const canvas = canvasRef.current;
    if (!canvas || !hasImage) {
      toast.error("Add a photo first.");
      return;
    }
    setBusy(true);
    setProgress("Saving sticker…");
    try {
      triggerHaptic();
      const pid = await ensurePack();
      if (gifFile && gifUntouched) {
        const mediaUrl = await blobToDataUrl(gifFile);
        await addCustomSticker({
          data: {
            packId: pid,
            name: name.trim() || "GIF sticker",
            mediaUrl,
            mediaKind: "gif",
            width: canvas.width,
            height: canvas.height,
          },
        });
      } else {
        const mediaUrl = exportPng(canvas);
        await addCustomSticker({
          data: {
            packId: pid,
            name: name.trim() || "Custom sticker",
            mediaUrl,
            mediaKind: "image",
            width: canvas.width,
            height: canvas.height,
          },
        });
      }
      toast.success("Sticker saved.");
      await afterSave();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save sticker.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function saveVideo() {
    if (!videoFile) {
      toast.error("Pick a video first.");
      return;
    }
    const span = (clipEnd - clipStart) * 1000;
    if (span < 400) {
      toast.error("Select a longer section.");
      return;
    }
    if (span > STICKER_VIDEO_MAX_MS + 50) {
      toast.error("Keep the clip under 3 seconds.");
      return;
    }
    setBusy(true);
    try {
      triggerHaptic();
      const clip = await trimVideoClip(videoFile, clipStart * 1000, clipEnd * 1000, (pct) => {
        setProgress(`Processing ${Math.round(pct)}%`);
      });
      setProgress("Saving sticker…");
      const mediaUrl = await blobToDataUrl(clip.blob);
      const pid = await ensurePack();
      await addCustomSticker({
        data: {
          packId: pid,
          name: name.trim() || "Animated sticker",
          mediaUrl,
          mediaKind: clip.mediaKind,
          width: clip.width,
          height: clip.height,
          durationMs: clip.durationMs,
        },
      });
      toast.success("Animated sticker saved.");
      await afterSave();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not process that clip.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const customPacks = mine;
  const showCanvas = mode === "photo" && hasImage;
  const showEmpty = !(mode === "photo" && hasImage) && !(mode === "video" && videoUrl);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Create sticker</h1>
          <p className="mt-1 text-sm text-muted">
            Photos, GIFs, and short videos from your gallery. Background removal is real flood-fill, not a fake button.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" asChild>
          <Link to="/stickers">Back</Link>
        </Button>
      </div>
      <div className="flex gap-2">
        <Button variant={mode === "photo" ? "default" : "secondary"} size="sm" onClick={() => setMode("photo")}>
          Photo
        </Button>
        <Button variant={mode === "video" ? "default" : "secondary"} size="sm" onClick={() => setMode("video")}>
          Video
        </Button>
      </div>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sticker name" maxLength={48} />
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          value={packId}
          onChange={(e) => setPackId(e.target.value)}
          aria-label="Pack"
        >
          <option value="">My Stickers (auto)</option>
          {customPacks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <Input
          value={newPack}
          onChange={(e) => setNewPack(e.target.value)}
          placeholder="New pack name"
          className="max-w-40"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-12 min-h-12 min-w-[11rem] flex-1" onClick={() => void openGallery()} disabled={busy}>
          {busy && progress?.includes("gallery") ? "Opening…" : "Pick from gallery"}
        </Button>
        {mode === "photo" ? (
          <Button type="button" variant="secondary" className="h-12 min-h-12" onClick={() => void openCamera()} disabled={busy}>
            Camera
          </Button>
        ) : (
          <Button type="button" variant="secondary" className="h-12 min-h-12" onClick={() => void openRecord()} disabled={busy}>
            Record
          </Button>
        )}
      </div>
      {gifFile && gifUntouched ? (
        <p className="text-xs text-muted">Animation will be kept. Crop, draw, or filters flatten it to a still sticker.</p>
      ) : null}

      <button
        type="button"
        onClick={() => void openGallery()}
        disabled={busy}
        className={cn(
          "flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-elevated px-4 py-10 text-center",
          showEmpty ? "" : "hidden",
        )}
      >
        <span className="text-sm font-medium">Tap to pick a photo, GIF, or video</span>
        <span className="mt-1 text-xs text-muted">Gallery pictures, GIFs, and short clips become stickers here.</span>
      </button>

      <div className={cn("overflow-hidden rounded-2xl border border-border bg-elevated", !showCanvas && "hidden")}>
        <canvas
          ref={canvasRef}
          className={cn("mx-auto max-h-80 w-full bg-[length:16px_16px]", hasImage ? "object-contain" : "min-h-48")}
          style={{ backgroundImage: "linear-gradient(45deg, var(--color-border) 25%, transparent 25%), linear-gradient(-45deg, var(--color-border) 25%, transparent 25%)" }}
          onPointerDown={(e) => {
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            if (tool === "draw" || tool === "erase") {
              snapshot();
              markEdited();
            }
            paint(e);
          }}
          onPointerMove={paint}
          onPointerUp={() => {
            drawing.current = false;
          }}
        />
      </div>

      {mode === "photo" ? (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {(["crop", "erase", "draw", "text"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={cn("rounded-full px-3 py-1.5 capitalize", tool === t ? "bg-fg text-bg" : "bg-elevated")}
                onClick={() => setTool(t)}
              >
                {t}
              </button>
            ))}
            <Button size="sm" variant="outline" onClick={cropIn} disabled={!hasImage}>
              Crop
            </Button>
            <Button size="sm" variant="outline" onClick={() => scaleBy(0.85)} disabled={!hasImage}>
              Smaller
            </Button>
            <Button size="sm" variant="outline" onClick={() => scaleBy(1.15)} disabled={!hasImage}>
              Larger
            </Button>
            <Button size="sm" variant="outline" onClick={bgRemove} disabled={!hasImage}>
              Remove background
            </Button>
            <Button size="sm" variant="outline" onClick={spin} disabled={!hasImage}>
              Rotate
            </Button>
            <Button size="sm" variant="outline" onClick={addOutline} disabled={!hasImage}>
              Outline
            </Button>
            <Button size="sm" variant="outline" onClick={() => void undo()} disabled={!history.length}>
              Undo
            </Button>
            <Button size="sm" variant="outline" onClick={() => void redoOne()} disabled={!redo.length}>
              Redo
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {["none", "contrast(1.15) saturate(1.2)", "grayscale(1)", "sepia(.45)", "brightness(1.15)"].map((f) => (
              <button
                key={f}
                type="button"
                className={cn("rounded-full px-3 py-1.5 text-xs", filter === f ? "bg-elevated" : "text-muted")}
                onClick={() => applyFilter(f)}
                disabled={!hasImage}
              >
                {f === "none" ? "Original" : f.startsWith("gray") ? "Mono" : f.startsWith("sepia") ? "Warm" : f.startsWith("bright") ? "Bright" : "Punch"}
              </button>
            ))}
          </div>
          {tool === "draw" || tool === "text" ? (
            <label className="flex items-center gap-2 text-sm">
              Color
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>
          ) : null}
          {tool === "text" ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <select className="rounded-xl border border-border bg-surface px-2 text-sm" value={font} onChange={(e) => setFont(e.target.value)}>
                  <option value="600 28px ui-sans-serif, system-ui, sans-serif">Sans</option>
                  <option value="700 28px ui-serif, Georgia, serif">Serif</option>
                  <option value="700 30px ui-rounded, system-ui, sans-serif">Bold</option>
                </select>
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text on sticker" />
                <Button size="sm" onClick={addText} disabled={!text.trim()}>
                  Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="grid size-10 place-items-center rounded-xl bg-elevated text-lg"
                    onClick={() => stampText(emoji, { size: 42 })}
                    disabled={!hasImage}
                    aria-label={`Add ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <Button className="w-full" disabled={busy || !hasImage} onClick={() => void savePhoto()}>
            {busy ? progress || "Saving…" : gifFile && gifUntouched ? "Save GIF sticker" : "Save sticker"}
          </Button>
        </>
      ) : (
        <>
          {videoUrl ? (
            <div className="space-y-3">
              <video ref={videoRef} src={videoUrl} playsInline controls className="w-full rounded-2xl bg-elevated" />
              <p className="text-xs text-muted">
                Select the exact portion to turn into an animated sticker (max 3 seconds).
              </p>
              <label className="block text-xs text-muted">
                Start {clipStart.toFixed(1)}s
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, duration - 0.4)}
                  step={0.1}
                  value={clipStart}
                  className="mt-1 w-full"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setClipStart(v);
                    if (clipEnd - v > 3) setClipEnd(v + 3);
                    if (clipEnd <= v) setClipEnd(Math.min(duration, v + 0.8));
                    const el = videoRef.current;
                    if (el) el.currentTime = v;
                  }}
                />
              </label>
              <label className="block text-xs text-muted">
                End {clipEnd.toFixed(1)}s
                <input
                  type="range"
                  min={0.4}
                  max={duration}
                  step={0.1}
                  value={clipEnd}
                  className="mt-1 w-full"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setClipEnd(v);
                    if (v - clipStart > 3) setClipStart(Math.max(0, v - 3));
                    if (v <= clipStart) setClipStart(Math.max(0, v - 0.8));
                  }}
                />
              </label>
              <p className="text-xs tabular-nums text-muted">Clip length {(clipEnd - clipStart).toFixed(1)}s</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const el = videoRef.current;
                  if (!el) return;
                  el.currentTime = clipStart;
                  void el.play();
                  window.setTimeout(() => el.pause(), Math.max(400, (clipEnd - clipStart) * 1000));
                }}
              >
                Preview clip
              </Button>
              <Button className="w-full" disabled={busy} onClick={() => void saveVideo()}>
                {busy ? progress || "Processing…" : "Save animated sticker"}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {progress ? <p className="text-center text-sm text-muted">{progress}</p> : null}
    </div>
  );
}
