import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { OmniMarkdown } from "@/components/kchat/omni-markdown";
import { Wordmark } from "@/components/kchat/logo";
import { getSharedOmni } from "@/lib/kchat/server/omni";

export const Route = createFileRoute("/s/$id")({ component: SharedOmni });

function SharedOmni() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ["omni-share", id],
    queryFn: () => getSharedOmni({ data: { shareId: id } }),
  });
  if (q.isError) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-lg place-items-center p-6 text-center">
        <div>
          <Wordmark className="justify-center" />
          <p className="mt-6 text-sm text-muted">{(q.error as Error).message}</p>
          <Link to="/" className="mt-4 inline-block text-sm text-ai">
            Open NYX
          </Link>
        </div>
      </main>
    );
  }
  const data = q.data;
  return (
    <main className="mx-auto min-h-dvh max-w-lg bg-bg px-4 py-6">
      <Wordmark />
      <p className="mt-6 text-xs uppercase tracking-wide text-muted">Shared NYXAI chat</p>
      <h1 className="mt-1 text-xl font-semibold">{data?.title ?? "Loading…"}</h1>
      <div className="mt-6 space-y-3">
        {(data?.messages ?? []).map((m, i) => (
          <div
            key={`${m.created_at}-${i}`}
            className={m.role === "user" ? "ml-auto max-w-[92%] rounded-2xl bg-accent px-3.5 py-2.5 text-sm text-accent-fg whitespace-pre-wrap" : "max-w-[92%] rounded-2xl bg-elevated px-3.5 py-2.5"}
          >
            {m.role === "user" ? m.content : <OmniMarkdown text={m.content} />}
          </div>
        ))}
      </div>
      <Link to="/kai" className="mt-8 inline-block text-sm text-ai">
        Continue in NYXAI
      </Link>
    </main>
  );
}
