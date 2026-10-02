import { createFileRoute, Link, Outlet, useChildMatches, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Bell,
  BellOff,
  Camera,
  Eye,
  FileText,
  Flame,
  Image as ImageIcon,
  Inbox,
  Mic,
  MoreVertical,
  Phone,
  Pin,
  Plus,
  Search,
  Sparkles,
  Star,
  Users,
  Video,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/kchat/empty";
import { StatusAvatar } from "@/components/kchat/status-avatar";
import { useLiveHostMap } from "@/components/kchat/use-live-hosts";
import { NameMark } from "@/components/kchat/verified-badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  archiveChat,
  createGroup,
  deleteInboxList,
  favoriteChat,
  inboxSearch,
  listConversations,
  listInboxLists,
  listStarredMessages,
  markUnread,
  muteChat,
  openDm,
  pinChat,
  saveInboxList,
} from "@/lib/kchat/server/messages";
import { callHistory, globalSearch, listCommunities, startCall } from "@/lib/kchat/server/more";
import { listFriends } from "@/lib/kchat/server/social";
import { listStatuses } from "@/lib/kchat/server/status";
import { groupStatusesByAuthor } from "@/lib/kchat/status-ring";
import type { ConversationPreview, VerifyKind } from "@/lib/kchat/types";
import { OMNI_SUPPORT_USER_ID } from "@/lib/kchat/omni-support-ids";
import { useMeQuery } from "@/lib/kchat/hooks";
import { muteChatFor } from "@/lib/kchat/server/comms";
import { MUTE_DURATIONS } from "@/lib/kchat/comms-extra";
import { cn, inboxTime, timeAgo } from "@/lib/utils";

export const Route = createFileRoute("/_app/inbox")({ component: InboxPage });

type Hub = "chats" | "updates" | "spaces" | "calls";
type Chip = "all" | "unread" | "favorites" | "groups" | "stories" | "best" | "new" | string;

const CHIP_LABEL: Record<string, string> = {
  all: "All",
  unread: "Unread",
  favorites: "Favorites",
  groups: "Groups",
  stories: "Stories",
  best: "Best friends",
  new: "New",
};

function InboxPage() {
  const child = useChildMatches();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [compose, setCompose] = useState<null | "dm" | "group" | "channel">(null);
  const [hub, setHub] = useState<Hub>("chats");
  const [chip, setChip] = useState<Chip>("all");
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const [rowMenu, setRowMenu] = useState<ConversationPreview | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [starredOpen, setStarredOpen] = useState(false);
  const [listEditor, setListEditor] = useState(false);
  const [listTitle, setListTitle] = useState("");
  const [listPicked, setListPicked] = useState<string[]>([]);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const me = useMeQuery();

  const chats = useQuery({
    queryKey: ["inbox"],
    queryFn: () => listConversations({ data: {} }),
    refetchInterval: 4000,
    enabled: hub === "chats" && !archivedOpen,
  });
  const archived = useQuery({
    queryKey: ["inbox-archived"],
    queryFn: () => listConversations({ data: { archived: true } }),
    refetchInterval: 12_000,
    enabled: hub === "chats",
  });
  const lists = useQuery({
    queryKey: ["inbox-lists"],
    queryFn: () => listInboxLists(),
    enabled: hub === "chats",
  });
  const calls = useQuery({
    queryKey: ["call-history"],
    queryFn: () => callHistory(),
    refetchInterval: 8000,
    enabled: hub === "calls",
  });
  const statuses = useQuery({
    queryKey: ["statuses"],
    queryFn: () => listStatuses(),
    enabled: hub === "updates",
  });
  const spaces = useQuery({
    queryKey: ["communities"],
    queryFn: () => listCommunities(),
    enabled: hub === "spaces",
  });
  const people = useQuery({
    queryKey: ["search", q],
    queryFn: () => globalSearch({ data: { q } }),
    enabled: q.trim().length > 0,
  });
  const msgHits = useQuery({
    queryKey: ["inbox-search", q],
    queryFn: () => inboxSearch({ data: { q } }),
    enabled: q.trim().length > 1,
  });
  const starred = useQuery({
    queryKey: ["starred-messages"],
    queryFn: () => listStarredMessages(),
    enabled: starredOpen,
  });

  const items = chats.data ?? [];
  const custom = (lists.data ?? []).find((l) => l.id === chip);
  const filtered = useMemo(() => {
    let rows = archivedOpen ? (archived.data ?? []) : items;
    if (chip === "unread") rows = rows.filter((c) => c.unread > 0);
    else if (chip === "favorites") rows = rows.filter((c) => c.favorite);
    else if (chip === "groups") rows = rows.filter((c) => c.kind === "group");
    else if (chip === "stories") rows = rows.filter((c) => Boolean(c.statusId));
    else if (chip === "best") rows = rows.filter((c) => (c.streak?.count ?? 0) > 0);
    else if (chip === "new") {
      const cutoff = Date.now() - 86_400_000;
      rows = rows.filter((c) => c.unread > 0 || (c.lastAt && new Date(c.lastAt).getTime() >= cutoff));
    } else if (custom?.conversationIds?.length)
      rows = rows.filter((c) => custom.conversationIds.includes(c.id));
    return rows;
  }, [archivedOpen, archived.data, items, chip, custom]);

  const pinned = filtered.filter((c) => c.pinned);
  const rest = filtered.filter((c) => !c.pinned);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast.success(ok);
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["inbox-unread"] });
      void qc.invalidateQueries({ queryKey: ["inbox-archived"] });
      setRowMenu(null);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "That didn’t work.");
    }
  }

  return (
    <div className={cn(child.length > 0 ? "kc-inbox-split" : "relative h-full min-h-0")}>
      <div className={cn(child.length > 0 ? "kc-inbox-list-pane" : undefined)}>
      <header className="flex h-14 items-center gap-2 px-3">
        <Link to="/me" className="shrink-0" aria-label="Your profile">
          <Avatar src={me.data?.avatarUrl} name={me.data?.displayName ?? "You"} size="sm" />
        </Link>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">NYX</h1>
        <Link
          to="/alerts"
          className="grid size-11 place-items-center rounded-full text-fg hover:bg-elevated"
          aria-label="Notifications"
        >
          <Bell className="size-5" />
        </Link>
        <Link
          to="/capture"
          className="grid size-11 place-items-center rounded-full text-fg hover:bg-elevated"
          aria-label="Camera"
        >
          <Camera className="size-5" />
        </Link>
        <button
          type="button"
          className="grid size-11 place-items-center rounded-full text-fg hover:bg-elevated"
          aria-label="Chat menu"
          onClick={() => setMenu((v) => !v)}
        >
          <MoreVertical className="size-5" />
        </button>
      </header>

      {menu ? (
        <div className="absolute right-3 top-14 z-40 w-56 overflow-hidden rounded-2xl border border-border bg-surface shadow-(--shadow-border-hover)">
          {[
            ["New chat", () => { setCompose("dm"); setMenu(false); }],
            ["New group", () => { setCompose("group"); setMenu(false); }],
            ["New channel", () => { setCompose("channel"); setMenu(false); }],
            ["NYX Support", () => {
              setMenu(false);
              void openDm({ data: { username: "nyxsupport" } })
                .then((r) => nav({ to: "/inbox/$id", params: { id: r.id } }))
                .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't open NYX Support."));
            }],
            ["Starred", () => { setStarredOpen(true); setMenu(false); }],
            ["Archived", () => { setArchivedOpen(true); setHub("chats"); setMenu(false); }],
            ["NYXAI", () => nav({ to: "/kai" })],
            ["Linked devices", () => { setDevicesOpen(true); setMenu(false); }],
            ["Settings", () => nav({ to: "/settings" })],
          ].map(([label, fn]) => (
            <button
              key={String(label)}
              type="button"
              className="block w-full px-4 py-2.5 text-left text-sm hover:bg-elevated"
              onClick={fn as () => void}
            >
              {label as string}
            </button>
          ))}
        </div>
      ) : null}

      <div className="px-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask NYXAI or Search"
            className="h-11 rounded-full border-0 bg-elevated pl-10"
          />
        </div>
      </div>

      {q.trim() ? (
        <SearchPanel
          q={q}
          people={people.data?.users ?? []}
          messages={msgHits.data?.messages ?? []}
          posts={people.data?.posts ?? []}
          videos={people.data?.videos ?? []}
          communities={people.data?.communities ?? []}
          channels={people.data?.channels ?? []}
          chats={items.filter((c) =>
            (c.title ?? "").toLowerCase().includes(q.trim().toLowerCase()),
          )}
          onAsk={() => {
            try {
              sessionStorage.setItem("omni-ask", q.trim());
            } catch {
              /* ignore */
            }
            nav({ to: "/kai" });
          }}
          onOpenChat={(id) => nav({ to: "/inbox/$id", params: { id } })}
          onOpenUser={(username) =>
            void openDm({ data: { username } }).then((r) => nav({ to: "/inbox/$id", params: { id: r.id } }))
          }
          onOpenChannel={(username) => nav({ to: "/c/$username", params: { username } })}
        />
      ) : (
        <>
          <div className="mt-3 flex gap-1 px-3">
            {([
              ["chats", "Chats"],
              ["updates", "Updates"],
              ["spaces", "Spaces"],
              ["calls", "Calls"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setHub(id);
                  setArchivedOpen(false);
                }}
                className={cn(
                  "flex-1 rounded-full py-1.5 text-sm font-medium",
                  hub === id ? "bg-atlas/20 text-fg" : "text-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {hub === "chats" ? (
            <>
              <div className="kc-hide-scrollbar mt-3 flex gap-2 overflow-x-auto px-3">
                {(["all", "unread", "favorites", "groups", "stories", "best", "new"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={chip === id}
                    className="kc-chip"
                    onClick={() => setChip(id)}
                  >
                    {CHIP_LABEL[id]}
                  </button>
                ))}
                {(lists.data ?? []).map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={chip === l.id}
                    className="kc-chip"
                    onClick={() => setChip(l.id)}
                  >
                    {l.title}
                  </button>
                ))}
                <button
                  type="button"
                  className="kc-chip grid size-9 place-items-center !px-0"
                  aria-label="New list"
                  onClick={() => setListEditor(true)}
                >
                  <Plus className="size-4" />
                </button>
              </div>

              {compose ? (
                <div className="px-3 pt-3">
                  <Compose
                    mode={compose}
                    onClose={() => setCompose(null)}
                    onOpen={(id) => {
                      setCompose(null);
                      nav({ to: "/inbox/$id", params: { id } });
                    }}
                  />
                </div>
              ) : null}

              {listEditor ? (
                <ListEditor
                  chats={items}
                  title={listTitle}
                  picked={listPicked}
                  onTitle={setListTitle}
                  onToggle={(id) =>
                    setListPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
                  }
                  onClose={() => {
                    setListEditor(false);
                    setListTitle("");
                    setListPicked([]);
                  }}
                  onSave={() =>
                    void saveInboxList({ data: { title: listTitle, conversationIds: listPicked } })
                      .then(() => {
                        toast.success("List saved");
                        setListEditor(false);
                        setListTitle("");
                        setListPicked([]);
                        void lists.refetch();
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not save list."))
                  }
                />
              ) : null}

              {starredOpen ? (
                <StarredSheet
                  items={starred.data ?? []}
                  onClose={() => setStarredOpen(false)}
                  onOpen={(id) => nav({ to: "/inbox/$id", params: { id } })}
                />
              ) : null}

              {!archivedOpen && (archived.data ?? []).length > 0 ? (
                <button
                  type="button"
                  className="mt-2 flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-elevated"
                  onClick={() => setArchivedOpen(true)}
                >
                  <span className="grid size-12 place-items-center rounded-full bg-elevated text-muted">
                    <Archive className="size-5" />
                  </span>
                  <span className="flex-1 font-medium">Archived</span>
                  <span className="text-sm text-atlas tabular-nums">{archived.data!.length}</span>
                </button>
              ) : null}

              {archivedOpen ? (
                <div className="flex items-center justify-between px-4 py-2">
                  <p className="text-sm font-medium">Archived</p>
                  <Button size="sm" variant="ghost" onClick={() => setArchivedOpen(false)}>
                    Back
                  </Button>
                </div>
              ) : null}

              {filtered.length === 0 && !compose ? (
                <EmptyState
                  icon={Inbox}
                  title={archivedOpen ? "Nothing archived" : "No conversations yet"}
                  body="Tap the new-chat button to message someone, or start a group."
                />
              ) : (
                <ul>
                  {pinned.length > 0 ? (
                    <li className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-subtle">
                      Pinned
                    </li>
                  ) : null}
                  {pinned.map((c) => (
                    <ChatRow
                      key={c.id}
                      chat={c}
                      onOpen={() => nav({ to: "/inbox/$id", params: { id: c.id } })}
                      onMenu={() => setRowMenu(c)}
                    />
                  ))}
                  {rest.map((c) => (
                    <ChatRow
                      key={c.id}
                      chat={c}
                      onOpen={() => nav({ to: "/inbox/$id", params: { id: c.id } })}
                      onMenu={() => setRowMenu(c)}
                    />
                  ))}
                </ul>
              )}

              {custom && chip === custom.id ? (
                <div className="px-4 py-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void deleteInboxList({ data: { id: custom.id } }).then(() => {
                        setChip("all");
                        void lists.refetch();
                      })
                    }
                  >
                    Delete “{custom.title}”
                  </Button>
                </div>
              ) : null}

              <button
                type="button"
                className="fixed bottom-24 right-4 z-20 grid size-14 place-items-center rounded-2xl bg-atlas text-bg shadow-(--shadow-border-hover)"
                aria-label="New chat"
                onClick={() => setCompose("dm")}
              >
                <Plus className="size-6" />
              </button>
            </>
          ) : null}

          {hub === "updates" ? <UpdatesPane items={statuses.data ?? []} /> : null}
          {hub === "spaces" ? (
            <ul className="mt-3 px-3">
              {(spaces.data ?? []).map((c) => (
                <li key={c.id}>
                  <Link
                    to="/communities/$id"
                    params={{ id: c.id }}
                    className="flex items-center gap-3 rounded-2xl px-2 py-3 hover:bg-elevated"
                  >
                    <span className="grid size-12 place-items-center rounded-full bg-elevated text-atlas">
                      <Users className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-sm text-muted">
                        {c.kind} · {c.memberCount} members
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
              <li className="px-2 py-3">
                <Button variant="secondary" size="sm" onClick={() => nav({ to: "/communities" })}>
                  Open Spaces
                </Button>
              </li>
            </ul>
          ) : null}

          {hub === "calls" ? (
            <CallHistory
              items={calls.data ?? []}
              loading={calls.isLoading}
              onCall={async (usernames, kind) => {
                try {
                  const r = await startCall({ data: { usernames, kind } });
                  nav({ to: "/call/$id", params: { id: r.id } });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not place the call.");
                }
              }}
            />
          ) : null}
        </>
      )}

      {rowMenu ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-fg/30 p-3" onClick={() => setRowMenu(null)}>
          <div
            className="kc-sheet w-full overflow-hidden rounded-2xl bg-surface p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-3 py-2 text-sm font-medium">{rowMenu.title}</p>
            <SheetBtn
              label={rowMenu.pinned ? "Unpin" : "Pin"}
              onClick={() => void run(() => pinChat({ data: { conversationId: rowMenu.id, pinned: !rowMenu.pinned } }))}
            />
            <SheetBtn
              label={rowMenu.favorite ? "Remove from favorites" : "Favorite"}
              onClick={() =>
                void run(() => favoriteChat({ data: { conversationId: rowMenu.id, favorite: !rowMenu.favorite } }))
              }
            />
            <SheetBtn
              label={rowMenu.muted ? "Unmute" : "Mute"}
              onClick={() => void run(() => muteChat({ data: { conversationId: rowMenu.id, muted: !rowMenu.muted } }))}
            />
            {!rowMenu.muted
              ? MUTE_DURATIONS.map((d) => (
                  <SheetBtn
                    key={d.id}
                    label={`Mute · ${d.label}`}
                    onClick={() => void run(() => muteChatFor({ data: { conversationId: rowMenu.id, duration: d.id } }))}
                  />
                ))
              : null}
            <SheetBtn
              label={rowMenu.archived ? "Unarchive" : "Archive"}
              onClick={() =>
                void run(() => archiveChat({ data: { conversationId: rowMenu.id, archived: !rowMenu.archived } }), "Updated")
              }
            />
            <SheetBtn label="Mark unread" onClick={() => void run(() => markUnread({ data: { conversationId: rowMenu.id } }))} />
            <SheetBtn label="Cancel" onClick={() => setRowMenu(null)} />
          </div>
        </div>
      ) : null}

      {devicesOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-fg/30 p-3" onClick={() => setDevicesOpen(false)}>
          <div
            className="kc-sheet w-full overflow-hidden rounded-2xl bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium">Linked devices</p>
            <p className="mt-2 text-sm text-muted">
              Phone pairing isn’t available in this web app. Stay signed in on this browser — your chats stay on this
              account. There is no companion desktop session to scan a QR for.
            </p>
            <Button className="mt-3 w-full" variant="secondary" onClick={() => setDevicesOpen(false)}>
              Got it
            </Button>
          </div>
        </div>
      ) : null}
      </div>
      {child.length > 0 ? (
        <div className="kc-inbox-thread-pane">
          <Outlet />
        </div>
      ) : null}
    </div>
  );
}

function SheetBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="block w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-elevated" onClick={onClick}>
      {label}
    </button>
  );
}

function ChatRow({
  chat,
  onOpen,
  onMenu,
}: {
  chat: ConversationPreview;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const hold = useRef<number | null>(null);
  const liveHosts = useLiveHostMap();
  const liveId = chat.other?.userId ? liveHosts.get(chat.other.userId) : null;

  return (
    <li className="kc-row">
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3",
          chat.unread > 0 ? "bg-elevated/60" : "hover:bg-elevated/40",
          (chat.other?.userId === OMNI_SUPPORT_USER_ID ||
            chat.other?.username === "omnisupport" ||
            chat.other?.username === "nyxsupport" ||
            chat.title === "NYX Support") &&
            "kc-support-row",
        )}
        onTouchStart={(e) => {
          const t = e.changedTouches[0];
          start.current = { x: t!.clientX, y: t!.clientY };
          hold.current = window.setTimeout(() => {
            hold.current = null;
            onMenu();
          }, 480);
        }}
        onTouchMove={(e) => {
          const t = e.changedTouches[0];
          if (!start.current || !t) return;
          if (Math.abs(t.clientX - start.current.x) > 12 || Math.abs(t.clientY - start.current.y) > 12) {
            if (hold.current) window.clearTimeout(hold.current);
            hold.current = null;
          }
        }}
        onTouchEnd={(e) => {
          if (hold.current) window.clearTimeout(hold.current);
          hold.current = null;
          const t = e.changedTouches[0];
          if (start.current && t && t.clientX - start.current.x < -72 && Math.abs(t.clientY - start.current.y) < 40) {
            onMenu();
          }
        }}
      >
        <StatusAvatar
          src={chat.imageUrl}
          name={chat.title}
          statusId={chat.statusId}
          seen={chat.statusSeen}
          online={chat.online}
          liveId={liveId}
          onOpenChat={onOpen}
        />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen} onContextMenu={(e) => { e.preventDefault(); onMenu(); }}>
          <div className="flex items-center gap-1.5">
            {chat.pinned ? <Pin className="size-3 text-subtle" /> : null}
            <NameMark
              name={chat.title}
              verifyKind={chat.other?.verifyKind}
              isArc={chat.other?.isArc}
              isPremium={chat.other?.isPremium}
              className={cn("min-w-0 truncate text-[15px]", chat.unread > 0 ? "font-semibold" : "font-medium")}
            />
            {chat.kind === "group" ? <Users className="size-3 text-atlas" /> : null}
            {chat.streak && chat.streak.count > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-streak tabular-nums">
                <Flame className="size-3" />
                {chat.streak.count}
              </span>
            ) : null}
            {chat.muted ? <BellOff className="size-3 text-subtle" /> : null}
            <span className={cn("ml-auto shrink-0 text-[11px] tabular-nums", chat.unread > 0 ? "font-medium text-accent" : "text-subtle")}>
              {inboxTime(chat.lastAt)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <LastPreview chat={chat} />
            {chat.unread > 0 ? <span className="kc-unread ml-auto">{chat.unread > 99 ? "99+" : chat.unread}</span> : null}
          </div>
        </button>
      </div>
    </li>
  );
}

function LastPreview({ chat }: { chat: ConversationPreview }) {
  if (chat.draft) {
    return (
      <p className="flex min-w-0 flex-1 items-center gap-1 truncate text-[13px] text-accent">
        <span className="truncate">Draft: {chat.draft}</span>
      </p>
    );
  }
  const kind = chat.lastKind ?? "";
  const Icon =
    kind === "voice"
      ? Mic
      : kind === "image" || kind === "photo"
        ? ImageIcon
        : kind === "video"
          ? Video
          : kind === "view_once"
            ? Eye
            : kind === "file"
              ? FileText
              : null;
  return (
    <p className={cn("flex min-w-0 flex-1 items-center gap-1 truncate text-[13px]", chat.unread > 0 ? "text-fg" : "text-muted")}>
      {Icon ? <Icon className="size-3.5 shrink-0 opacity-80" /> : null}
      <span className="truncate">{chat.lastBody || "No messages yet"}</span>
    </p>
  );
}

function SearchPanel({
  q,
  people,
  messages,
  posts,
  videos,
  communities,
  channels,
  chats,
  onAsk,
  onOpenChat,
  onOpenUser,
  onOpenChannel,
}: {
  q: string;
  people: { username: string; displayName: string; avatarUrl: string | null; verifyKind?: VerifyKind; isArc?: boolean }[];
  messages: { id: string; conversationId: string; body: string; createdAt: string; title: string }[];
  posts: { id: string; body: string }[];
  videos: { id: string; caption: string }[];
  communities: { id: string; name: string; slug: string; kind: string; member_count: number }[];
  channels: { id: string; title: string; username: string; imageUrl: string | null }[];
  chats: ConversationPreview[];
  onAsk: () => void;
  onOpenChat: (id: string) => void;
  onOpenUser: (username: string) => void;
  onOpenChannel: (username: string) => void;
}) {
  return (
    <div className="mt-3 space-y-4 px-3 pb-8">
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-2xl bg-ai/10 px-3 py-3 text-left ring-1 ring-ai/30"
        onClick={onAsk}
      >
        <span className="grid size-10 place-items-center rounded-full bg-ai text-bg">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-medium">Ask NYXAI</p>
          <p className="truncate text-sm text-muted">{q}</p>
        </div>
      </button>
      {chats.length > 0 ? (
        <section>
          <h2 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-subtle">Chats</h2>
          {chats.map((c) => (
            <button
              key={c.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-elevated"
              onClick={() => onOpenChat(c.id)}
            >
              <Avatar src={c.imageUrl} name={c.title} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-medium">{c.title}</p>
                <p className="truncate text-sm text-muted">{c.lastBody || (c.kind === "group" ? "Group" : "Chat")}</p>
              </div>
            </button>
          ))}
        </section>
      ) : null}
      {channels.length > 0 ? (
        <section>
          <h2 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-subtle">Channels</h2>
          {channels.map((c) => (
            <button
              key={c.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-elevated"
              onClick={() => onOpenChannel(c.username)}
            >
              <Avatar src={c.imageUrl} name={c.title} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-medium">{c.title}</p>
                <p className="truncate text-sm text-muted">@{c.username}</p>
              </div>
            </button>
          ))}
        </section>
      ) : null}
      {people.length > 0 ? (
        <section>
          <h2 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-subtle">People</h2>
          {people.map((u) => (
            <button
              key={u.username}
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-elevated"
              onClick={() => onOpenUser(u.username)}
            >
              <Avatar src={u.avatarUrl} name={u.displayName} />
              <div className="min-w-0">
                <NameMark name={u.displayName} verifyKind={u.verifyKind} isArc={u.isArc} isPremium={"isPremium" in u ? Boolean((u as { isPremium?: boolean }).isPremium) : false} className="font-medium" />
                <p className="text-sm text-muted">@{u.username}</p>
              </div>
            </button>
          ))}
        </section>
      ) : null}
      {messages.length > 0 ? (
        <section>
          <h2 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-subtle">Messages</h2>
          {messages.map((m) => (
            <button
              key={m.id}
              type="button"
              className="block w-full rounded-xl px-1 py-2 text-left hover:bg-elevated"
              onClick={() => onOpenChat(m.conversationId)}
            >
              <p className="truncate text-sm font-medium">{m.title}</p>
              <p className="truncate text-sm text-muted">{m.body}</p>
            </button>
          ))}
        </section>
      ) : null}
      {communities.length > 0 ? (
        <section>
          <h2 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-subtle">Spaces</h2>
          {communities.map((c) => (
            <Link
              key={c.id}
              to="/communities/$id"
              params={{ id: c.id }}
              className="block rounded-xl px-1 py-2 hover:bg-elevated"
            >
              <p className="truncate text-sm font-medium">{c.name}</p>
              <p className="text-sm text-muted">
                {c.kind} · {c.member_count} members
              </p>
            </Link>
          ))}
        </section>
      ) : null}
      {posts.length > 0 ? (
        <section>
          <h2 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-subtle">Posts</h2>
          {posts.map((p) => (
            <Link key={p.id} to="/p/$id" params={{ id: p.id }} className="block rounded-xl px-1 py-2 hover:bg-elevated">
              <p className="truncate text-sm">{p.body}</p>
            </Link>
          ))}
        </section>
      ) : null}
      {videos.length > 0 ? (
        <section>
          <h2 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-subtle">Watch</h2>
          {videos.map((v) => (
            <Link key={v.id} to="/watch" className="block rounded-xl px-1 py-2 hover:bg-elevated">
              <p className="truncate text-sm">{v.caption || "Video"}</p>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function UpdatesPane({ items }: { items: Awaited<ReturnType<typeof listStatuses>> }) {
  const nav = useNavigate();
  const rings = groupStatusesByAuthor(items);
  const liveHosts = useLiveHostMap();
  return (
    <div className="mt-3 px-3">
      <button
        type="button"
        className="mb-3 flex w-full items-center gap-3 rounded-2xl bg-elevated px-3 py-3 text-left"
        onClick={() => {
          try {
            sessionStorage.setItem("omni-create-tab", "status");
          } catch {
            /* ignore */
          }
          nav({ to: "/create" });
        }}
      >
        <span className="grid size-12 place-items-center rounded-full border border-dashed border-atlas text-atlas">
          <Plus className="size-5" />
        </span>
        <div>
          <p className="font-medium">My status</p>
          <p className="text-sm text-muted">Photo, video, or text · 24 hours</p>
        </div>
      </button>
      <ul>
        {rings.map((ring) => (
          <li key={ring.author.userId}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-elevated"
              onClick={() => {
                const first = ring.items.find((s) => !s.seen) ?? ring.items[0];
                if (first) nav({ to: "/status/$id", params: { id: first.id } });
              }}
            >
              <StatusAvatar
                src={ring.author.avatarUrl}
                name={ring.author.displayName}
                segments={ring.items.map((s) => ({ id: s.id, seen: s.seen }))}
                liveId={liveHosts.get(ring.author.userId)}
              />
              <div className="min-w-0">
                <p className="font-medium">{ring.author.displayName}</p>
                <p className="text-sm text-muted">
                  {ring.items.length} update{ring.items.length === 1 ? "" : "s"}
                  {ring.unviewed ? ` · ${ring.unviewed} new` : " · viewed"}
                  {" · "}
                  {inboxTime(ring.items[ring.items.length - 1]!.createdAt)}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ListEditor({
  chats,
  title,
  picked,
  onTitle,
  onToggle,
  onClose,
  onSave,
}: {
  chats: ConversationPreview[];
  title: string;
  picked: string[];
  onTitle: (v: string) => void;
  onToggle: (id: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mx-3 mt-3 rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">New chat list</p>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </Button>
      </div>
      <Input className="mt-2" placeholder="List name" value={title} onChange={(e) => onTitle(e.target.value)} maxLength={32} />
      <ul className="mt-2 max-h-48 overflow-y-auto">
        {chats.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={cn("flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left", picked.includes(c.id) && "bg-elevated")}
              onClick={() => onToggle(c.id)}
            >
              <Avatar src={c.imageUrl} name={c.title} size="sm" />
              <span className="truncate text-sm">{c.title}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button className="mt-2 w-full" onClick={onSave} disabled={!title.trim()}>
        Save list
      </Button>
    </div>
  );
}

function StarredSheet({
  items,
  onClose,
  onOpen,
}: {
  items: { id: string; conversation_id: string; body: string; kind: string; created_at: string; title: string | null }[];
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="mx-3 mt-3 rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Star className="size-4 text-streak" /> Starred
        </p>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-sm text-muted">Star a message in a chat to find it here.</p>
      ) : (
        <ul className="mt-2 max-h-64 overflow-y-auto">
          {items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="block w-full rounded-xl px-2 py-2 text-left hover:bg-elevated"
                onClick={() => onOpen(m.conversation_id)}
              >
                <p className="text-xs text-muted">{m.title ?? "Chat"} · {timeAgo(m.created_at)}</p>
                <p className="truncate text-sm">{m.body || m.kind}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type CallRow = Awaited<ReturnType<typeof callHistory>>[number];

function callOutcomeLabel(c: CallRow): string {
  if (c.status === "live") return "In progress";
  if (c.outcome === "declined") return "Declined";
  if (c.status === "missed" || (c.outcome === "ringing" && c.status !== "ended")) return "Missed";
  return c.outgoing ? "Outgoing" : "Incoming";
}

function callLength(c: CallRow): string {
  const start = c.answeredAt ?? c.startedAt;
  if (!c.endedAt) return "";
  const s = Math.max(0, Math.round((new Date(c.endedAt).getTime() - new Date(start).getTime()) / 1000));
  if (s < 1) return "";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${r}s` : `${r}s`;
}

function CallHistory({
  items,
  loading,
  onCall,
}: {
  items: CallRow[];
  loading: boolean;
  onCall: (usernames: string[], kind: "voice" | "video") => void;
}) {
  if (loading && items.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted">Loading calls…</p>;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Phone}
        title="No calls yet"
        body="Place a voice or video call from a private chat. Answered, missed, and declined calls land here."
      />
    );
  }
  return (
    <ul>
      {items.map((c) => {
        const other = c.others[0];
        const title = c.others.map((o) => o.displayName).join(", ") || "Unknown";
        return (
          <li key={c.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar src={other?.avatarUrl} name={title} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{title}</p>
              <p className="text-xs text-muted">
                {c.kind === "video" ? "Video" : "Voice"} · {callOutcomeLabel(c)}
                {callLength(c) ? ` · ${callLength(c)}` : ""} · {timeAgo(c.startedAt)}
              </p>
            </div>
            {other ? (
              <div className="flex gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Voice call"
                  onClick={() => onCall(c.others.map((o) => o.username).filter(Boolean), "voice")}
                >
                  <Phone className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Video call"
                  onClick={() => onCall(c.others.map((o) => o.username).filter(Boolean), "video")}
                >
                  <Video className="size-4" />
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Compose({
  mode,
  onClose,
  onOpen,
}: {
  mode: "dm" | "group" | "channel";
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [title, setTitle] = useState("");
  const [channelUser, setChannelUser] = useState("");
  const [picked, setPicked] = useState<{ username: string; displayName: string; avatarUrl: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const friends = useQuery({ queryKey: ["friends"], queryFn: () => listFriends() });
  const results = useQuery({
    queryKey: ["search", q],
    queryFn: () => globalSearch({ data: { q } }),
    enabled: q.trim().length > 0,
  });
  const people =
    q.trim().length > 0
      ? (results.data?.users ?? []).map((u) => ({
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
        }))
      : (friends.data ?? []).map((f) => ({
          username: f.username,
          displayName: f.displayName,
          avatarUrl: f.avatarUrl,
        }));

  function toggle(p: { username: string; displayName: string; avatarUrl: string | null }) {
    setPicked((cur) =>
      cur.some((x) => x.username === p.username) ? cur.filter((x) => x.username !== p.username) : [...cur, p],
    );
  }

  async function openPrivate(username: string) {
    setBusy(true);
    try {
      const r = await openDm({ data: { username } });
      onOpen(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start chat.");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      if (mode === "dm") {
        const who = picked[0] ?? people[0];
        if (!who) throw new Error("Search someone to message.");
        const r = await openDm({ data: { username: who.username } });
        onOpen(r.id);
        return;
      }
      const name = title.trim();
      if (name.length < 2) throw new Error("Give the group a name — Family, Trip, the house…");
      const r = await createGroup({
        data: {
          title: name,
          usernames: picked.map((p) => p.username),
          broadcast: mode === "channel",
          username: mode === "channel" && channelUser.trim() ? channelUser.trim() : null,
        },
      });
      onOpen(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start chat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{mode === "dm" ? "Private message" : mode === "channel" ? "New channel" : "New group"}</p>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </Button>
      </div>
      {mode === "group" || mode === "channel" ? (
        <>
          <Input
            className="mt-2"
            placeholder={mode === "channel" ? "Channel name" : "Group name — Family, Friends, a trip…"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
          />
          {mode === "channel" ? (
            <Input
              className="mt-2"
              placeholder="Public username (optional)"
              value={channelUser}
              onChange={(e) => setChannelUser(e.target.value)}
              maxLength={20}
            />
          ) : null}
          <p className="mt-1 text-xs text-muted">
            {mode === "channel"
              ? "Only you and admins can post. Subscribers receive broadcasts."
              : "You’re the owner. Add people now or after you create it."}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted">Just the two of you. Tap a name to open the thread.</p>
      )}
      <Input className="mt-2" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
      {picked.length > 0 && mode !== "dm" ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {picked.map((p) => (
            <button key={p.username} type="button" onClick={() => toggle(p)} className="rounded-full bg-elevated px-2 py-1 text-xs">
              {p.displayName} ×
            </button>
          ))}
        </div>
      ) : null}
      <ul className="mt-2 max-h-48 overflow-y-auto">
        {people.map((p) => {
          const on = picked.some((x) => x.username === p.username);
          return (
            <li key={p.username}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (mode === "dm") void openPrivate(p.username);
                  else toggle(p);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-elevated",
                  on && "bg-elevated",
                )}
              >
                <Avatar src={p.avatarUrl} name={p.displayName} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{p.displayName}</span>
                <span className="text-xs text-muted">@{p.username}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {mode !== "dm" || people.length === 0 ? (
        <Button className="mt-3 w-full" disabled={busy} onClick={() => void start()}>
          {busy ? "Opening…" : mode === "dm" ? "Open private chat" : mode === "channel" ? "Create channel" : "Create group"}
        </Button>
      ) : null}
    </div>
  );
}
