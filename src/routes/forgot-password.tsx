import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Wordmark } from "@/components/kchat/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordIssue } from "@/lib/kchat/password-policy";
import {
  confirmPasswordReset,
  requestPasswordReset,
  resendPasswordReset,
  verifyPasswordResetOtp,
} from "@/lib/kchat/server/password-reset";

export const Route = createFileRoute("/forgot-password")({ component: ForgotPassword });

const SEND_FAIL = "Unable to send code";
const GENERIC_SEND = "We couldn't send your password reset code right now. Please try again later.";

function publicResetError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : fallback;
  if (/not configured on this deployment/i.test(msg)) {
    return "Password reset mail is missing SMTP_PASS on this deployment.";
  }
  if (/nodemailer|\/workspace|pass=|SMTP_PASS=\S+/i.test(msg) && !/Gmail|STARTTLS|EAUTH|ECONNECTION|535/i.test(msg)) {
    return fallback;
  }
  return msg || fallback;
}

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus("Sending...");
    try {
      const r = await requestPasswordReset({ data: { email } });
      setStep("code");
      setCooldown(r.resendInSec ?? 60);
      setStatus("Code sent");
      toast.message(r.message);
    } catch (err) {
      setStatus(SEND_FAIL);
      toast.error(publicResetError(err, GENERIC_SEND));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setStatus("Sending...");
    try {
      const r = await resendPasswordReset({ data: { email } });
      setCooldown(r.resendInSec ?? 60);
      setCode("");
      setStatus("Code sent");
      toast.message(r.message);
    } catch (err) {
      const msg = publicResetError(err, GENERIC_SEND);
      const wait = msg.match(/try again in (\d+)s/i);
      if (wait) setCooldown(Number(wait[1]));
      setStatus(SEND_FAIL);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyPasswordResetOtp({ data: { email, otp: code } });
      setStep("password");
      setStatus("");
      toast.message("Code verified. Choose a new password.");
    } catch (err) {
      const msg = publicResetError(err, "Invalid code");
      setStatus(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    const issue = passwordIssue(password, email);
    if (issue) {
      toast.error(issue);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await confirmPasswordReset({ data: { email, otp: code, password } });
      setStatus("Password successfully changed");
      toast.message("Password successfully changed. Sign in with the new password.");
      window.location.assign("/login");
    } catch (err) {
      const msg = publicResetError(err, "Could not reset the password.");
      setStatus(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="kc-auth-shell grid place-items-center px-6 py-10">
      <div className="kc-auth-card mx-auto max-w-md">
        <Wordmark />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Reset password</h1>
        {status ? <p className="mt-3 text-sm text-muted">{status}</p> : null}

        {step === "email" ? (
          <form onSubmit={sendCode} className="mt-8 space-y-4">
            <p className="text-sm text-muted">
              Enter the email on your NYX account. If it matches, NYX Support will send a one-time
              code from nyx.officialsupport@gmail.com.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Sending..." : "Send code"}
            </Button>
          </form>
        ) : null}

        {step === "code" ? (
          <form onSubmit={verify} className="mt-8 space-y-4">
            <p className="text-sm text-muted">
              Enter the 6-digit code from NYX Support. Codes expire after a short time and can be
              used once.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="code">6-digit code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                pattern="\d{6}"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? "Verifying..." : "Verify code"}
            </Button>
            <button
              type="button"
              className="w-full min-h-11 text-center text-sm text-muted underline-offset-4 hover:underline disabled:opacity-50"
              disabled={busy || cooldown > 0}
              onClick={() => void resend()}
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted underline-offset-4 hover:underline"
              onClick={() => {
                setStep("email");
                setCode("");
                setPassword("");
                setConfirm("");
                setStatus("");
              }}
            >
              Use a different email
            </button>
          </form>
        ) : null}

        {step === "password" ? (
          <form onSubmit={savePassword} className="mt-8 space-y-4">
            <p className="text-sm text-muted">Create a new password, then confirm it.</p>
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Updating..." : "Update password"}
            </Button>
          </form>
        ) : null}

        <p className="mt-8 text-center text-sm text-muted">
          <Link to="/login" className="font-medium text-fg underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
