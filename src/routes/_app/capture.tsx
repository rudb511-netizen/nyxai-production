import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  Flashlight,
  FlipHorizontal2,
  Images,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Sparkles,
  SwitchCamera,
  Timer,
  X,
  ZoomIn,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MediaComposer } from "@/components/kchat/media-composer";
import { MusicPicker, type PickedSound } from "@/components/kchat/music-picker";
import { compressVideo } from "@/lib/kchat/media-client";
import {
  CAMERA_DURATIONS,
  CAMERA_LAYOUTS,
  CAMERA_TIMERS,
  NYX_FILTERS,
  filterCss,
  type CameraDurationId,
  type CameraLayout,
} from "@/lib/kchat/camera-filters";
import {
  applyTrackZoom,
  cameraPreviewTransform,
  cameraVideoConstraints,
  clampZoom,
  DEFAULT_ZOOM,
  defaultNativeZoom,
  pinchZoom,
  pointerDistance,
  readStoredFacing,
  storeFacing,
  zoomCapsFromTrack,
  zoomPresets,
  type CameraFacing,
} from "@/lib/kchat/camera";
import { captureHighResolutionPhoto } from "@/lib/kchat/camera-capture";
import {
  deviceMemoryGb,
  diagnosticsFromStill,
  jpegForModel,
  lastStillLog,
  megapixels,
  recommendedEnhanceScale,
  releaseStill,
  stillFromBlob,
  stillToPostableDataUrl,
  type StillDiagnostics,
  type StillPhoto,
} from "@/lib/kchat/camera-still";
import { enhanceCapturedPhoto } from "@/lib/kchat/server/super-resolution";
import { triggerHaptic, pickFromLibrary, isNativePlatform, openSystemSettings, takeNativePhoto, takeNativeVideo, setOrientationLock, setStatusBarHidden } from "@/utils/nativeCapabilities";
import { sendFlash } from "@/lib/kchat/server/flashes";
import { listFriends } from "@/lib/kchat/server/social";
import { createStory } from "@/lib/kchat/server/stories";
import { uploadVideo } from "@/lib/kchat/server/videos";
import { MediaUploader, dataUrlToFile } from "@/lib/kchat/media-upload";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/capture")({ component: Capture });

function Capture() {
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const raf = useRef<number>(0);
  const recStarted = useRef(0);
  const pauseAccum = useRef(0);
  const pauseAt = useRef(0);
  const [facing, setFacing] = useState<CameraFacing>(() => readStoredFacing());
  const [live, setLive] = useState(false);
  const [perm, setPerm] = useState<"prompt" | "granted" | "denied">("prompt");
  const [duration, setDuration] = useState<CameraDurationId>("15s");
  const [filter, setFilter] = useState<(typeof NYX_FILTERS)[number]["id"]>("none");
  const [shot, setShot] = useState<{
    url: string;
    kind: "photo" | "video";
    still?: StillPhoto;
    enhancedUrl?: string | null;
    using?: "original" | "enhanced";
    diag?: StillDiagnostics;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const stillRef = useRef<StillPhoto | null>(null);
  const [countdown, setCountdown] = useState<(typeof CAMERA_TIMERS)[number]>(0);
  const [count, setCount] = useState<number | null>(null);
  const [recSpeed, setRecSpeed] = useState<0.5 | 1 | 2>(1);
  const [torch, setTorch] = useState(false);
  const [flash, setFlash] = useState<"off" | "on" | "auto">("off");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [caps, setCaps] = useState({ min: 1, max: 3, native: false });
  const [layout, setLayout] = useState<CameraLayout>("single");
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [tool, setTool] = useState<null | "timer" | "zoom" | "layout" | "effects" | "more">(null);
  const [musicOpen, setMusicOpen] = useState(false);
  const [music, setMusic] = useState<PickedSound | null>(null);
  const zoomStart = useRef({ zoom: 1, dist: 0 });
  const friends = useQuery({ queryKey: ["friends"], queryFn: () => listFriends() });
  const css = filterCss(filter);
  const mode = duration === "photo" || duration === "text" ? "photo" : "video";
  const maxMs = CAMERA_DURATIONS.find((d) => d.id === duration)?.ms ?? 15_000;

  function paint() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      raf.current = requestAnimationFrame(paint);
      return;
    }
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.filter = css;
      if (facing === "user") {
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
    }
    raf.current = requestAnimationFrame(paint);
  }

  useEffect(() => {
    void setOrientationLock("portrait");
    void setStatusBarHidden(true);
    return () => {
      void setOrientationLock("unlock");
      void setStatusBarHidden(false);
    };
  }, []);

  useEffect(() => {
    raf.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [css, facing, live]);

  async function applyZoom(next: number, track?: MediaStreamTrack, capsOverride?: { min: number; max: number; native: boolean }) {
    const zc = capsOverride ?? caps;
    const t = track ?? streamRef.current?.getVideoTracks()[0];
    const z = clampZoom(next, zc.min, zc.max);
    setZoom(z);
    if (!t || !zc.native) return;
    await applyTrackZoom(t, z);
  }

  async function startCam(next: CameraFacing) {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraVideoConstraints(next),
        audio: true,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const zc = zoomCapsFromTrack(track);
      const z0 = defaultNativeZoom(zc);
      setCaps(zc);
      setZoom(z0);
      if (zc.native && track) await applyTrackZoom(track, z0);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      storeFacing(next);
      setLive(true);
      setPerm("granted");
    } catch (e) {
      setLive(false);
      const name = e instanceof DOMException ? e.name : "";
      setPerm(name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : "denied");
    }
  }

  useEffect(() => {
    void startCam(facing);
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    const torchCaps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
    if (!track || !torchCaps?.torch) {
      toast.error("Torch isn’t available on this camera.");
      return;
    }
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorch(next);
      setFlash(next ? "on" : "off");
    } catch {
      toast.error("Could not switch the torch.");
    }
  }

  function withCountdown(fn: () => void) {
    if (!countdown) {
      fn();
      return;
    }
    let n = countdown;
    setCount(n);
    const t = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(t);
        setCount(null);
        fn();
      } else setCount(n);
    }, 1000);
  }

  function snapPhoto() {
    void captureStillAndReview();
  }

  function presentStill(still: StillPhoto) {
    releaseStill(stillRef.current);
    stillRef.current = still;
    const diag = diagnosticsFromStill(still);
    lastStillLog(diag);
    setShot({ url: still.objectUrl, kind: "photo", still, using: "original", diag });
    void runEnhance(still, diag);
  }

  async function captureStillAndReview() {
    if (processing) return;
    const track = streamRef.current?.getVideoTracks()[0] ?? null;
    setProcessing("Capturing full-resolution photo…");
    let captured = false;
    try {
      const still = await captureHighResolutionPhoto({
        track,
        facing,
        flash,
        zoom,
        releaseStream: () => {
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          setLive(false);
        },
      });
      captured = true;
      presentStill(still);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "High-resolution capture failed.");
      if (!streamRef.current) void startCam(facing);
    } finally {
      if (!captured) setProcessing(null);
    }
  }

  async function runEnhance(still: StillPhoto, diag: StillDiagnostics) {
    const scale = recommendedEnhanceScale({
      width: still.width,
      height: still.height,
      bytes: still.bytes,
      deviceMemoryGb: deviceMemoryGb(),
      cores: navigator.hardwareConcurrency,
    });
    if (!scale) {
      setProcessing(null);
      return;
    }
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(still.mime)) {
      setProcessing(null);
      return;
    }
    setProcessing("Enhancing photo…");
    try {
      const prepared = await jpegForModel(still.blob);
      const r = await enhanceCapturedPhoto({ data: { imageDataUrl: prepared.dataUrl, scale } });
      if (!r.ok) {
        lastStillLog({ ...diag, error: r.error });
        if (r.provider !== "none" && !/isn't available/i.test(r.error)) toast.error(r.error);
        return;
      }
      const next: StillDiagnostics = {
        ...diag,
        enhanced: true,
        enhanceScale: r.scale,
        enhanceProvider: r.provider,
        enhanceMs: r.durationMs,
        finalWidth: r.width ?? diag.originalWidth,
        finalHeight: r.height ?? diag.originalHeight,
      };
      lastStillLog(next);
      setShot((s) =>
        s?.still === still
          ? { ...s, enhancedUrl: r.imageUrl, using: "enhanced", url: r.imageUrl, diag: next }
          : s,
      );
    } catch (e) {
      lastStillLog({ ...diag, error: e instanceof Error ? e.message : "Enhancement failed." });
    } finally {
      setProcessing(null);
    }
  }

  async function urlForPost(current: NonNullable<typeof shot>, composerUrl?: string): Promise<string> {
    if (composerUrl && composerUrl !== current.url) return composerUrl;
    if (current.using === "enhanced" && current.enhancedUrl) return current.enhancedUrl;
    if (current.still) return stillToPostableDataUrl(current.still.blob);
    return composerUrl || current.url;
  }

  function stopRec() {
    recorder.current?.stop();
    setRecording(false);
    setPaused(false);
  }

  function togglePause() {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    try {
      if (rec.state === "recording") {
        rec.pause();
        pauseAt.current = Date.now();
        setPaused(true);
      } else if (rec.state === "paused") {
        rec.resume();
        pauseAccum.current += Date.now() - pauseAt.current;
        setPaused(false);
      }
    } catch {
      toast.error("Pause isn’t available on this device.");
    }
  }

  function toggleRecord() {
    if (recording) {
      stopRec();
      return;
    }
    const stream = streamRef.current;
    const canvas = canvasRef.current;
    if (!stream || !canvas) {
      toast.error("Camera isn’t ready.");
      return;
    }
    const filtered = canvas.captureStream(30);
    const audio = stream.getAudioTracks();
    audio.forEach((t) => filtered.addTrack(t));
    chunks.current = [];
    const rec = new MediaRecorder(filtered, {
      mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : undefined,
      videoBitsPerSecond: 1_400_000,
    });
    recorder.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    rec.onstop = async () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType || "video/webm" });
      try {
        const file = new File([blob], "nyx-clip.webm", { type: blob.type || "video/webm" });
        const encoded = await compressVideo(file, undefined, { maxSeconds: Math.ceil(maxMs / 1000) || 15 });
        setShot({ url: encoded.dataUrl, kind: "video" });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save that clip.");
      }
    };
    rec.start(250);
    recStarted.current = Date.now();
    pauseAccum.current = 0;
    setElapsed(0);
    setPaused(false);
    setRecording(true);
  }

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => {
      if (recorder.current?.state === "paused") return;
      const e = Date.now() - recStarted.current - pauseAccum.current;
      setElapsed(e);
      if (e >= (maxMs || 15_000)) stopRec();
    }, 200);
    return () => window.clearInterval(t);
  }, [recording, maxMs]);

  async function fromLibrary(file: File) {
    try {
      if (file.type.startsWith("video/")) {
        const encoded = await compressVideo(file);
        setShot({ url: encoded.dataUrl, kind: "video" });
      } else {
        const still = await stillFromBlob(file, { source: "library", facing });
        presentStill(still);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that file.");
    }
  }

  async function sendToFriends(url: string, kind: "photo" | "video", caption: string, filterName: string, usernames: string[]) {
    if (usernames.length === 0) {
      toast.error("Pick at least one friend, or save to Memories.");
      return;
    }
    setBusy(true);
    try {
      const r = await sendFlash({
        data: { mediaUrl: url, mediaKind: kind, caption, filterName, usernames, keepMemory: false },
      });
      toast.success(r.sent ? `Flash sent to ${r.sent}` : "Flash saved");
      nav({ to: "/inbox" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send Flash.");
    } finally {
      setBusy(false);
    }
  }

  if (shot) {
    return (
      <>
        {processing ? (
          <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,var(--kc-safe-top))] z-50 flex justify-center">
            <p className="inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm text-white">
              <Loader2 className="size-4 animate-spin" />
              {processing}
            </p>
          </div>
        ) : null}
        <CaptureComposer
        shot={shot}
        friends={friends.data ?? []}
        busy={busy}
        processing={processing}
        onUse={(which) => {
          setShot((s) => {
            if (!s) return s;
            if (which === "enhanced" && s.enhancedUrl) return { ...s, using: "enhanced", url: s.enhancedUrl };
            return { ...s, using: "original", url: s.still?.objectUrl ?? s.url };
          });
        }}
        onClose={() => {
          releaseStill(stillRef.current);
          stillRef.current = null;
          setShot(null);
          if (!streamRef.current) void startCam(facing);
        }}
        onFlash={async (res, picked) => {
          const url = await urlForPost(shot, res.url);
          await sendToFriends(url, res.kind === "video" ? "video" : "photo", res.caption, res.filter, picked);
        }}
        onStory={async (res) => {
          setBusy(true);
          try {
            const url = await urlForPost(shot, res.url);
            await createStory({
              data: { mediaUrl: url, mediaKind: res.kind === "video" ? "video" : "photo", textBody: res.caption || null },
            });
            toast.success("On your Story for 24 hours.");
            nav({ to: "/" });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not post Story.");
            setBusy(false);
          }
        }}
        onKeep={async (res) => {
          setBusy(true);
          try {
            await sendFlash({
              data: {
                mediaUrl: await urlForPost(shot, res.url),
                mediaKind: res.kind === "video" ? "video" : "photo",
                caption: res.caption,
                filterName: res.filter,
                usernames: [],
                keepMemory: true,
              },
            });
            toast.success("Kept in Memories.");
            nav({ to: "/memories" });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save.");
            setBusy(false);
          }
        }}
        onWatch={async (res) => {
          if (res.kind !== "video") {
            toast.error("Watch needs a video clip.");
            return;
          }
          setBusy(true);
          try {
            const file = await dataUrlToFile(res.url, "capture.webm");
            const up = new MediaUploader();
            const snap = await up.pick(file, { purpose: "video" });
            if (snap.phase !== "ready" || !snap.mediaUrl) {
              throw new Error(snap.error || "Video processing failed. Retry processing.");
            }
            await uploadVideo({
              data: {
                caption: res.caption || "From Capture",
                mediaUrl: snap.mediaUrl,
                uploadId: snap.uploadId,
                filterName: res.filter,
                speed: recSpeed,
                musicTitle: res.music?.title ?? music?.title ?? null,
                soundId: res.music?.soundId ?? music?.soundId ?? null,
                originalAudio: !(res.music || music),
                durationMs: snap.durationMs ?? undefined,
                width: snap.width,
                height: snap.height,
              },
            });
            toast.success("Posted to Watch.");
            nav({ to: "/watch" });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not post to Watch.");
            setBusy(false);
          }
        }}
      />
      </>
    );
  }

  const digitalScale = caps.native ? 1 : zoom;
  const remain = Math.max(0, (maxMs || 0) - elapsed);
  const presets = zoomPresets(caps);

  return (
    <div className="kc-immersive">
      <div
        className="kc-camera-preview"
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            zoomStart.current = { zoom, dist: pointerDistance(e.touches[0], e.touches[1]) };
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2) {
            e.preventDefault();
            const next = pinchZoom(
              zoomStart.current.zoom,
              zoomStart.current.dist,
              pointerDistance(e.touches[0], e.touches[1]),
              caps.min,
              caps.max,
            );
            void applyZoom(next);
          }
        }}
      >
        <video
          ref={videoRef}
          className={cn("size-full", !live && "hidden")}
          style={{ filter: css, transform: cameraPreviewTransform(facing, digitalScale) }}
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full object-cover opacity-0" />
        {layout !== "single" ? <LayoutGuide layout={layout} /> : null}
      </div>

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 pt-[max(0.5rem,var(--kc-safe-top))]">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white"
          onClick={() => nav({ to: "/" })}
          aria-label="Close camera"
        >
          <X className="size-5" />
        </Button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-sm backdrop-blur-md"
          onClick={() => setMusicOpen(true)}
        >
          <Music2 className="size-4" />
          {music ? music.title : "Add sound"}
        </button>
        <span className="w-9" />
      </header>

      <aside className="absolute right-2 top-24 z-10 flex flex-col gap-2">
        <Rail
          label="Flip"
          onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
        >
          <SwitchCamera className="size-5" />
        </Rail>
        <Rail label={flash === "on" ? "On" : flash} onClick={() => void toggleTorch()}>
          <Flashlight className={cn("size-5", torch && "text-warn")} />
        </Rail>
        <Rail label="Timer" active={tool === "timer"} onClick={() => setTool(tool === "timer" ? null : "timer")}>
          <Timer className="size-5" />
        </Rail>
        <Rail label="Layout" active={tool === "layout"} onClick={() => setTool(tool === "layout" ? null : "layout")}>
          <LayoutGrid className="size-5" />
        </Rail>
        <Rail label="Zoom" active={tool === "zoom"} onClick={() => setTool(tool === "zoom" ? null : "zoom")}>
          <ZoomIn className="size-5" />
        </Rail>
        <Rail label="Effects" active={tool === "effects"} onClick={() => setTool(tool === "effects" ? null : "effects")}>
          <Sparkles className="size-5" />
        </Rail>
        <Rail label="More" active={tool === "more"} onClick={() => setTool(tool === "more" ? null : "more")}>
          <MoreHorizontal className="size-5" />
        </Rail>
      </aside>

      {tool === "timer" ? (
        <ToolRow>
          {CAMERA_TIMERS.map((n) => (
            <Chip key={n} on={countdown === n} onClick={() => setCountdown(n)}>
              {n === 0 ? "Off" : `${n}s`}
            </Chip>
          ))}
        </ToolRow>
      ) : null}
      {tool === "layout" ? (
        <ToolRow>
          {CAMERA_LAYOUTS.map((l) => (
            <Chip key={l.id} on={layout === l.id} onClick={() => setLayout(l.id)}>
              {l.label}
            </Chip>
          ))}
        </ToolRow>
      ) : null}
      {tool === "zoom" ? (
        <ToolRow>
          {presets.map((p) => (
            <Chip key={p} on={Math.abs(zoom - p) < 0.08} onClick={() => void applyZoom(p)}>
              {p === 1 ? "1x" : `${p.toFixed(p < 1 ? 1 : 0)}x`}
            </Chip>
          ))}
          <input
            type="range"
            min={caps.min}
            max={caps.max}
            step={0.1}
            value={zoom}
            aria-label="Zoom"
            className="w-40"
            onChange={(e) => void applyZoom(Number(e.target.value))}
          />
          <span className="text-xs tabular-nums">{zoom.toFixed(1)}x</span>
        </ToolRow>
      ) : null}
      {tool === "effects" ? (
        <div className="absolute inset-x-0 bottom-36 z-10">
          <div className="kc-hide-scrollbar flex gap-2 overflow-x-auto px-3">
            {NYX_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs",
                  filter === f.id ? "bg-white text-black" : "bg-black/45",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {tool === "more" ? (
        <ToolRow>
          {([0.5, 1, 2] as const).map((s) => (
            <Chip key={s} on={recSpeed === s} onClick={() => setRecSpeed(s)}>
              {s}x
            </Chip>
          ))}
        </ToolRow>
      ) : null}

      {!live ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <Camera className="size-10 text-white/80" />
          <p className="text-lg font-semibold">
            {perm === "denied" ? "Camera access is off" : "Allow the camera"}
          </p>
          <p className="max-w-xs text-sm text-white/70">
            {perm === "denied"
              ? "NYX cannot open the camera until permission is granted in system settings."
              : "Photo, video, and sound need the camera and microphone."}
          </p>
          <Button onClick={() => void startCam(facing)}>Enable camera</Button>
          {perm === "denied" && isNativePlatform() ? (
            <Button variant="outline" onClick={() => void openSystemSettings()}>
              Open system settings
            </Button>
          ) : null}
          {isNativePlatform() ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  void takeNativePhoto().then(async (p) => {
                    if (!p) return;
                    try {
                      const blob = await (await fetch(p.dataUrl)).blob();
                      presentStill(await stillFromBlob(blob, { source: "capacitor-camera", facing }));
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not read that photo.");
                    }
                  })
                }
              >
                System camera
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void takeNativeVideo().then((p) => {
                    if (p) setShot({ url: p.dataUrl, kind: "video" });
                  })
                }
              >
                Record
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {processing ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-black/50">
          <p className="inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm text-white">
            <Loader2 className="size-4 animate-spin" />
            {processing}
          </p>
        </div>
      ) : null}

      {count !== null ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/40 text-7xl font-semibold">
          {count}
        </div>
      ) : null}

      {recording ? (
        <div className="absolute left-1/2 top-16 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-live px-3 py-1 text-xs font-semibold">
          <span className={cn("size-2 rounded-full bg-white", !paused && "animate-pulse")} />
          {paused ? "Paused" : formatMs(elapsed)} / {formatMs(maxMs)}
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/70 to-transparent px-3 pb-[max(0.75rem,var(--kc-safe-bottom))] pt-16">
        <div className="kc-hide-scrollbar mb-3 flex justify-center gap-4 overflow-x-auto text-sm font-semibold">
          {CAMERA_DURATIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={cn("uppercase tracking-wide", duration === d.id ? "text-white" : "text-white/50")}
              onClick={() => {
                if (d.id === "text") {
                  nav({ to: "/create" });
                  return;
                }
                setDuration(d.id);
              }}
            >
              {d.label}
              {duration === d.id ? <span className="mx-auto mt-1 block h-0.5 w-8 rounded-full bg-white" /> : null}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between px-2">
          <button
            type="button"
            className="grid size-12 place-items-center overflow-hidden rounded-lg bg-white/15"
            aria-label="Library"
            onClick={() => {
              if (isNativePlatform()) {
                void pickFromLibrary({ media: "any", limit: 1 }).then(async (items) => {
                  const i = items[0];
                  if (!i) return;
                  if (i.kind === "video") {
                    setShot({ url: i.dataUrl, kind: "video" });
                    return;
                  }
                  try {
                    const blob = await (await fetch(i.dataUrl)).blob();
                    presentStill(await stillFromBlob(blob, { source: "library", facing }));
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not read that file.");
                  }
                });
                return;
              }
              fileRef.current?.click();
            }}
          >
            <Images className="size-5" />
          </button>
          <button
            type="button"
            aria-label={mode === "video" ? (recording ? "Stop recording" : "Record") : "Take photo"}
            onClick={() => {
              void triggerHaptic();
              if (mode === "video") withCountdown(() => toggleRecord());
              else withCountdown(() => snapPhoto());
            }}
            className={cn(
              "grid size-[4.5rem] place-items-center rounded-full border-[3px] border-white",
              recording ? "bg-live" : "bg-white/15",
            )}
          >
            <span className={cn("rounded-full bg-white", mode === "video" ? "size-7" : "size-14")} />
          </button>
          <button
            type="button"
            className="grid size-12 place-items-center rounded-full bg-white/15"
            aria-label={recording ? (paused ? "Resume recording" : "Pause recording") : "Flip camera"}
            onClick={() => (recording ? togglePause() : setFacing((f) => (f === "user" ? "environment" : "user")))}
          >
            {recording ? <Pause className={cn("size-5", paused && "text-warn")} /> : <FlipHorizontal2 className="size-5" />}
          </button>
        </div>
        <div className="mt-3 flex items-center justify-center gap-8 text-xs font-medium">
          <button type="button" className="text-white/50" onClick={() => nav({ to: "/live" })}>
            LIVE
          </button>
          <span className="text-white">CAMERA</span>
          <button type="button" className="text-white/50" onClick={() => nav({ to: "/create" })}>
            CREATE
          </button>
        </div>
        {recording ? <p className="mt-1 text-center text-[11px] text-white/60">{formatMs(remain)} left</p> : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void fromLibrary(f);
          e.target.value = "";
        }}
      />
      <MusicPicker open={musicOpen} onClose={() => setMusicOpen(false)} onPick={setMusic} />
    </div>
  );
}

function formatMs(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function Rail({
  label,
  children,
  onClick,
  active,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-12 flex-col items-center gap-0.5 text-white">
      <span className={cn("grid size-10 place-items-center rounded-full bg-black/40", active && "bg-white/30")}>
        {children}
      </span>
      <span className="text-[9px] font-medium">{label}</span>
    </button>
  );
}

function ToolRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute right-16 top-28 z-10 flex max-w-[60%] flex-wrap gap-1.5 rounded-2xl bg-black/50 p-2 backdrop-blur-md">
      {children}
    </div>
  );
}

function Chip({ children, on, onClick }: { children: React.ReactNode; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-full px-2.5 py-1 text-xs", on ? "bg-white text-black" : "bg-white/15")}
    >
      {children}
    </button>
  );
}

function LayoutGuide({ layout }: { layout: CameraLayout }) {
  const n = layout === "2" ? 2 : layout === "3" ? 3 : 4;
  return (
    <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateRows: `repeat(${n}, 1fr)` }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="border border-white/25" />
      ))}
    </div>
  );
}

function CaptureComposer({
  shot,
  friends,
  busy,
  processing,
  onUse,
  onClose,
  onFlash,
  onStory,
  onKeep,
  onWatch,
}: {
  shot: {
    url: string;
    kind: "photo" | "video";
    still?: StillPhoto;
    enhancedUrl?: string | null;
    using?: "original" | "enhanced";
    diag?: StillDiagnostics;
  };
  friends: Array<{ userId: string; username: string; displayName: string; avatarUrl: string | null }>;
  busy: boolean;
  processing: string | null;
  onUse: (which: "original" | "enhanced") => void;
  onClose: () => void;
  onFlash: (res: import("@/components/kchat/media-composer").ComposerResult, picked: string[]) => Promise<void>;
  onStory: (res: import("@/components/kchat/media-composer").ComposerResult) => Promise<void>;
  onKeep: (res: import("@/components/kchat/media-composer").ComposerResult) => Promise<void>;
  onWatch: (res: import("@/components/kchat/media-composer").ComposerResult) => Promise<void>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const mp = shot.diag ? megapixels(shot.diag.originalWidth, shot.diag.originalHeight) : null;
  return (
    <>
      {shot.kind === "photo" && (mp || shot.enhancedUrl) ? (
        <div className="pointer-events-auto fixed left-1/2 top-[max(3.4rem,calc(var(--kc-safe-top)+2.6rem))] z-30 flex -translate-x-1/2 items-center gap-2">
          {mp ? (
            <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white/85">{mp} MP</span>
          ) : null}
          {shot.enhancedUrl ? (
            <div className="flex rounded-full bg-black/60 p-0.5">
              <button
                type="button"
                disabled={!!processing}
                onClick={() => onUse("original")}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium",
                  shot.using !== "enhanced" ? "bg-white text-black" : "text-white/80",
                )}
              >
                Original
              </button>
              <button
                type="button"
                disabled={!!processing}
                onClick={() => onUse("enhanced")}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium",
                  shot.using === "enhanced" ? "bg-white text-black" : "text-white/80",
                )}
              >
                Enhanced
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <MediaComposer
      url={shot.url}
      kind={shot.kind}
      title="NYX"
      commitLabel="Send Flash"
      onClose={onClose}
      onCommit={(res) => onFlash(res, picked)}
      slot={
        <div className="kc-hide-scrollbar flex gap-2 overflow-x-auto">
          {friends.map((f) => {
            const on = picked.includes(f.username);
            return (
              <button
                key={f.userId}
                type="button"
                onClick={() => setPicked((s) => (on ? s.filter((x) => x !== f.username) : [...s, f.username]))}
                className="flex w-14 shrink-0 flex-col items-center gap-1"
              >
                <span className={cn("rounded-full p-0.5", on ? "bg-accent" : "bg-border")}>
                  <Avatar src={f.avatarUrl} name={f.displayName} className="size-11" />
                </span>
                <span className="w-full truncate text-center text-[10px] text-muted">{f.displayName}</span>
              </button>
            );
          })}
          {friends.length === 0 ? (
            <p className="py-2 text-xs text-muted">Add friends to send a Flash. You can still Story or Keep.</p>
          ) : null}
        </div>
      }
      extraActions={(res, extraBusy) => (
        <>
          <Button variant="secondary" disabled={busy || extraBusy} onClick={() => void onStory(res)}>
            Story
          </Button>
          <Button variant="outline" disabled={busy || extraBusy} onClick={() => void onKeep(res)}>
            Keep
          </Button>
          <Button variant="outline" disabled={busy || extraBusy || shot.kind !== "video"} onClick={() => void onWatch(res)}>
            Watch
          </Button>
        </>
      )}
    />
    </>
  );
}
