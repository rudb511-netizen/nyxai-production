import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmojiPicker } from "@/components/kchat/emoji-picker";
import { deleteMessage, editMessage, forwardMessage, listConversations, reactMessage, revokeViewOnce, starMessage } from "@/lib/kchat/server/messages";
import { pinThreadMessage } from "@/lib/kchat/server/comms";
import { translateText } from "@/lib/kchat/server/platform";
import type { ChatMessage } from "@/lib/kchat/types";
import { MediaActions } from "@/components/kchat/media-actions";

const QUICK = ["❤️", "😂", "👍", "😢", "😮", "😡", "🔥", "🙏"];

export function MessageMenu({
  message,
  mine,
  conversationId,
  onClose,
  onChanged,
  onReply,
  onSelect,
}: {
  message: ChatMessage;
  mine: boolean;
  conversationId: string;
  onClose: () => void;
  onChanged: () => void;
  onReply: () => void;
  onSelect?: () => void;
}) {
  const nav = useNavigate();
  const [mode, setMode] = useState<"root" | "react" | "edit" | "forward" | "delete">("root");
  const [edit, setEdit] = useState(message.body);
  const [picked, setPicked] = useState<string[]>([]);
  const [translated, setTranslated] = useState<string | null>(null);
  const convos = useQuery({
    queryKey: ["inbox"],
    queryFn: () => listConversations({ data: {} }),
    enabled: mode === "forward",
  });

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast.success(ok);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn’t work.");
    }
  }

  if (message.deleted) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
        <p className="text-muted">This message was deleted.</p>
        <Button className="mt-2" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  if (mode === "react") {
    return (
      <div className="space-y-2">
        <EmojiPicker
          onPick={(emoji) => void run(() => reactMessage({ data: { id: message.id, emoji } }))}
        />
        <Button size="sm" variant="ghost" onClick={() => setMode("root")}>
          Back
        </Button>
      </div>
    );
  }

  if (mode === "edit") {
    return (
      <form
        className="space-y-2 rounded-2xl border border-border bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => editMessage({ data: { id: message.id, body: edit } }), "Edited");
        }}
      >
        <Input
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          maxLength={4000}
          aria-label="Edit message"
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode("root")}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (mode === "forward") {
    return (
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-border bg-surface p-3">
        <p className="text-sm font-medium">Forward to</p>
        {(convos.data ?? []).map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={picked.includes(c.id)}
              onChange={(e) =>
                setPicked((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))
              }
            />
            <span className="truncate">{c.title}</span>
          </label>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            disabled={picked.length === 0}
            onClick={() =>
              void run(
                () => forwardMessage({ data: { id: message.id, conversationIds: picked } }),
                "Forwarded",
              )
            }
          >
            Send
          </Button>
          {message.mediaUrl && message.kind !== "voice" ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void run(async () => {
                    try {
                      sessionStorage.setItem("omni-create-tab", "story");
                      sessionStorage.setItem(
                        "omni-create-draft",
                        JSON.stringify({
                          body: message.body,
                          mediaUrl: message.mediaUrl,
                          kind: message.kind,
                        }),
                      );
                    } catch {
                      /* ignore */
                    }
                    nav({ to: "/create" });
                  }, "Opening story")
                }
              >
                My Story
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void run(async () => {
                    try {
                      sessionStorage.setItem("omni-create-tab", "status");
                      sessionStorage.setItem(
                        "omni-create-draft",
                        JSON.stringify({
                          body: message.body,
                          mediaUrl: message.mediaUrl,
                          kind: message.kind,
                        }),
                      );
                    } catch {
                      /* ignore */
                    }
                    nav({ to: "/create" });
                  }, "Opening status")
                }
              >
                My Status
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void run(async () => {
                  try {
                    sessionStorage.setItem("omni-create-tab", "status");
                    sessionStorage.setItem(
                      "omni-create-draft",
                      JSON.stringify({ body: message.body, mediaUrl: message.mediaUrl, kind: message.kind }),
                    );
                  } catch {
                    /* ignore */
                  }
                  nav({ to: "/create" });
                }, "Opening status")
              }
            >
              My Status
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setMode("root")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "delete") {
    return (
      <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
        <p className="text-sm font-medium">Delete message</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void run(() => deleteMessage({ data: { id: message.id, scope: "me" } }))}
        >
          Delete for me
        </Button>
        {mine ? (
          <Button
            size="sm"
            variant="danger"
            onClick={() => void run(() => deleteMessage({ data: { id: message.id, scope: "everyone" } }))}
          >
            Delete for everyone
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setMode("root")}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
      <div className="flex flex-wrap gap-1">
        {QUICK.map((e) => (
          <button
            key={e}
            type="button"
            className="grid size-9 place-items-center rounded-full bg-elevated text-lg"
            onClick={() => void run(() => reactMessage({ data: { id: message.id, emoji: e } }))}
          >
            {e}
          </button>
        ))}
        <button
          type="button"
          className="grid size-9 place-items-center rounded-full bg-elevated text-sm"
          onClick={() => setMode("react")}
        >
          +
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Button size="sm" variant="ghost" onClick={onReply}>
          Reply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run(() => starMessage({ data: { id: message.id } }), message.starred ? "Unstarred" : "Starred")}
        >
          {message.starred ? "Unstar" : "Star"}
        </Button>
        {message.viewOnce ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(message.body || "").then(() => toast.success("Copied"));
            }}
          >
            Copy
          </Button>
        )}
        {message.viewOnce ? (
          <p className="px-2 text-xs text-muted">View once media can’t be forwarded or saved.</p>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setMode("forward")}>
            Forward
          </Button>
        )}
        {mine && message.viewOnce && message.viewOnceState === "UNOPENED" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void run(() => revokeViewOnce({ data: { id: message.id } }), "Revoked")}
          >
            Revoke
          </Button>
        ) : null}
        {mine && message.kind === "text" ? (
          <Button size="sm" variant="ghost" onClick={() => setMode("edit")}>
            Edit
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void run(
              () =>
                pinThreadMessage({
                  data: { conversationId, messageId: message.id, pinned: !message.pinned },
                }),
            )
          }
        >
          {message.pinned ? "Unpin" : "Pin"}
        </Button>
        {message.body && !message.viewOnce ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void translateText({ data: { text: message.body } })
                .then((r) => setTranslated(r.text))
                .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't translate."))
            }
          >
            Translate
          </Button>
        ) : null}
        {message.mediaUrl && !message.viewOnce && (message.kind === "image" || message.kind === "video" || message.kind === "gif" || message.kind === "file") ? (
          <div className="px-1 py-1">
            <MediaActions
              url={message.mediaUrl}
              kind={message.kind === "video" ? "video" : message.kind === "file" ? "file" : "image"}
              fileName={message.body || undefined}
            />
          </div>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setMode("delete")}>
          Delete
        </Button>
        {onSelect ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onSelect();
              onClose();
            }}
          >
            Select
          </Button>
        ) : null}
      </div>
      {translated ? <p className="rounded-xl bg-elevated px-3 py-2 text-sm">{translated}</p> : null}
      <Button size="sm" variant="ghost" className="w-full" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
