import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Wordmark } from "@/components/kchat/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verifyTwoFactor } from "@/lib/kchat/server/profiles";

export const Route = createFileRoute("/_app/verify-2fa")({ component: Verify2fa });

function Verify2fa() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm">
        <Wordmark />
        <h1 className="mt-8 text-2xl font-semibold">Two-factor check</h1>
        <p className="mt-2 text-sm text-muted">Enter a code from your authenticator app or a backup code.</p>
        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void verifyTwoFactor({ data: { code } })
              .then(() => nav({ to: "/" }))
              .catch((err) => toast.error(err instanceof Error ? err.message : "Invalid code"))
              .finally(() => setBusy(false));
          }}
        >
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" />
          <Button type="submit" className="w-full" disabled={busy}>
            Verify
          </Button>
        </form>
      </div>
    </main>
  );
}
