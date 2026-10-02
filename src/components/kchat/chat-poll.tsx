import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { closeChatPoll, getChatPoll, voteChatPoll } from "@/lib/kchat/server/comms";
import { cn } from "@/lib/utils";

export function ChatPollBubble({
  pollId,
  mine,
  onChanged,
}: {
  pollId: string;
  mine: boolean;
  onChanged: () => void;
}) {
  const q = useQuery({
    queryKey: ["chat-poll", pollId],
    queryFn: () => getChatPoll({ data: { pollId } }),
    refetchInterval: 2500,
  });
  const poll = q.data;
  if (!poll) return <p className="text-sm">Poll</p>;
  const max = Math.max(1, ...poll.options.map((o) => o.votes));

  return (
    <div className="min-w-[12rem] space-y-2">
      <p className="font-medium">{poll.question}</p>
      {poll.options.map((o) => {
        const picked = poll.myVotes.includes(o.id);
        const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
        return (
          <button
            key={o.id}
            type="button"
            disabled={poll.closed}
            className={cn(
              "relative w-full overflow-hidden rounded-xl px-3 py-2 text-left text-sm",
              picked ? "bg-accent/20" : "bg-black/10",
            )}
            onClick={() =>
              void voteChatPoll({ data: { pollId, optionId: o.id } }).then(() => {
                void q.refetch();
                onChanged();
              })
            }
          >
            <span
              className="absolute inset-y-0 left-0 bg-accent/25"
              style={{ width: `${poll.myVotes.length || poll.closed ? (o.votes / max) * 100 : 0}%` }}
            />
            <span className="relative flex items-center justify-between gap-2">
              <span>
                {o.text}
                {poll.correctOptionId === o.id ? " · correct" : ""}
              </span>
              <span className="tabular-nums text-xs opacity-80">{pct}%</span>
            </span>
          </button>
        );
      })}
      <p className="text-[11px] opacity-70">
        {poll.total} vote{poll.total === 1 ? "" : "s"}
        {poll.anonymous ? " · anonymous" : ""}
        {poll.closed ? " · closed" : ""}
        {poll.quiz ? " · quiz" : ""}
      </p>
      {mine && !poll.closed ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void closeChatPoll({ data: { pollId } }).then(() => q.refetch())}
        >
          Close poll
        </Button>
      ) : null}
    </div>
  );
}
