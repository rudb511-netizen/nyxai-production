import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { profileCard } from "@/lib/kchat/server/platform";
import { formatCount } from "@/lib/utils";

export const Route = createFileRoute("/_app/card")({ component: CardPage });

function CardPage() {
  const card = useQuery({ queryKey: ["profile-card"], queryFn: () => profileCard() });
  const ref = useRef<HTMLDivElement>(null);
  const p = card.data;
  if (!p) return <p className="p-6 text-sm text-muted">Loading…</p>;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}${p.path}` : p.path;

  async function copy() {
    await navigator.clipboard.writeText(shareUrl);
    toast.success("Profile link copied");
  }

  async function download() {
    const profile = card.data;
    const el = ref.current;
    if (!el || !profile) return;
    const { width, height } = el.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * 2);
    canvas.height = Math.round(height * 2);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#10141c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#c8f04d";
    ctx.font = "bold 48px Outfit, sans-serif";
    ctx.fillText("NYX", 48, 80);
    ctx.fillStyle = "#f2f5f8";
    ctx.font = "bold 56px Outfit, sans-serif";
    ctx.fillText(profile.displayName, 48, 180);
    ctx.font = "32px Outfit, sans-serif";
    ctx.fillStyle = "#9aa3b2";
    ctx.fillText(`@${profile.username}`, 48, 230);
    ctx.fillText(`${formatCount(profile.followers)} followers · ${profile.score} score`, 48, 280);
    ctx.fillText(shareUrl, 48, canvas.height - 48);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `nyx-${profile.username}.png`;
    a.click();
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-xl font-semibold">NYX card</h1>
      <div ref={ref} className="rounded-3xl bg-elevated p-6">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">NYX</p>
        <p className="mt-4 text-2xl font-semibold">{p.displayName}</p>
        <p className="text-muted">@{p.username}</p>
        {p.bio ? <p className="mt-3 text-sm leading-relaxed">{p.bio}</p> : null}
        <p className="mt-4 text-sm tabular-nums">
          {formatCount(p.followers)} followers · {p.score} score
        </p>
        <p className="mt-6 break-all text-xs text-subtle">{shareUrl}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => void copy()}>Copy link</Button>
        <Button variant="secondary" onClick={() => void download()}>
          Download card
        </Button>
      </div>
    </div>
  );
}
