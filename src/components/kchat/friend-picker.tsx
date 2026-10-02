import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { listFriends } from "@/lib/kchat/server/social";
import { cn } from "@/lib/utils";
import { NameMark } from "./verified-badge";

export function FriendPicker({
  selected,
  onChange,
  label,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const friends = useQuery({ queryKey: ["friends"], queryFn: () => listFriends() });
  const [q, setQ] = useState("");
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (friends.data ?? []).filter((f) => {
      if (!needle) return true;
      return (
        f.displayName.toLowerCase().includes(needle) || f.username.toLowerCase().includes(needle)
      );
    });
  }, [friends.data, q]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div className="space-y-2">
      {label ? <p className="text-sm font-medium">{label}</p> : null}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search friends" />
      {selected.length > 0 ? (
        <p className="text-xs text-muted">{selected.length} selected</p>
      ) : null}
      <ul className="max-h-48 overflow-y-auto rounded-xl border border-border">
        {items.length === 0 ? (
          <li className="px-3 py-4 text-sm text-muted">No friends to pick yet.</li>
        ) : (
          items.map((f) => {
            const on = selected.includes(f.userId);
            return (
              <li key={f.userId}>
                <button
                  type="button"
                  onClick={() => toggle(f.userId)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left",
                    on ? "bg-elevated" : "hover:bg-elevated/60",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded-full border text-[10px]",
                      on ? "border-accent bg-accent text-accent-fg" : "border-border text-subtle",
                    )}
                    aria-hidden
                  >
                    {on ? "✓" : ""}
                  </span>
                  <Avatar src={f.avatarUrl} name={f.displayName} size="sm" />
                  <div className="min-w-0">
                    <NameMark name={f.displayName} verifyKind={f.verifyKind} isArc={f.isArc} isPremium={"isPremium" in f ? Boolean((f as { isPremium?: boolean }).isPremium) : false} className="text-sm" />
                    <p className="text-xs text-muted">@{f.username}</p>
                  </div>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
