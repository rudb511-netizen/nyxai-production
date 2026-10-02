import { Fingerprint } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  appLockHasPin,
  appLockMethod,
  clearPinFailures,
  nativeBiometricKind,
  nativeBiometricUnlock,
  pinFailureState,
  recordPinFailure,
  verifyAppLockPin,
  type AppLockMethod,
} from "@/utils/nativeCapabilities";

export function AppLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [method, setMethod] = useState<AppLockMethod>("pin");
  const [kind, setKind] = useState<"face" | "fingerprint" | "biometric" | "none">("none");
  const [hasPin, setHasPin] = useState(false);
  const [pin, setPin] = useState("");
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void appLockMethod().then(setMethod);
    void nativeBiometricKind().then(setKind);
    void appLockHasPin().then(setHasPin);
    void pinFailureState().then((s) => setUntil(s.until));
  }, []);

  const unlockRef = useRef(onUnlock);
  unlockRef.current = onUnlock;
  const asked = useRef(false);

  useEffect(() => {
    if (method !== "biometric" || kind === "none" || asked.current) return;
    asked.current = true;
    const label = kind === "face" ? "Unlock with Face ID" : kind === "fingerprint" ? "Unlock with fingerprint" : "Unlock NYX";
    void nativeBiometricUnlock(label).then((ok) => {
      if (ok) unlockRef.current();
    });
  }, [method, kind]);

  useEffect(() => {
    if (until <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until]);

  const label =
    kind === "face" ? "Unlock with Face ID" : kind === "fingerprint" ? "Unlock with fingerprint" : "Unlock with biometrics";
  const wait = Math.max(0, until - now);

  async function submit(next: string) {
    if (wait > 0) return;
    const ok = await verifyAppLockPin(next);
    if (!ok) {
      const fail = await recordPinFailure();
      setUntil(fail.until);
      setPin("");
      toast.error(fail.until > Date.now() ? "Too many attempts. Wait before trying again." : "That PIN didn't match.");
      return;
    }
    await clearPinFailures();
    setPin("");
    onUnlock();
  }

  function press(key: string) {
    if (wait > 0) return;
    if (key === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    const next = (pin + key).slice(0, 6);
    setPin(next);
    if (next.length >= 4 && next.length === 6) void submit(next);
  }

  const showPin = method !== "biometric" || hasPin;

  return (
    <div className="kc-app-lock" role="dialog" aria-modal="true" aria-label="Unlock NYX">
      <p className="text-center text-lg font-semibold">Unlock NYX</p>
      <p className="mt-1 text-center text-sm text-muted">
        {method === "biometric" && kind !== "none" ? label : "Enter your PIN"}
      </p>
      {showPin ? (
        <>
          <p className="mt-6 text-center tracking-[0.6em] text-lg" aria-label="PIN">
            {"●".repeat(pin.length)}
            {"○".repeat(Math.max(0, 4 - pin.length))}
          </p>
          {wait > 0 ? <p className="mt-2 text-center text-xs text-warn">Try again in {Math.ceil(wait / 1000)}s</p> : null}
          <div className="mx-auto mt-6 grid w-full max-w-xs grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key) =>
              key === "" ? (
                <span key="gap" />
              ) : (
                <button
                  key={key}
                  type="button"
                  className="grid h-14 place-items-center rounded-2xl bg-elevated text-lg font-medium active:scale-95"
                  aria-label={key === "del" ? "Delete" : key}
                  onClick={() => press(key)}
                >
                  {key === "del" ? "⌫" : key}
                </button>
              ),
            )}
          </div>
          {pin.length >= 4 && pin.length < 6 ? (
            <button type="button" className="mx-auto mt-4 text-sm text-accent" onClick={() => void submit(pin)}>
              Unlock
            </button>
          ) : null}
        </>
      ) : null}
      {method === "biometric" && kind !== "none" ? (
        <button
          type="button"
          className="mx-auto mt-6 flex min-h-12 items-center gap-2 rounded-full bg-elevated px-4"
          onClick={() => {
            void nativeBiometricUnlock(label).then((ok) => {
              if (ok) onUnlock();
              else toast.error("Biometric unlock was cancelled.");
            });
          }}
        >
          <Fingerprint className="size-5" />
          {label}
        </button>
      ) : method === "biometric" ? (
        <p className="mt-4 text-center text-sm text-muted">Biometric authentication is unavailable on this device.</p>
      ) : null}
    </div>
  );
}
