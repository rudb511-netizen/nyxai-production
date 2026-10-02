import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmojiPicker } from "@/components/kchat/emoji-picker";
import { listStories, reactStory, replyStory, storyViewers, viewStory } from "@/lib/kchat/server/stories";
import { useMeQuery } from "@/lib/kchat/hooks";

export const Route = createFileRoute("/_app/story/$id")({ component: StoryViewer });

function StoryViewer() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const me = useMeQuery();
  const q = useQuery({ queryKey: ["stories"], queryFn: () => listStories() });
  const stories = q.data ?? [];
  const idx = Math.max(0, stories.findIndex((s) => s.id === id));
  const story = stories[idx];
  const mine = Boolean(story && me.data?.userId === story.author.userId);
  const viewers = useQuery({
    queryKey: ["story-viewers", story?.id],
    enabled: Boolean(story && mine),
    queryFn: () => storyViewers({ data: { id: story!.id } }),
  });
  const [text, setText] = useState("");
  const [hold, setHold] = useState(false);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    if (story) void viewStory({ data: { id: story.id } });
  }, [story?.id]);

  useEffect(() => {
    if (!story || hold || picker) return;
    if (story.mediaKind === "video") return;
    const t = setTimeout(() => {
      const next = stories[idx + 1];
      if (next) nav({ to: "/story/$id", params: { id: next.id } });
      else nav({ to: "/" });
    }, 5000);
    return () => clearTimeout(t);
  }, [story?.id, hold, picker, idx, stories, nav]);

  if (!story) return <p className="p-6 text-sm text-muted">Story expired.</p>;

  return (
    <div
      className="flex min-h-dvh flex-col bg-black text-white"
      onPointerDown={() => setHold(true)}
      onPointerUp={() => setHold(false)}
    >
      <div className="flex gap-1 px-3 pt-3">
        {stories.map((s, i) => (
          <div key={s.id} className="h-0.5 flex-1 rounded-full bg-white/30">
            <div className={`h-full rounded-full ${i <= idx ? "bg-white" : ""}`} />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="px-4 py-3 text-left text-sm"
        onClick={() => nav({ to: "/u/$username", params: { username: story.author.username } })}
      >
        @{story.author.username}
        {mine && story.viewerCount ? ` · ${story.viewerCount} view${story.viewerCount === 1 ? "" : "s"}` : ""}
      </button>
      <div
        className="flex flex-1 items-center justify-center px-4"
        style={{ background: story.background ?? "#111" }}
        onClick={(e) => {
          const x = e.clientX;
          const w = window.innerWidth;
          if (x < w / 3 && idx > 0) nav({ to: "/story/$id", params: { id: stories[idx - 1]!.id } });
          if (x > (w * 2) / 3 && stories[idx + 1]) {
            nav({ to: "/story/$id", params: { id: stories[idx + 1]!.id } });
          }
        }}
      >
        {story.mediaUrl && story.mediaKind === "photo" ? (
          <img src={story.mediaUrl} alt="" className="max-h-[70dvh] object-contain" />
        ) : story.mediaUrl && story.mediaKind === "video" ? (
          <video
            src={story.mediaUrl}
            autoPlay
            playsInline
            className="max-h-[70dvh]"
            onEnded={() => {
              if (hold || picker) return;
              const next = stories[idx + 1];
              if (next) nav({ to: "/story/$id", params: { id: next.id } });
              else nav({ to: "/" });
            }}
          />
        ) : (
          <p className="text-center text-2xl font-medium">{story.textBody}</p>
        )}
      </div>
      {picker ? (
        <div className="p-3">
          <EmojiPicker
            onPick={(emoji) => {
              void reactStory({ data: { id: story.id, emoji } })
                .then(() => {
                  toast.success("Reaction sent to their chat");
                  setPicker(false);
                })
                .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
            }}
          />
        </div>
      ) : null}
      <form
        className="flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void replyStory({ data: { id: story.id, body: text } })
            .then(() => {
              setText("");
              toast.success("Reply sent");
            })
            .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Reply"
          className="border-white/20 bg-white/10 text-white"
        />
        <Button type="button" variant="secondary" onClick={() => setPicker((v) => !v)}>
          React
        </Button>
        <Button type="submit">Send</Button>
        <Button type="button" variant="ghost" onClick={() => nav({ to: "/" })}>
          Close
        </Button>
      </form>
      {mine && (viewers.data ?? []).length > 0 ? (
        <p className="px-4 pb-4 text-xs text-white/70">
          Seen by {(viewers.data ?? []).map((v) => v.displayName).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
