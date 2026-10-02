import { Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { speakOmni } from "@/lib/kchat/omni-stream-client";
import { cn } from "@/lib/utils";

type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function getSR(): (new () => SpeechRec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function OmniLiveVoice({
  voiceId,
  voiceSpeed,
  busy,
  onAsk,
  onClose,
}: {
  voiceId: string;
  voiceSpeed: number;
  busy: boolean;
  onAsk: (text: string) => Promise<string>;
  onClose: () => void;
}) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [interim, setInterim] = useState("");
  const [log, setLog] = useState<{ who: "you" | "ai"; text: string }[]>([]);
  const recRef = useRef<SpeechRec | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loop = useRef(true);

  useEffect(() => {
    loop.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        setLog((cur) => [...cur, { who: "ai", text: "Microphone permission is needed for live voice." }]);
        return;
      }
      if (!cancelled) startListen();
    })();
    return () => {
      cancelled = true;
      loop.current = false;
      recRef.current?.stop();
      audioRef.current?.pause();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function interrupt() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setSpeaking(false);
  }

  function startListen() {
    if (muted) return;
    const SR = getSR();
    if (!SR) return;
    interrupt();
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (ev) => {
      const last = ev.results[ev.results.length - 1];
      if (!last) return;
      const t = last[0].transcript.trim();
      setInterim(t);
      if (speaking && t.length > 2) interrupt();
      if (last.isFinal && t) {
        setInterim("");
        void handleUtterance(t);
      }
    };
    rec.onerror = () => {
      setListening(false);
      if (loop.current && !muted && !speaking) {
        window.setTimeout(() => {
          if (loop.current && !muted) startListen();
        }, 600);
      }
    };
    rec.onend = () => {
      setListening(false);
      if (loop.current && !muted && !speaking) {
        try {
          rec.start();
          setListening(true);
        } catch {
          /* already started */
        }
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      /* ignore */
    }
  }

  async function handleUtterance(text: string) {
    recRef.current?.stop();
    setListening(false);
    setLog((cur) => [...cur, { who: "you" as const, text }].slice(-8));
    try {
      const reply = await onAsk(text);
      setLog((cur) => [...cur, { who: "ai" as const, text: reply }].slice(-8));
      if (loop.current) await speak(reply);
    } catch {
      setLog((cur) => [...cur, { who: "ai" as const, text: "I couldn't catch that. Try again." }].slice(-8));
    } finally {
      if (loop.current && !muted) startListen();
    }
  }

  async function speak(raw: string) {
    const clipped = raw
      .replace(/```[\s\S]*?```/g, " code block. ")
      .replace(/!\[[^\]]*]\([^)]+\)/g, " image. ")
      .replace(/[#*_`>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1800);
    if (!clipped) return;
    interrupt();
    const blob = await speakOmni(clipped, voiceId);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setSpeaking(true);
      await new Promise<void>((resolve) => {
        audio.onended = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = () => {
          setSpeaking(false);
          resolve();
        };
        void audio.play().catch(() => resolve());
      });
      return;
    }
    if (typeof speechSynthesis === "undefined") return;
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(clipped);
      u.rate = voiceSpeed || 1;
      u.onend = () => {
        setSpeaking(false);
        resolve();
      };
      u.onerror = () => {
        setSpeaking(false);
        resolve();
      };
      setSpeaking(true);
      speechSynthesis.speak(u);
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg/95 backdrop-blur-md">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-semibold">Live voice</p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div
          className={cn(
            "grid size-28 place-items-center rounded-full",
            speaking ? "bg-ai/20 kc-live-pulse" : listening ? "bg-ok/20 kc-live-pulse" : "bg-elevated",
          )}
        >
          {muted ? <MicOff className="size-10 text-muted" /> : speaking ? <Volume2 className="size-10 text-ai" /> : <Mic className="size-10 text-ok" />}
        </div>
        <p className="text-sm text-muted">
          {muted ? "Muted" : speaking ? "NYXAI is speaking — talk to interrupt" : listening ? "Listening…" : busy ? "Thinking…" : "Tap the mic"}
        </p>
        {interim ? <p className="max-w-sm text-center text-sm">{interim}</p> : null}
        <ul className="max-h-40 w-full max-w-sm space-y-2 overflow-y-auto text-sm">
          {log.map((row, i) => (
            <li key={`${row.who}-${i}`} className={row.who === "you" ? "text-right text-accent" : "text-fg"}>
              {row.text.slice(0, 180)}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-center gap-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Button
          size="icon"
          variant={muted ? "default" : "secondary"}
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            if (next) {
              recRef.current?.stop();
              setListening(false);
            } else startListen();
          }}
        >
          {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </Button>
        <Button
          size="icon"
          variant="danger"
          aria-label="End voice"
          onClick={() => {
            loop.current = false;
            recRef.current?.stop();
            interrupt();
            onClose();
          }}
        >
          <PhoneOff className="size-5" />
        </Button>
      </div>
    </div>
  );
}
