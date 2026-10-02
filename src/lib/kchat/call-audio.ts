/** Real getUserMedia + WebRTC quality. Native AEC on the capture track — never Web Audio on send. */

export type VoiceMode = "auto" | "standard" | "clear" | "noise";
export type VideoTier = "4k" | "1440" | "1080" | "720" | "480";

const HEIGHT: Record<VideoTier, number> = {
  "4k": 2160,
  "1440": 1440,
  "1080": 1080,
  "720": 720,
  "480": 480,
};

export function audioConstraints(mode: VoiceMode): MediaTrackConstraints {
  const heavy = mode === "noise" || mode === "clear";
  return {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    ...(heavy ? { voiceIsolation: { ideal: true } } : {}),
  } as MediaTrackConstraints;
}

export function videoConstraints(opts: {
  facing: "user" | "environment";
  tier: VideoTier;
  ios?: boolean;
}): MediaTrackConstraints {
  if (opts.ios) {
    return { facingMode: { ideal: opts.facing } };
  }
  const h = HEIGHT[opts.tier];
  const w = Math.round(h * (16 / 9));
  return {
    facingMode: { ideal: opts.facing },
    width: { ideal: w, max: 3840 },
    height: { ideal: h, max: 2160 },
    frameRate: { ideal: 30, max: 60 },
  };
}

export function isIOSCallClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  if (typeof document !== "undefined" && document.documentElement.dataset.platform === "ios") return true;
  return false;
}

function callPermissionError(kind: "video" | "audio", err: unknown): Error {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return new Error(
      kind === "video"
        ? "Camera permission is required for video calls. Enable Camera and Microphone in iOS Settings → NYX, then tap Answer again."
        : "Microphone permission is required for calls. Enable Microphone in iOS Settings → NYX, then tap Answer again.",
    );
  }
  if (name === "NotFoundError") {
    return new Error(kind === "video" ? "No camera is available on this device." : "No microphone is available on this device.");
  }
  if (err instanceof Error && err.message) return err;
  return new Error(kind === "video" ? "Could not start the camera for this call." : "Could not start the microphone for this call.");
}

export async function getCallMedia(opts: {
  video: boolean;
  facing?: "user" | "environment";
  mode?: VoiceMode;
  tier?: VideoTier;
}): Promise<{ stream: MediaStream; actualHeight: number; label: string }> {
  const mode = opts.mode ?? "auto";
  const tier = opts.tier ?? "720";
  const facing = opts.facing ?? "user";
  const ios = isIOSCallClient();
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot access the camera or microphone.");
  }
  if (opts.video) {
    try {
      const { requestNyxPermission, isNativePlatform } = await import("@/utils/nativeCapabilities");
      if (isNativePlatform()) {
        const cam = await requestNyxPermission("camera");
        if (cam === "denied") throw callPermissionError("video", { name: "NotAllowedError" });
      }
    } catch (e) {
      if (e instanceof Error && /permission is required/i.test(e.message)) throw e;
    }
  }

  const attempts: MediaStreamConstraints[] = opts.video
    ? [
        { audio: audioConstraints(mode), video: videoConstraints({ facing, tier, ios }) },
        { audio: true, video: { facingMode: { ideal: facing } } },
        { audio: true, video: { facingMode: facing } },
        { audio: true, video: true },
      ]
    : [
        { audio: audioConstraints(mode), video: false },
        { audio: true, video: false },
      ];

  let stream: MediaStream | null = null;
  let last: unknown;
  for (const constraints of attempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      break;
    } catch (e) {
      last = e;
    }
  }
  if (!stream) throw callPermissionError(opts.video ? "video" : "audio", last);

  await applyVoiceMode(stream, mode);
  const v = stream.getVideoTracks()[0];
  const settings = v?.getSettings() ?? {};
  const actualHeight = Number(settings.height) || 0;
  const label =
    actualHeight >= 2000
      ? "4K"
      : actualHeight >= 1400
        ? "1440p"
        : actualHeight >= 1000
          ? "1080p"
          : actualHeight >= 700
            ? "720p"
            : actualHeight > 0
              ? `${actualHeight}p`
              : "voice";
  return { stream, actualHeight, label };
}

export async function bindLocalPreview(el: HTMLVideoElement | null, stream: MediaStream | null): Promise<void> {
  if (!el) return;
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.muted = true;
  el.autoplay = true;
  el.playsInline = true;
  el.srcObject = stream;
  if (!stream) return;
  try {
    await el.play();
  } catch {
    /* iOS may still require a later tap; muted+inline usually succeeds */
  }
}

export function nextLowerTier(tier: VideoTier): VideoTier | null {
  if (tier === "4k") return "1440";
  if (tier === "1440") return "1080";
  if (tier === "1080") return "720";
  if (tier === "720") return "480";
  return null;
}

export function tierFromNetwork(effectiveType?: string | null, downlink?: number | null): VideoTier {
  const t = (effectiveType ?? "").toLowerCase();
  if (t === "slow-2g" || t === "2g") return "480";
  if (t === "3g" || (downlink != null && downlink < 1.5)) return "720";
  if (downlink != null && downlink >= 20) return "4k";
  if (t === "4g" || (downlink != null && downlink < 8)) return "1080";
  return "1080";
}

export function networkVideoTier(): VideoTier {
  if (typeof navigator === "undefined") return "1080";
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
  return tierFromNetwork(conn?.effectiveType, conn?.downlink);
}

export async function applySenderBitrate(pc: RTCPeerConnection, maxKbps: number) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    const params = sender.getParameters();
    if (!params.encodings?.length) {
      params.encodings = [{ maxBitrate: maxKbps * 1000 }];
    } else {
      for (const enc of params.encodings) enc.maxBitrate = maxKbps * 1000;
    }
    try {
      await sender.setParameters(params);
    } catch {
      /* browser may reject mid-call */
    }
  }
}

/**
 * Voice enhancement MUST stay on the capture track via native constraints.
 * Routing send audio through Web Audio drops the browser AEC reference and causes echo.
 */
export async function applyVoiceMode(stream: MediaStream, mode: VoiceMode): Promise<void> {
  const track = stream.getAudioTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints(audioConstraints(mode));
  } catch {
    /* device may reject voiceIsolation */
  }
}

/** Kept for call UI. Never replaces the send track — native AEC stays intact. */
export function attachEnhancement(stream: MediaStream, _mode: VoiceMode): { stream: MediaStream; stop: () => void } {
  return { stream, stop: () => {} };
}

export function usesNativeAecSendPath(): boolean {
  return true;
}
