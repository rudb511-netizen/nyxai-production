import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { createChallenge, listChallenges, submitChallenge } from "@/lib/kchat/server/platform";
import { myVideoAnalytics } from "@/lib/kchat/server/videos";

export const Route = createFileRoute("/_app/challenges")({ component: ChallengesPage });

function ChallengesPage() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["challenges"], queryFn: () => listChallenges() });
  const mine = useQuery({ queryKey: ["my-videos-boost"], queryFn: () => myVideoAnalytics() });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [rules, setRules] = useState("");
  const [hashtag, setHashtag] = useState("");
  const [pick, setPick] = useState<string | null>(null);

  return (
    <div className="kc-page px-4 py-5 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Challenges</h1>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          New
        </Button>
      </div>
      {open ? (
        <form
          className="space-y-3 rounded-2xl bg-elevated p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void createChallenge({ data: { title, rules, hashtag } })
              .then(() => {
                setOpen(false);
                void q.refetch();
              })
              .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Challenge name" required />
          <Input value={hashtag} onChange={(e) => setHashtag(e.target.value)} placeholder="hashtag" required />
          <Textarea value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Rules" />
          <Button type="submit" className="w-full">
            Launch
          </Button>
        </form>
      ) : null}
      <ul className="space-y-3">
        {(q.data ?? []).map((c) => (
          <li key={c.id} className="kc-card p-4">
            <p className="font-medium">{c.title}</p>
            <p className="text-sm text-accent">#{c.hashtag}</p>
            <p className="mt-1 text-sm text-muted">{c.rules}</p>
            <p className="mt-1 text-xs text-subtle">{c.entries} real submissions</p>
            {pick === c.id ? (
              <ul className="mt-3 space-y-2">
                {(mine.data ?? []).map((v) => (
                  <li key={v.id}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void submitChallenge({ data: { challengeId: c.id, videoId: v.id } })
                          .then(() => {
                            toast.success("Submitted");
                            setPick(null);
                            void q.refetch();
                          })
                          .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                      }
                    >
                      Submit “{v.caption || "Untitled"}”
                    </Button>
                  </li>
                ))}
                {(mine.data ?? []).length === 0 ? (
                  <Button size="sm" onClick={() => nav({ to: "/capture" })}>
                    Record a video first
                  </Button>
                ) : null}
              </ul>
            ) : (
              <Button className="mt-3" size="sm" onClick={() => setPick(c.id)}>
                Submit a video
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
