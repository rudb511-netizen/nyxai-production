import { useQuery } from "@tanstack/react-query";
import { CalendarClock, MapPin, Plus, UserRound, Vote } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FriendPicker } from "@/components/kchat/friend-picker";
import { listFriends } from "@/lib/kchat/server/social";
import { getCurrentPosition } from "@/utils/nativeCapabilities";
import type { ChatPollIn, ContactIn, LocationIn } from "@/lib/kchat/comms-extra";

export type AttachMode = "root" | "poll" | "location" | "contact" | "schedule";

export function ChatAttachSheet({
  silent,
  onSilent,
  onPoll,
  onLocation,
  onContact,
  onSchedule,
  onClose,
}: {
  silent: boolean;
  onSilent: (v: boolean) => void;
  onPoll: (poll: ChatPollIn) => void;
  onLocation: (loc: LocationIn) => void;
  onContact: (c: ContactIn) => void;
  onSchedule: (iso: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<AttachMode>("root");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [anon, setAnon] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [correct, setCorrect] = useState("o1");
  const [live, setLive] = useState(false);
  const [when, setWhen] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const friends = useQuery({ queryKey: ["friends"], queryFn: () => listFriends() });

  if (mode === "poll") {
    return (
      <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
        <p className="text-sm font-medium">Poll</p>
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question" maxLength={200} />
        {options.map((o, i) => (
          <Input
            key={i}
            value={o}
            onChange={(e) => setOptions((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={`Answer ${i + 1}`}
            maxLength={80}
          />
        ))}
        {options.length < 12 ? (
          <Button size="sm" variant="ghost" onClick={() => setOptions((cur) => [...cur, ""])}>
            <Plus className="mr-1 size-3.5" /> Add answer
          </Button>
        ) : null}
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
          Anonymous votes
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={quiz} onChange={(e) => setQuiz(e.target.checked)} />
          Quiz
        </label>
        {quiz ? (
          <select className="w-full rounded-xl border border-border bg-elevated px-3 py-2 text-sm" value={correct} onChange={(e) => setCorrect(e.target.value)}>
            {options.map((_, i) => (
              <option key={i} value={`o${i + 1}`}>
                Correct: answer {i + 1}
              </option>
            ))}
          </select>
        ) : null}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() =>
              onPoll({
                question,
                options: options.map((text, i) => ({ id: `o${i + 1}`, text })),
                anonymous: anon,
                quiz,
                correctOptionId: quiz ? correct : null,
              })
            }
          >
            Send poll
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("root")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "location") {
    return (
      <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
        <p className="text-sm font-medium">Location</p>
        <p className="text-xs text-muted">NYX only sends coordinates you approve. Live sharing updates while this chat stays open, then stops.</p>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live for 15 minutes
        </label>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              void getCurrentPosition().then((pos) => {
                if (!pos) {
                  toast.error("Location permission is needed to share.");
                  return;
                }
                onLocation({
                  lat: pos.lat,
                  lng: pos.lng,
                  accuracy: pos.accuracy,
                  liveMs: live ? 15 * 60 * 1000 : null,
                });
              });
            }}
          >
            Share
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("root")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "contact") {
    const selected = (friends.data ?? []).find((f) => picked.includes(f.userId));
    return (
      <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
        <p className="text-sm font-medium">Share a NYX profile</p>
        <FriendPicker selected={picked.slice(0, 1)} onChange={(ids) => setPicked(ids.slice(-1))} />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onContact({
                userId: selected.userId,
                username: selected.username,
                displayName: selected.displayName,
                avatarUrl: selected.avatarUrl,
              });
            }}
          >
            Send
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("root")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "schedule") {
    return (
      <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
        <p className="text-sm font-medium">Schedule</p>
        <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!when}
            onClick={() => {
              const iso = new Date(when).toISOString();
              onSchedule(iso);
            }}
          >
            Use this time
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("root")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-2xl border border-border bg-surface p-2">
      <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => setMode("poll")}>
        <Vote className="size-4" /> Poll
      </button>
      <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => setMode("location")}>
        <MapPin className="size-4" /> Location
      </button>
      <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => setMode("contact")}>
        <UserRound className="size-4" /> Contact
      </button>
      <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => setMode("schedule")}>
        <CalendarClock className="size-4" /> Schedule
      </button>
      <label className="flex min-h-11 items-center gap-2 px-3 text-sm">
        <input type="checkbox" checked={silent} onChange={(e) => onSilent(e.target.checked)} />
        Silent (no notification)
      </label>
      <Button size="sm" variant="ghost" className="w-full" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
