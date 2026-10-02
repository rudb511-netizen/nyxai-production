import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  appLockEnabled,
  appLockHasPin,
  appLockMethod,
  appLockTimeoutMs,
  disableAppLock,
  enableAppLock,
  enableBiometricLock,
  nativeBiometricKind,
  nativeBiometricUnlock,
  pinShapeOk,
  requestManualLock,
  setAppLockTimeoutMs,
  verifyAppLockPin,
  type AppLockMethod,
} from "@/utils/nativeCapabilities";

const TIMEOUTS = [
  { label: "Immediately", ms: 0 },
  { label: "After 30 seconds", ms: 30_000 },
  { label: "After 1 minute", ms: 60_000 },
  { label: "After 5 minutes", ms: 300_000 },
  { label: "After 15 minutes", ms: 900_000 },
];

export function AppLockSettings() {
  const [method, setMethod] = useState<AppLockMethod>("off");
  const [timeout, setTimeoutMs] = useState(60_000);
  const [kind, setKind] = useState<"face" | "fingerprint" | "biometric" | "none">("none");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [current, setCurrent] = useState("");
  const [hasPin, setHasPin] = useState(false);

  useEffect(() => {
    void appLockMethod().then(setMethod);
    void appLockTimeoutMs().then(setTimeoutMs);
    void nativeBiometricKind().then(setKind);
    void appLockHasPin().then(setHasPin);
    void appLockEnabled();
  }, []);

  const bioLabel = kind === "face" ? "Face ID" : kind === "fingerprint" ? "Fingerprint" : "Biometrics";

  async function requireCurrent(): Promise<boolean> {
    const stored = await appLockMethod();
    if (stored === "off") return true;
    if (stored === "biometric") {
      const ok = await nativeBiometricUnlock("Confirm it's you");
      if (ok) return true;
      if (!hasPin) {
        toast.error("Biometric authentication was cancelled.");
        return false;
      }
    }
    if (!pinShapeOk(current) || !(await verifyAppLockPin(current))) {
      toast.error("Enter your current PIN first.");
      return false;
    }
    return true;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted">Security</h2>
      <p className="text-xs leading-relaxed text-muted">
        App lock is on this device only. It does not replace your NYX account sign-in, and NYX never stores your fingerprint or face.
      </p>
      <p className="text-sm">
        Status: {method === "off" ? "Off" : "Enabled"}
        {method === "pin" ? " · PIN" : method === "biometric" ? ` · ${bioLabel}` : ""}
      </p>
      <div className="space-y-2">
        {(
          [
            ["off", "Off"],
            ["pin", "PIN lock"],
            ["biometric", kind === "none" ? "Fingerprint / Face ID" : bioLabel],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="nyx-app-lock"
              checked={method === value}
              onChange={() => {
                void (async () => {
                  if (value === method) return;
                  if (!(await requireCurrent())) return;
                  if (value === "off") {
                    await disableAppLock();
                    setMethod("off");
                    setHasPin(false);
                    toast.success("App lock is off.");
                    return;
                  }
                  if (value === "biometric") {
                    if (kind === "none") {
                      toast.error("Biometric authentication is unavailable on this device.");
                      return;
                    }
                    try {
                      await enableBiometricLock();
                      setMethod("biometric");
                      toast.success(`${bioLabel} lock is on.`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not enable biometrics.");
                    }
                    return;
                  }
                  setMethod("pin");
                })();
              }}
            />
            {label}
          </label>
        ))}
      </div>
      {kind === "none" ? (
        <p className="text-xs text-muted">Biometric authentication is unavailable on this device. PIN lock still works here.</p>
      ) : null}
      {method === "pin" || (method !== "off" && !hasPin) ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">Create a 4–6 digit PIN. It is stored as a salted hash in secure storage, never as the PIN itself.</p>
          <input
            className="h-11 w-full rounded-xl border border-border bg-transparent px-3"
            inputMode="numeric"
            autoComplete="off"
            type="password"
            placeholder="New PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <input
            className="h-11 w-full rounded-xl border border-border bg-transparent px-3"
            inputMode="numeric"
            autoComplete="off"
            type="password"
            placeholder="Confirm PIN"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void (async () => {
                if (!pinShapeOk(pin) || pin !== confirm) {
                  toast.error("PIN must be 4–6 digits and match.");
                  return;
                }
                if (hasPin && !(await requireCurrent())) return;
                await enableAppLock(pin);
                setMethod("pin");
                setHasPin(true);
                setPin("");
                setConfirm("");
                setCurrent("");
                toast.success("PIN lock is on.");
              })();
            }}
          >
            Save PIN
          </Button>
        </div>
      ) : null}
      {method !== "off" ? (
        <>
          <label className="block text-xs text-muted">
            Lock after
            <select
              className="mt-1 h-11 w-full rounded-xl border border-border bg-transparent px-3 text-sm text-fg"
              value={timeout}
              onChange={(e) => {
                const ms = Number(e.target.value);
                setTimeoutMs(ms);
                void setAppLockTimeoutMs(ms);
              }}
            >
              {TIMEOUTS.map((t) => (
                <option key={t.ms} value={t.ms}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {hasPin || method === "pin" ? (
            <input
              className="h-11 w-full rounded-xl border border-border bg-transparent px-3"
              inputMode="numeric"
              autoComplete="off"
              type="password"
              placeholder="Current PIN"
              value={current}
              onChange={(e) => setCurrent(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          ) : null}
          <Button type="button" variant="outline" onClick={() => requestManualLock()}>
            Lock NYX now
          </Button>
        </>
      ) : null}
    </section>
  );
}
