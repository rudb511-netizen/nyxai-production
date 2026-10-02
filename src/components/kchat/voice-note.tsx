import { Pause, Play, Mic, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function VoiceRecorder({
  onSend,
  onCancel,
}: {
  onSend: (payload: { dataUrl: string; durationMs: number }) => void;
  onCancel: () => void;
}) {
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const elapsedRef = useRef(0);
  const tickRef = useRef(0);
  const [ms, setMs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        recRef.current = rec;
        chunks.current = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.current.push(e.data);
        };
        elapsedRef.current = 0;
        tickRef.current = Date.now();
        rec.start(200);
        timer = window.setInterval(() => {
          if (recRef.current?.state === "paused") {
            tickRef.current = Date.now();
            return;
          }
          elapsedRef.current += Date.now() - tickRef.current;
          tickRef.current = Date.now();
          setMs(elapsedRef.current);
        }, 200);
      } catch {
        setErr("Microphone permission is required to record a voice message.");
      }
    })();
    return () => {
      if (timer) window.clearInterval(timer);
      recRef.current?.state === "recording" && recRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function finish(send: boolean) {
    const rec = recRef.current;
    const elapsed = elapsedRef.current;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (!rec || rec.state === "inactive") {
      onCancel();
      return;
    }
    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      rec.stop();
    });
    if (!send || elapsed < 400) {
      onCancel();
      return;
    }
    const dataUrl = await blobToDataUrl(blob);
    onSend({ dataUrl, durationMs: elapsed });
  }

  if (err) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-danger">
        <span className="flex-1">{err}</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <span className="size-2 animate-pulse rounded-full bg-live" />
      <span className="min-w-12 text-sm tabular-nums">{formatMs(ms)}</span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={paused ? "Resume" : "Pause"}
        onClick={() => {
          const rec = recRef.current;
          if (!rec) return;
          if (paused) {
            rec.resume();
            setPaused(false);
          } else {
            rec.pause();
            setPaused(true);
          }
        }}
      >
        {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => void finish(false)} aria-label="Cancel recording">
        <Trash2 className="size-4" />
      </Button>
      <Button size="icon-sm" onClick={() => void finish(true)} aria-label="Send voice message">
        <Square className="size-4" />
      </Button>
    </div>
  );
}

export function VoiceBubble({ src, durationMs, mine }: { src: string; durationMs: number; mine?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      const d = a.duration || durationMs / 1000;
      setProgress(d ? a.currentTime / d : 0);
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, [durationMs]);

  return (
    <div className="flex min-w-[180px] items-center gap-2">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className={cn(
          "grid size-9 place-items-center rounded-full",
          mine ? "bg-white/20" : "bg-accent text-accent-fg",
        )}
        onClick={() => {
          const a = audioRef.current;
          if (!a) return;
          if (playing) {
            a.pause();
            setPlaying(false);
          } else {
            void a.play();
            setPlaying(true);
          }
        }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(e) => {
            const a = audioRef.current;
            if (!a) return;
            const d = a.duration || durationMs / 1000;
            a.currentTime = (Number(e.target.value) / 1000) * d;
          }}
          className="w-full accent-current"
          aria-label="Seek"
        />
        <p className="text-[10px] tabular-nums opacity-70">{formatMs(durationMs)}</p>
      </div>
    </div>
  );
}

export function VoiceButton({ onStart, className }: { onStart: () => void; className?: string }) {
  return (
    <button type="button" aria-label="Voice message" className={cn("kc-composer-icon kc-composer-icon-record", className)} onClick={onStart}>
      <span className="kc-composer-icon-glyph">
        <Mic className="kc-composer-icon-svg" strokeWidth={1.75} />
      </span>
    </button>
  );
}

function formatMs(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Could not read recording."));
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}
