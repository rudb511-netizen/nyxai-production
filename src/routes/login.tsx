import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Wordmark } from "@/components/kchat/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { checkAuthGate, noteAuthFailure, noteAuthSuccess } from "@/lib/kchat/server/security";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (isPending) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <div className="h-8 w-40 animate-pulse rounded-full bg-elevated" />
      </main>
    );
  }
  if (user) return <Navigate to="/" />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await checkAuthGate({ data: { email } });
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        await noteAuthFailure({ data: { email } }).catch(() => {});
        throw new Error(error.message ?? "Could not sign in.");
      }
      await noteAuthSuccess().catch(() => {});
      window.location.assign("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="kc-auth-shell grid place-items-center px-6 py-10">
      <div className="kc-auth-card mx-auto max-w-md">
        <Wordmark />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-sm text-muted">Sign in for your feed, Flashes, and friends.</p>
        {authEnabled ? (
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-sm">
              <Link to="/forgot-password" className="text-muted underline-offset-4 hover:underline">
                Forgot password?
              </Link>
            </p>
          </form>
        ) : (
          <p className="mt-6 text-sm text-muted">Sign-in is disabled.</p>
        )}
        {authEnabled ? (
          <div className="mt-6 space-y-2">
            <p className="text-center text-xs text-subtle">or continue with</p>
            {GROK_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => signIn(p.providerId, { callbackURL: "/" })}
              >
                Continue with {p.label}
              </Button>
            ))}
          </div>
        ) : null}
        <p className="mt-8 text-center text-sm text-muted">
          New here?{" "}
          <Link to="/register" className="font-medium text-fg underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
