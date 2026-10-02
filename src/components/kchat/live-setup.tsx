import { useNavigate } from "@tanstack/react-router";
import { Mic, MicOff, SwitchCamera, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startLive } from "@/lib/kchat/server/more";

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

function permissionMessage(e: unknown, kind: "video" | "audio") {
  const name = e instanceof DOMException ? e.name : e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return kind === "audio"
      ? "Microphone permission was denied. Allow the mic in your browser or system settings, then try again."
      : "Camera or microphone permission was denied. Allow both, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return kind === "audio" ? "No microphone was found on this device." : "No camera was found on this device.";
  }
  return e instanceof Error ? e.message : "Could not start the camera.";
}

/** Pre-live setup. Cancel never creates a session. Start is the only call to startLive. */
export function LiveSetup() {
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [kind, setKind] = useState<"video" | "audio">("video");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [micOn, setMicOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function openPreview(nextKind: "video" | "audio", nextFacing: "user" | "environment", nextMic: boolean) {
    stopStream(streamRef.current);
    streamRef.current = null;
    setReady(false);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: nextKind === "video" ? { facingMode: nextFacing } : false,
        audio: true,
      });
      const audio = stream.getAudioTracks()[0];
      if (audio) audio.enabled = nextMic;
      streamRef.current = stream;
      if (videoRef.current && nextKind === "video") videoRef.current.srcObject = stream;
      setReady(true);
    } catch (e) {
      setError(permissionMessage(e, nextKind));
    }
  }

  useEffect(() => {
    void openPreview(kind, facing, micOn);
    return () => stopStream(streamRef.current);
    // Preview restarts from the explicit controls, not on every mic toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, facing]);

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    const audio = streamRef.current?.getAudioTracks()[0];
    if (audio) audio.enabled = next;
  }

  function cancel() {
    stopStream(streamRef.current);
    streamRef.current = null;
    nav({ to: "/live" });
  }

  async function start() {
    if (!ready) {
      toast.error(error || "Allow the camera and microphone before going live.");
      return;
    }
    setBusy(true);
    stopStream(streamRef.current);
    streamRef.current = null;
    try {
      const r = await startLive({
        data: {
          title: title.trim() || (kind === "audio" ? "Audio room" : "Live"),
          kind,
          description: description.trim(),
        },
      });
      nav({ to: "/live/$id", params: { id: r.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not go live.");
      setBusy(false);
      void openPreview(kind, facing, micOn);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        {kind === "video" ? (
          <video ref={videoRef} autoPlay playsInline muted className="aspect-[3/4] w-full object-cover" />
        ) : (
          <div className="grid aspect-[3/4] w-full place-items-center text-white">
            <div className="text-center">
              <Mic className="mx-auto size-8" />
              <p className="mt-2 text-sm">{ready ? "Microphone ready" : "Waiting for microphone"}</p>
            </div>
          </div>
        )}
        <p className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-1 text-xs text-white">Preview · not live yet</p>
      </div>
      {error ? (
        <p className="text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" variant={kind === "video" ? "default" : "outline"} onClick={() => setKind("video")}>
          <Video className="size-4" /> Video
        </Button>
        <Button size="sm" variant={kind === "audio" ? "default" : "outline"} onClick={() => setKind("audio")}>
          <Mic className="size-4" /> Audio room
        </Button>
      </div>
      <div className="flex gap-2">
        {kind === "video" ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}>
            <SwitchCamera className="size-4" /> {facing === "user" ? "Front" : "Rear"}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={toggleMic} aria-pressed={micOn} aria-label={micOn ? "Mute microphone" : "Unmute microphone"}>
          {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />} {micOn ? "Mic on" : "Mic off"}
        </Button>
      </div>
      <Input
        placeholder={kind === "audio" ? "Room title" : "Live title"}
        aria-label="Live title"
        value={title}
        maxLength={80}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Input
        placeholder="Description (optional)"
        aria-label="Live description"
        value={description}
        maxLength={200}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={cancel} disabled={busy}>
          <X className="size-4" /> Cancel
        </Button>
        <Button type="button" className="flex-1" disabled={busy || !ready} onClick={() => void start()}>
          {busy ? "Starting…" : "Start Live"}
        </Button>
      </div>
    </div>
  );
}
