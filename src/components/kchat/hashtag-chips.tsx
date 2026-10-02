import { useState } from "react";
import { appendHashtag, removeHashtag, tagsFromText } from "@/lib/kchat/graph";
import { cn } from "@/lib/utils";

/** Local hashtag editor. Never calls NYXAI. */
export function HashtagChips({
  text,
  onText,
}: {
  text: string;
  onText: (next: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const tags = tagsFromText(text);

  function add() {
    const next = appendHashtag(text, draft);
    if (next !== text) onText(next.endsWith(" ") ? next : `${next} `);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Hashtags</p>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? <span className="text-xs text-subtle">None yet</span> : null}
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-elevated px-2.5 py-1 text-sm">
            #{tag}
            <button
              type="button"
              className="text-muted"
              aria-label={`Remove #${tag}`}
              onClick={() => onText(removeHashtag(text, tag))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a hashtag"
          aria-label="Add a hashtag"
          maxLength={30}
          className={cn(
            "min-w-0 flex-1 rounded-full border border-border bg-transparent px-3 py-2 text-sm outline-none",
          )}
        />
        <button type="submit" className="rounded-full bg-elevated px-3 py-2 text-sm">
          Add
        </button>
      </form>
    </div>
  );
}
