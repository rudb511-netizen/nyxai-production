import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { creatorStudio } from "@/lib/kchat/server/platform";
import { listBoosts } from "@/lib/kchat/server/coins";
import { formatCount } from "@/lib/utils";

export const Route = createFileRoute("/_app/studio")({ component: Studio });

function Studio() {
  const [range, setRange] = useState<"7" | "28" | "90">("7");
  const stats = useQuery({
    queryKey: ["studio", range],
    queryFn: () => creatorStudio({ data: { range } }),
  });
  const boosts = useQuery({ queryKey: ["coin-boosts"], queryFn: () => listBoosts() });
  const t = stats.data?.totals;
  return (
    <div className="kc-page space-y-6 px-4 py-5">
      <div>
        <h1 className="text-xl font-semibold">Creator Studio</h1>
        <p className="mt-1 text-sm text-muted">Real views, likes, comments, and watch time from your videos. Boosts only amplify distribution — they never invent engagement.</p>
      </div>
      <div className="flex gap-2">
        {(["7", "28", "90"] as const).map((r) => (
          <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)}>
            {r} days
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Views" value={t?.views} />
        <Stat label="Likes" value={t?.likes} />
        <Stat label="Comments" value={t?.comments} />
        <Stat label="Watch time" value={t ? `${Math.round(t.watchMs / 1000)}s` : undefined} />
        <Stat label="Followers gained" value={t?.followersGained} />
        <Stat label="Gift coins" value={t?.giftCoins} />
      </div>
      <ul className="space-y-2">
        {(stats.data?.videos ?? []).map((v) => (
          <li key={v.id} className="kc-card p-3 text-sm">
            <Link to="/watch" search={{ v: v.id }} className="font-medium">
              {v.caption || "Untitled"}
            </Link>
            <p className="mt-1 text-xs text-muted tabular-nums">
              {formatCount(v.views)} views · {formatCount(v.likes)} likes · {formatCount(v.comments)} comments · {formatCount(v.shares)} shares
            </p>
          </li>
        ))}
      </ul>
      {(boosts.data ?? []).length > 0 ? (
        <section>
          <h2 className="text-sm font-medium text-muted">Active boosts</h2>
          <ul className="mt-2 space-y-2">
            {(boosts.data ?? []).map((b) => (
              <li key={b.id} className="text-sm text-muted">
                {b.label} · {b.status} · {b.impressions} impressions from real viewers
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number | string }) {
  return (
    <div className="rounded-2xl bg-elevated p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value ?? "—"}</p>
    </div>
  );
}
