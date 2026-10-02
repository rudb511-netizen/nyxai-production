import { Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { applyMention, mentionAtCaret } from "@/lib/kchat/mention";
import { OMNI_AI_DISPLAY, OMNI_AI_USER_ID, OMNI_AI_USERNAME } from "@/lib/kchat/omni-ids";
import { globalSearch } from "@/lib/kchat/server/more";
import { cn } from "@/lib/utils";
import { NameMark } from "./verified-badge";

const OMNI_HINT = {
  userId: OMNI_AI_USER_ID,
  username: OMNI_AI_USERNAME,
  displayName: OMNI_AI_DISPLAY,
  avatarUrl: null as string | null,
  verifyKind: "org" as const,
  isArc: false,
};

/** One native textarea. Mentions are a suggestion list, never a second text layer. */
export function MentionBox({
  value,
  onChange,
  placeholder,
  maxLength,
  minHeightClass = "min-h-28",
  disabled,
  onSubmit,
  variant = "default",
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  minHeightClass?: string;
  disabled?: boolean;
  onSubmit?: () => void;
  variant?: "default" | "composer";
  className?: string;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const hintId = useId();
  const hit = mentionAtCaret(value, caret);
  const q = hit?.query ?? "";
  const people = useQuery({
    queryKey: ["mention-search", q],
    queryFn: () => globalSearch({ data: { q: q || "a" } }),
    enabled: open && q.length >= 1,
    staleTime: 8_000,
  });

  useEffect(() => {
    setOpen(Boolean(hit));
  }, [hit?.start, hit?.query]);

  function rememberCaret(el: HTMLTextAreaElement) {
    setCaret(el.selectionStart ?? value.length);
  }

  function pick(username: string) {
    const el = ta.current;
    const at = el?.selectionStart ?? caret;
    const next = applyMention(value, at, username);
    onChange(next.text);
    setOpen(false);
    requestAnimationFrame(() => {
      const node = ta.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  }

  const qlc = q.toLowerCase();
  const showOmni = !qlc || OMNI_AI_USERNAME.startsWith(qlc) || "omni".startsWith(qlc);
  const users = [
    ...(showOmni ? [OMNI_HINT] : []),
    ...(people.data?.users ?? []).filter((u) => u.username.toLowerCase() !== OMNI_AI_USERNAME),
  ].slice(0, 6);

  return (
    <div className={cn("relative min-w-0", className)}>
      <textarea
        ref={ta}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        rows={variant === "composer" ? 1 : 3}
        placeholder={placeholder}
        aria-label={placeholder || "Write"}
        aria-autocomplete="list"
        aria-controls={open ? hintId : undefined}
        className={cn(
          "w-full resize-none bg-transparent text-sm leading-relaxed text-fg outline-none placeholder:text-muted",
          variant === "composer"
            ? "max-h-32 overflow-y-auto px-1 py-2"
            : "rounded-xl border border-border bg-surface px-3.5 py-3",
          minHeightClass,
          disabled && "opacity-50",
        )}
        onChange={(e) => {
          onChange(e.target.value);
          rememberCaret(e.currentTarget);
        }}
        onKeyUp={(e) => rememberCaret(e.currentTarget)}
        onClick={(e) => rememberCaret(e.currentTarget)}
        onSelect={(e) => rememberCaret(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey) return;
          if (open && users.length > 0) {
            e.preventDefault();
            pick(users[0]!.username);
            return;
          }
          if (onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {open && users.length > 0 ? (
        <ul
          id={hintId}
          role="listbox"
          className="absolute bottom-full z-20 mb-1 max-h-56 w-full overflow-auto rounded-xl border border-border bg-surface shadow-(--shadow-border-hover)"
        >
          {users.map((u) => (
            <li key={u.userId} role="option">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-elevated"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(u.username);
                }}
              >
                {u.username === OMNI_AI_USERNAME ? (
                  <span className="grid size-8 place-items-center rounded-full bg-ai/15 text-ai">
                    <Sparkles className="size-4" />
                  </span>
                ) : (
                  <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                )}
                <div className="min-w-0">
                  <NameMark
                    name={u.displayName}
                    verifyKind={u.verifyKind}
                    isArc={u.isArc}
                    isPremium={"isPremium" in u ? Boolean((u as { isPremium?: boolean }).isPremium) : false}
                    className="text-sm font-medium"
                  />
                  <p className="text-xs text-muted">
                    @{u.username}
                    {u.username === OMNI_AI_USERNAME ? " · replies in this thread" : ""}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
