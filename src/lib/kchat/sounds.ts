export type SoundPrefs = {
  messages: boolean;
  typing: boolean;
  calls: boolean;
  notifications: boolean;
  vibration: boolean;
};

export const DEFAULT_SOUND_PREFS: SoundPrefs = {
  messages: true,
  typing: true,
  calls: true,
  notifications: true,
  vibration: true,
};

export function parseSoundPrefs(raw: unknown): SoundPrefs {
  const obj =
    typeof raw === "string"
      ? (JSON.parse(raw) as Record<string, unknown>)
      : ((raw ?? {}) as Record<string, unknown>);
  return {
    messages: obj.messages !== false,
    typing: obj.typing !== false,
    calls: obj.calls !== false,
    notifications: obj.notifications !== false,
    vibration: obj.vibration !== false,
  };
}

const last: Partial<Record<SoundKey, number>> = {};
let ctx: AudioContext | null = null;

export type SoundKey = "send" | "receive" | "typing" | "gift" | "record" | "recordStop";

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

function beep(opts: { freq: number; dur: number; gain: number; type?: OscillatorType; slide?: number }) {
  const c = audio();
  if (!c) return;
  void c.resume().catch(() => {});
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.freq, now);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freq + opts.slide), now + opts.dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(opts.gain, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + opts.dur);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + opts.dur + 0.02);
}

export function playNyxSound(key: SoundKey, prefs?: Partial<SoundPrefs> | null) {
  const p = prefs ?? {};
  if (typeof document !== "undefined" && document.hidden) return;
  if (key === "typing" && p.typing === false) return;
  if ((key === "send" || key === "receive" || key === "gift") && p.messages === false) return;
  const now = Date.now();
  const gap = key === "typing" ? 2400 : 180;
  if (last[key] && now - last[key]! < gap) return;
  last[key] = now;
  try {
    if (key === "send") beep({ freq: 880, dur: 0.07, gain: 0.04, slide: 220 });
    else if (key === "receive") beep({ freq: 520, dur: 0.09, gain: 0.045, type: "triangle" });
    else if (key === "typing") beep({ freq: 340, dur: 0.04, gain: 0.018, type: "triangle" });
    else if (key === "gift") {
      beep({ freq: 660, dur: 0.08, gain: 0.05 });
      setTimeout(() => beep({ freq: 990, dur: 0.1, gain: 0.04 }), 70);
    } else if (key === "record") beep({ freq: 420, dur: 0.06, gain: 0.03 });
    else if (key === "recordStop") beep({ freq: 280, dur: 0.08, gain: 0.03, slide: -80 });
  } catch {
    /* autoplay */
  }
}

export function haptic(prefs?: Partial<SoundPrefs> | null) {
  if (prefs?.vibration === false) return;
  try {
    navigator.vibrate?.(12);
  } catch {
    /* ignore */
  }
}

/** One controlled loop while the other person is typing. Not overlapping one-shots. */
export function typingLoopShouldRun(opts: {
  othersTyping: boolean;
  prefsOn: boolean;
  hidden: boolean;
}): boolean {
  return Boolean(opts.othersTyping && opts.prefsOn && !opts.hidden);
}

let typingTimer: ReturnType<typeof setInterval> | null = null;

export function startTypingLoop(prefs?: Partial<SoundPrefs> | null) {
  if (prefs?.typing === false) return;
  if (typeof document !== "undefined" && document.hidden) return;
  if (typingTimer) return;
  const tick = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      beep({ freq: 340, dur: 0.035, gain: 0.014, type: "triangle" });
    } catch {
      /* autoplay */
    }
  };
  tick();
  typingTimer = setInterval(tick, 720);
}

export function stopTypingLoop() {
  if (!typingTimer) return;
  clearInterval(typingTimer);
  typingTimer = null;
}

export function typingLoopActive(): boolean {
  return typingTimer != null;
}
