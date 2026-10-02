import { useMutation, useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { COIN_GIFTS } from "@/lib/kchat/coins";
import { getCoinWallet, sendCoinGift } from "@/lib/kchat/server/coins";
import { playNyxSound } from "@/lib/kchat/sounds";
import { cn } from "@/lib/utils";

export function GiftSheet({
  conversationId,
  liveId,
  recipientUsername,
  onSent,
  triggerClassName,
}: {
  conversationId?: string;
  liveId?: string;
  recipientUsername?: string;
  onSent?: () => void;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<(typeof COIN_GIFTS)[number] | null>(null);
  const wallet = useQuery({
    queryKey: ["coin-wallet"],
    queryFn: () => getCoinWallet(),
    enabled: open,
  });
  const send = useMutation({
    mutationFn: () =>
      sendCoinGift({
        data: {
          giftKey: pick!.key,
          conversationId,
          liveId,
          recipientUsername,
        },
      }),
    onSuccess: () => {
      playNyxSound("gift");
      toast.message(`Sent ${pick?.name}.`);
      setPick(null);
      setOpen(false);
      onSent?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send gift."),
  });

  return (
    <>
      <button
        type="button"
        aria-label="Send a NYX gift"
        className={cn("kc-composer-icon", triggerClassName)}
        onClick={() => setOpen(true)}
      >
        <span className="kc-composer-icon-glyph">
          <Gift className="kc-composer-icon-svg" strokeWidth={1.75} />
        </span>
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-fg/40 p-3" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-surface p-4 shadow-border"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-medium">NYX Gifts</p>
            <p className="mt-1 text-sm text-muted">
              Balance {wallet.data?.balance ?? "—"} coins. Recipients receive 85% after the platform fee.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {COIN_GIFTS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  className={`rounded-xl border px-3 py-3 text-left ${pick?.key === g.key ? "border-accent bg-elevated" : "border-border"}`}
                  onClick={() => setPick(g)}
                >
                  <span className="text-lg">{g.label}</span>
                  <p className="mt-1 text-sm font-medium">{g.name}</p>
                  <p className="text-xs text-muted">{g.coins} coins</p>
                </button>
              ))}
            </div>
            {pick ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm">
                  Send {pick.name} for {pick.coins} NYX Coins?
                </p>
                <Button
                  className="w-full"
                  disabled={send.isPending}
                  onClick={() => send.mutate()}
                >
                  {send.isPending ? "Sending…" : `Send ${pick.name}`}
                </Button>
              </div>
            ) : null}
            <Button className="mt-3 w-full" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
