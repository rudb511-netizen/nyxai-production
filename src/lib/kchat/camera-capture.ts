/** Orchestrates still capture: ImageCapture → native CameraX/AVFoundation → Capacitor Camera. */

import { Capacitor } from "@capacitor/core";
import { Camera, CameraDirection } from "@capacitor/camera";
import {
  captureStillFromTrack,
  stillCaptureSupported,
  stillFromBlob,
  type StillFacing,
  type StillFlash,
  type StillPhoto,
} from "./camera-still";
import {
  captureNativeHighResPhoto,
  isNativePlatform,
  requestNyxPermission,
} from "@/utils/nativeCapabilities";

export async function captureHighResolutionPhoto(opts: {
  track?: MediaStreamTrack | null;
  facing: StillFacing;
  flash: StillFlash;
  zoom?: number;
  releaseStream?: () => void;
}): Promise<StillPhoto> {
  if (opts.track && stillCaptureSupported(opts.track)) {
    try {
      return await captureStillFromTrack(opts.track, { flash: opts.flash, facing: opts.facing });
    } catch (e) {
      if (!isNativePlatform()) throw e;
    }
  }

  if (isNativePlatform()) {
    opts.releaseStream?.();
    const perm = await requestNyxPermission("camera");
    if (perm === "denied") throw new Error("Camera permission denied.");
    try {
      const native = await captureNativeHighResPhoto({
        facing: opts.facing,
        flash: opts.flash,
        zoom: opts.zoom ?? 1,
      });
      if (native) return native;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/permission/i.test(msg)) throw new Error("Camera permission denied.");
    }
    try {
      const dataUrl = await capacitorStill(opts.facing);
      if (dataUrl) {
        const blob = await (await fetch(dataUrl)).blob();
        return stillFromBlob(blob, { source: "capacitor-camera", facing: opts.facing, lens: "system" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/cancel|user/i.test(msg)) throw new Error("Capture cancelled.");
    }
  }

  throw new Error("High-resolution capture failed. Try the library or another camera.");
}

async function capacitorStill(facing: StillFacing): Promise<string | null> {
  const photo = await Camera.takePhoto({
    quality: 100,
    saveToGallery: false,
    correctOrientation: true,
    includeMetadata: true,
    editable: "no",
    cameraDirection: facing === "user" ? CameraDirection.Front : CameraDirection.Rear,
  });
  const path = photo.webPath || (photo.uri ? Capacitor.convertFileSrc(photo.uri) : "");
  if (path?.startsWith("data:")) return path;
  if (path) {
    const blob = await (await fetch(path)).blob();
    return await blobToData(blob);
  }
  return null;
}

function blobToData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
