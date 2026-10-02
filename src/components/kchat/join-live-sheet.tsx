import { Mic, MicOff, SwitchCamera, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Local camera check only. Tracks are stopped before the request is sent. */
export function JoinLiveSheet({
  title,
  confirmLabel,
  allowVideo,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  confirmLabel: string;
  allowVideo: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [camOn, setCamOn] = useState(allowVideo);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const prev = streamRef.current;
    prev?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: allowVideo && camOn ? { facingMode: facing } : false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.getAudioTracks().forEach((t) => {
          t.enabled = micOn;
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setError(null);
        setReady(true);
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera or microphone permission was denied. You can still send the request, and the host decides if you join."
            : e instanceof Error
              ? e.message
              : "Could not open the camera.",
        );
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [allowVideo, camOn, facing]);

  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = micOn;
    });
  }, [micOn]);

  function stopPreview() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/75 p-3 sm:items-center sm:justify-center" role="dialog" aria-label={title}>
      <div className="mx-auto w-full max-w-md rounded-3xl bg-zinc-950 p-4 pb-[max(1rem,var(--kc-safe-bottom))] text-white">
        <p className="text-base font-semibold">{title}</p>
        <p className="mt-1 text-sm text-white/65">
          This preview stays on your device. Nothing is sent until the host accepts.
        </p>
        <div className="relative mt-3 aspect-[4/3] overflow-hidden rounded-2xl bg-black">
          {allowVideo && camOn && !error ? (
            <video ref={videoRef} autoPlay playsInline muted className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center px-6 text-center text-sm text-white/70">
              {error ?? (camOn ? "Starting camera…" : "Camera is off. You can request to join with audio only.")}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-3 text-sm"
            onClick={() => setMicOn((v) => !v)}
            aria-pressed={micOn}
          >
            {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
            {micOn ? "Mic on" : "Mic off"}
          </button>
          {allowVideo ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-3 text-sm"
              onClick={() => setCamOn((v) => !v)}
              aria-pressed={camOn}
            >
              {camOn ? <Video className="size-4" /> : <VideoOff className="size-4" />}
              {camOn ? "Camera on" : "Camera off"}
            </button>
          ) : null}
          {allowVideo && camOn ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-3 text-sm"
              onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            >
              <SwitchCamera className="size-4" />
              {facing === "user" ? "Front" : "Rear"}
            </button>
          ) : null}
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1 border-white/20 text-white"
            onClick={() => {
              stopPreview();
              onCancel();
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="kc-pay-glow flex-1 !text-white"
            disabled={busy || !ready}
            onClick={() => {
              stopPreview();
              void onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
