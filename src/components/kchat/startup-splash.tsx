import { useEffect, useState } from "react";
import { KMark } from "./logo";
import { cn } from "@/lib/utils";
import { hideNativeSplash } from "@/utils/nativeCapabilities";

const KEY = "nyx-splash-seen";
const FIRST_VISIT_MS = 6200;

export function StartupSplash({ ready }: { ready: boolean }) {
  const [show, setShow] = useState(true);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    void hideNativeSplash();
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = sessionStorage.getItem(KEY) === "1";
    if (seen || reduced) {
      const t = window.setTimeout(() => {
        if (!ready && !reduced) return;
        setFade(true);
        window.setTimeout(() => setShow(false), 280);
      }, reduced ? 280 : ready ? 400 : 400);
      if (!ready && !reduced) {
        const i = window.setInterval(() => {
          if (ready) {
            window.clearInterval(i);
            setFade(true);
            window.setTimeout(() => setShow(false), 280);
          }
        }, 80);
        return () => {
          window.clearTimeout(t);
          window.clearInterval(i);
        };
      }
      return () => window.clearTimeout(t);
    }
    const started = Date.now();
    const finish = () => {
      sessionStorage.setItem(KEY, "1");
      setFade(true);
      window.setTimeout(() => setShow(false), 520);
    };
    const tick = () => {
      const elapsed = Date.now() - started;
      if (elapsed < FIRST_VISIT_MS) return;
      if (!ready) return;
      finish();
      return true;
    };
    if (tick()) return;
    const i = window.setInterval(() => {
      if (tick()) window.clearInterval(i);
    }, 80);
    return () => window.clearInterval(i);
  }, [ready]);

  if (!show) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[80] grid place-items-center bg-bg text-fg transition-opacity duration-500",
        fade && "opacity-0",
      )}
      aria-label="NYX is opening"
    >
      <div className="kc-splash relative grid place-items-center">
        <div className="kc-splash-stars" aria-hidden />
        <div className="kc-splash-glow" />
        <div className="kc-splash-moon">
          <KMark className="size-20" />
        </div>
        <p className="mt-8 font-display text-3xl font-semibold tracking-[0.32em]">NYX</p>
        <p className="mt-2 text-xs tracking-[0.22em] text-muted">THE NIGHT NETWORK</p>
      </div>
    </div>
  );
}
