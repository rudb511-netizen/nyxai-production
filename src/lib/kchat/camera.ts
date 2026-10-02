/** Camera constraints that keep a natural portrait FOV. Never request 9:16 crops. */

export const CAMERA_FACING_KEY = "nyx-camera-facing";
export const DEFAULT_ZOOM = 1;
export const DIGITAL_ZOOM_MAX = 3;

export type CameraFacing = "user" | "environment";

export function parseFacing(raw: unknown): CameraFacing {
  return raw === "environment" ? "environment" : "user";
}

export function readStoredFacing(): CameraFacing {
  if (typeof localStorage === "undefined") return "user";
  try {
    return parseFacing(localStorage.getItem(CAMERA_FACING_KEY));
  } catch {
    return "user";
  }
}

export function storeFacing(facing: CameraFacing) {
  try {
    localStorage.setItem(CAMERA_FACING_KEY, facing);
  } catch {
    /* private mode */
  }
}

/**
 * Native sensor FOV. Width/height ideals of 720×1280 force a 9:16 crop on 4:3
 * sensors and look “zoomed in”. Only facing is requested; zoom is applied later
 * through the track’s zoom capability when the device exposes it.
 */
export function cameraVideoConstraints(facing: CameraFacing): MediaTrackConstraints {
  return {
    facingMode: { ideal: facing },
    aspectRatio: { ideal: 3 / 4 },
  };
}

export function clampZoom(zoom: number, min: number, max: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  const lo = Number.isFinite(min) ? min : DEFAULT_ZOOM;
  const hi = Number.isFinite(max) ? Math.max(lo, max) : lo;
  return Math.min(hi, Math.max(lo, zoom));
}

export function pinchZoom(
  startZoom: number,
  startDistance: number,
  currentDistance: number,
  min: number,
  max: number,
): number {
  if (!(startDistance > 0) || !Number.isFinite(currentDistance)) {
    return clampZoom(startZoom, min, max);
  }
  return clampZoom(startZoom * (currentDistance / startDistance), min, max);
}

export function pointerDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

export type ZoomCaps = { min: number; max: number; native: boolean };

export function zoomCapsFromTrack(track: { getCapabilities?: () => unknown } | null | undefined): ZoomCaps {
  try {
    const caps = track?.getCapabilities?.() as { zoom?: { min?: number; max?: number } | number } | undefined;
    const z = caps?.zoom;
    if (z && typeof z === "object" && typeof z.min === "number" && typeof z.max === "number" && z.max > z.min) {
      return { min: z.min, max: z.max, native: true };
    }
    if (typeof z === "number" && z > 1) {
      return { min: 1, max: z, native: true };
    }
  } catch {
    /* capabilities unsupported */
  }
  return { min: DEFAULT_ZOOM, max: DIGITAL_ZOOM_MAX, native: false };
}

/** Prefer optical 1x. Never start above 1x when 1 is in range (the zoomed-in default). */
export function defaultNativeZoom(caps: ZoomCaps): number {
  if (caps.min <= DEFAULT_ZOOM && caps.max >= DEFAULT_ZOOM) return DEFAULT_ZOOM;
  return caps.min;
}

export function zoomPresets(caps: ZoomCaps): number[] {
  const marks = [0.5, 1, 2, 3, 5];
  const out: number[] = [];
  for (const m of marks) {
    if (m >= caps.min - 0.05 && m <= caps.max + 0.05) {
      const snapped = clampZoom(m, caps.min, caps.max);
      if (!out.some((v) => Math.abs(v - snapped) < 0.05)) out.push(snapped);
    }
  }
  if (!out.includes(defaultNativeZoom(caps))) out.unshift(defaultNativeZoom(caps));
  return out.sort((a, b) => a - b);
}

export function cameraPreviewTransform(facing: CameraFacing, digitalScale: number): string {
  const flip = facing === "user" ? -1 : 1;
  const z = Number.isFinite(digitalScale) && digitalScale > 0 ? digitalScale : 1;
  return `scaleX(${flip}) scale(${z})`;
}

export async function applyTrackZoom(
  track: { applyConstraints?: (c: MediaTrackConstraints) => Promise<void> } | null | undefined,
  zoom: number,
): Promise<boolean> {
  if (!track?.applyConstraints) return false;
  try {
    await track.applyConstraints({ advanced: [{ zoom }] } as unknown as MediaTrackConstraints);
    return true;
  } catch {
    try {
      await track.applyConstraints({ zoom } as unknown as MediaTrackConstraints);
      return true;
    } catch {
      return false;
    }
  }
}
