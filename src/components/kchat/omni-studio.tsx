import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  Archive,
  ArrowUp,
  Camera,
  Copy,
  Globe,
  FolderKanban,
  Loader2,
  Menu,
  Mic,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { OmniMarkdown } from "@/components/kchat/omni-markdown";
import { OmniLiveVoice } from "@/components/kchat/omni-live-voice";
import { Button } from "@/components/ui/button";
import { attachmentsFromFiles } from "@/lib/kchat/omni-attach";
import type { OmniAttachment } from "@/lib/kchat/omni-files";
import {
  AGENT_BRIEF,
  OMNI_MODELS,
  type OmniAgentId,
  type OmniMode,
  type OmniModelId,
  type OmniPersonality,
} from "@/lib/kchat/omni-router";
import { speakOmni } from "@/lib/kchat/omni-stream-client";
import {
  addOmniProjectFile,
  createOmniThread,
  deleteOmniMemory,
  deleteOmniPrompt,
  deleteOmniThread,
  editOmniUser,
  exportOmniThread,
  getOmniPrefs,
  listOmniMemory,
  listOmniMessages,
  listOmniProjectFiles,
  listOmniProjects,
  listOmniPrompts,
  listOmniThreads,
  myOmniUsage,
  omniStatus,
  patchOmniThread,
  rateOmniMessage,
  regenerateOmni,
  quickNyxReply,
  saveOmniMemory,
  saveOmniPrefs,
  saveOmniPrompt,
  sendOmniMessage,
  shareOmniThread,
  upsertOmniProject,
  type OmniMsg,
} from "@/lib/kchat/server/omni";
import { cn } from "@/lib/utils";

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "";
}

function shownAiError(error: unknown): string {
  const msg = errorText(error)
    .replace(/sk-[A-Za-z0-9_-]+/g, "key")
    .replace(/AQ\.[A-Za-z0-9_-]+/g, "key")
    .replace(/key_[A-Za-z0-9]+/g, "key")
    .slice(0, 180);
  return msg || "NYXAI could not answer. Tap Retry.";
}

async function readNyxStream(
  threadId: string,
  content: string,
  signal: AbortSignal,
  onDelta: (full: string) => void,
): Promise<string> {
  const bearer = window.sessionStorage.getItem("grok-auth.bearer-token");
  const res = await fetch("/api/nyx-stream", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ threadId, content }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Chat failed (${res.status}).`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let failure = "";
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    buffer += decoder.decode(part.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const event = /event:\s*(\w+)/.exec(block)?.[1] || "message";
      const dataLine = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!dataLine) continue;
      const json = JSON.parse(dataLine) as { text?: string; error?: string };
      if (event === "delta" && json.text) {
        text += json.text;
        onDelta(text);
      } else if (event === "done" && json.text) {
        text = json.text;
        onDelta(text);
      } else if (event === "error") {
        failure = json.error || "Chat failed.";
      }
    }
  }
  if (text.trim()) return text.trim();
  throw new Error(failure || "Empty reply.");
}

const MODES: { id: OmniMode; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "search", label: "Search" },
  { id: "research", label: "Research" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "code", label: "Code" },
  { id: "agent", label: "Agent" },
];

const AGENT_LABEL: Record<OmniAgentId, string> = {
  research: "Research",
  coding: "Coding",
  writing: "Writing",
  data: "Data",
  study: "Study",
  business: "Business",
  travel: "Travel",
  marketing: "Marketing",
  social: "Social",
  assistant: "Assistant",
};

const PERSONALITIES: OmniPersonality[] = [
  "professional",
  "friendly",
  "creative",
  "concise",
  "teacher",
  "researcher",
  "developer",
  "advisor",
];

type Panel = "history" | "memory" | "projects" | "prompts" | "settings" | "code" | null;

function speakable(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " code block. ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " image. ")
    .replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

export function OmniStudio() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["omni-status"], queryFn: () => omniStatus() });
  const prefs = useQuery({ queryKey: ["omni-prefs"], queryFn: () => getOmniPrefs() });
  const threads = useQuery({ queryKey: ["omni-threads"], queryFn: () => listOmniThreads({ data: {} }) });
  const usage = useQuery({ queryKey: ["omni-my-usage"], queryFn: () => myOmniUsage() });
  const [active, setActive] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [citations, setCitations] = useState<{ url: string; title: string }[]>([]);
  const [fallback, setFallback] = useState(false);
  const [mode, setMode] = useState<OmniMode>("chat");
  const [modelId, setModelId] = useState<OmniModelId>("auto");
  const [webSearch, setWebSearch] = useState<"auto" | "on" | "off">("auto");
  const [agent, setAgent] = useState<OmniAgentId>("research");
  const [aspect, setAspect] = useState("1:1");
  const [files, setFiles] = useState<OmniAttachment[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [liveVoice, setLiveVoice] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const boot = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try {
      const ask = sessionStorage.getItem("omni-ask");
      if (!ask) return;
      sessionStorage.removeItem("omni-ask");
      setText(ask);
    } catch {
      /* ignore */
    }
  }, []);

  const messages = useQuery({
    queryKey: ["omni-msg", active],
    enabled: Boolean(active),
    queryFn: () => listOmniMessages({ data: { threadId: active! } }),
  });

  useEffect(() => {
    if (boot.current || !threads.isSuccess) return;
    const first = threads.data[0];
    if (first) {
      if (!active) setActive(first.id);
      return;
    }
    boot.current = true;
    void createOmniThread({ data: { modelId, mode } })
      .then((r) => {
        setActive(r.id);
        void qc.invalidateQueries({ queryKey: ["omni-threads"] });
      })
      .catch(() => {
        boot.current = false;
        toast.error("Could not start NYXAI.");
      });
  }, [threads.isSuccess, threads.data, active, qc, modelId, mode]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.data, pending, draft, statusLine]);

  useEffect(() => {
    if (prefs.data?.defaultModel && prefs.data.defaultModel !== "auto") {
      setModelId(prefs.data.defaultModel as OmniModelId);
    }
    if (prefs.data?.searchPref) setWebSearch(prefs.data.searchPref);
  }, [prefs.data?.defaultModel, prefs.data?.searchPref]);


  const items: OmniMsg[] = messages.data ?? [];
  const lastAssistant = [...items].reverse().find((m) => m.role === "assistant");

  async function ensureThread(): Promise<string> {
    if (active) return active;
    const created = await createOmniThread({ data: { modelId, mode } });
    setActive(created.id);
    void qc.invalidateQueries({ queryKey: ["omni-threads"] });
    return created.id;
  }

  async function speakText(raw: string) {
    stopSpeak();
    const clipped = speakable(raw);
    if (!clipped) return;
    const blob = await speakOmni(clipped, prefs.data?.voiceId || "eve");
    if (blob) {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setSpeaking(true);
      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
        if (handsFree) startListen(true);
      };
      await audio.play().catch(() => setSpeaking(false));
      return;
    }
    if (typeof speechSynthesis === "undefined") return;
    const u = new SpeechSynthesisUtterance(clipped);
    u.rate = prefs.data?.voiceSpeed || 1;
    u.onend = () => {
      setSpeaking(false);
      if (handsFree) startListen(true);
    };
    setSpeaking(true);
    speechSynthesis.speak(u);
  }

  function stopSpeak() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setSpeaking(false);
  }

  function startListen(fromHandsFree = false) {
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
    if (!SR) {
      if (!fromHandsFree) toast.error("Voice input isn’t available in this browser.");
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => {
      const last = ev.results[ev.results.length - 1];
      if (!last) return;
      setText(last[0].transcript);
      if (last.isFinal) {
        rec.stop();
        setListening(false);
        void submit(last[0].transcript);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  function stopListen() {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }

  async function submit(content: string, opts?: { mode?: OmniMode; editId?: string }) {
    const next = content.trim();
    if ((!next && files.length === 0) || busy) return;
    const useMode = opts?.mode ?? mode;
    setBusy(true);
    setPending(next || "(attachment)");
    setDraft("");
    setStatusLine(useMode === "research" ? "Planning research…" : "Sending…");
    setPrompts([]);
    setCitations([]);
    setFallback(false);
    setText("");
    if (box.current) box.current.style.height = "auto";
    const ac = new AbortController();
    abortRef.current = ac;
    const attached = files;
    setFiles([]);
    try {
      const threadId = await ensureThread();
      if (opts?.editId) {
        const r = await editOmniUser({ data: { threadId, messageId: opts.editId, content: next } });
        setDraft(r.text);
        setPrompts(r.prompts);
        setCitations(r.citations);
        setFallback(r.fallback);
        if (handsFree) void speakText(r.text);
      } else {
        setStatusLine("Thinking…");
        if (useMode === "image") {
          const generated = await sendOmniMessage({
            data: {
              threadId,
              content: next,
              attachments: attached,
              mode: useMode,
              modelId,
              agent: null,
              aspect,
              searchPref: webSearch,
            },
          });
          setDraft(generated.text);
          setPrompts(generated.prompts);
          setCitations(generated.citations);
          setFallback(generated.fallback);
          if (handsFree) void speakText(generated.text);
        } else if (useMode === "video") {
          const bearer = window.sessionStorage.getItem("grok-auth.bearer-token");
          const headers: Record<string, string> = {
            "content-type": "application/json",
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          };
          const image = attached.find((file) => file.kind === "image" && file.dataUrl)?.dataUrl;
          const startedRes = await fetch("/api/video/generate", {
            method: "POST",
            headers,
            signal: ac.signal,
            body: JSON.stringify({
              prompt: next,
              image,
              ratio: aspect === "9:16" ? "720:1280" : "1280:720",
              duration: 5,
            }),
          });
          const started = (await startedRes.json().catch(() => ({}))) as { id?: string; error?: string };
          if (!startedRes.ok || !started.id) {
            throw new Error(started.error || "Runway video generation failed. Please try again.");
          }
          let videoUrl = "";
          for (let attempt = 0; attempt < 40; attempt += 1) {
            if (ac.signal.aborted) throw new Error("Stopped.");
            setStatusLine(attempt === 0 ? "Runway is generating the video…" : "Video generation is still processing.");
            await new Promise((resolve) => setTimeout(resolve, 4000));
            const statusRes = await fetch(`/api/video/status/${started.id}`, {
              headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
              signal: ac.signal,
            });
            const status = (await statusRes.json().catch(() => ({}))) as { status?: string; outputUrl?: string; error?: string };
            if (status.status === "SUCCEEDED" && status.outputUrl) {
              videoUrl = status.outputUrl;
              break;
            }
            if (status.status === "FAILED") throw new Error(status.error || "Runway video generation failed. Please try again.");
          }
          if (!videoUrl) throw new Error("Video generation is still processing.");
          setDraft(`Here's the video.\n\n![video](${videoUrl})`);
        } else {
          const bearer = window.sessionStorage.getItem("grok-auth.bearer-token");
          const headers: Record<string, string> = {
            "content-type": "application/json",
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          };
          let text = "";
          const res = await fetch("/api/nyx-reply", {
            method: "POST",
            headers,
            body: JSON.stringify({ threadId, content: next }),
            signal: ac.signal,
          });
          const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
          text = data.text?.trim() || "";
          if (!text) {
            try {
              text = await readNyxStream(threadId, next, ac.signal, (full) => setDraft(full));
            } catch (streamError) {
              if (ac.signal.aborted) throw streamError;
              try {
                const spoken = await quickNyxReply({ data: { threadId, content: next } });
                text = spoken.text?.trim() || "";
              } catch (fnError) {
                if (!text) throw new Error(data.error || errorText(fnError) || errorText(streamError) || "NYXAI could not answer. Tap Retry.");
              }
            }
          }
          if (!text.trim()) throw new Error(data.error || "NYXAI could not answer. Tap Retry.");
          setDraft(text.trim());
          setPrompts([]);
          setCitations([]);
          setFallback(false);
          if (handsFree) void speakText(text);
        }
      }
      try {
        const refreshed = await messages.refetch();
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["omni-threads"] }),
          qc.invalidateQueries({ queryKey: ["omni-my-usage"] }),
        ]);
        if (refreshed.data?.[refreshed.data.length - 1]?.role === "assistant") setDraft("");
      } catch {
        /* The reply is already on screen. A history refresh must not replace it with an error. */
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        toast.error(shownAiError(e));
        setText((t) => t || next);
      }
    } finally {
      setPending(null);
      setStatusLine(null);
      setBusy(false);
      abortRef.current = null;
      setEditId(null);
    }
  }

  function stopGen() {
    abortRef.current?.abort();
    setBusy(false);
    setStatusLine(null);
  }

  async function onPick(list: FileList | null) {
    if (!list?.length) return;
    try {
      const next = await attachmentsFromFiles([...list]);
      setFiles((f) => [...f, ...next].slice(0, 6));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not attach file.");
    }
  }

  const filtered = (threads.data ?? []).filter((t) =>
    search.trim() ? t.title.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <div className="kc-omni">
      <header className="kc-omni-head flex shrink-0 items-center gap-2 border-b border-border px-2">
        <Button size="icon-sm" variant="ghost" aria-label="Menu" onClick={() => setPanel("history")}>
          <Menu className="size-5" />
        </Button>
        <Link to="/" className="flex min-w-0 items-center gap-1.5">
          <Sparkles className="size-4 shrink-0 text-ai" />
          <span className="text-sm font-semibold">{status.data?.superOmni ? "NYXAI+" : "NYXAI"}</span>
        </Link>
        <Link
          to="/plus/ai"
          className={cn(
            "hidden rounded-full px-2 py-1 text-[11px] font-medium sm:inline",
            status.data?.superOmni ? "kc-super-chip" : "bg-elevated text-muted",
          )}
        >
          {status.data?.superOmni ? "On" : "Upgrade"}
        </Link>
        <select
          value={modelId}
          aria-label="Model"
          className="ml-auto max-w-[7.5rem] truncate rounded-full bg-elevated px-2 py-1 text-xs"
          onChange={(e) => setModelId(e.target.value as OmniModelId)}
        >
          {OMNI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label.replace("NYXAI ", "")}
            </option>
          ))}
        </select>
        <Button
          size="icon-sm"
          variant={liveVoice ? "default" : "ghost"}
          aria-label="Live voice"
          onClick={() => setLiveVoice(true)}
        >
          <AudioLines className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label="New chat"
          disabled={busy}
          onClick={() =>
            void createOmniThread({ data: { modelId, mode } }).then((r) => {
              setActive(r.id);
              setPrompts([]);
              setDraft("");
              setCitations([]);
              void qc.invalidateQueries({ queryKey: ["omni-threads"] });
            })
          }
        >
          <Plus className="size-4" />
        </Button>
      </header>

      {liveVoice ? (
        <OmniLiveVoice
          voiceId={prefs.data?.voiceId || "eve"}
          voiceSpeed={prefs.data?.voiceSpeed || 1}
          busy={busy}
          onAsk={async (said) => {
            const threadId = await ensureThread();
            const r = await quickNyxReply({ data: { threadId, content: said } });
            await messages.refetch();
            return r.text;
          }}
          onClose={() => setLiveVoice(false)}
        />
      ) : null}

      <div ref={scroller} className="kc-omni-messages space-y-4 px-4 py-3">
        {items.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            onCopy={() => void navigator.clipboard.writeText(m.content).then(() => toast.success("Copied"))}
            onSpeak={() => void speakText(m.content)}
            onRate={
              m.role === "assistant"
                ? (rating) =>
                    void rateOmniMessage({ data: { messageId: m.id, rating } })
                      .then(() => messages.refetch())
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not save rating."))
                : undefined
            }
            onEdit={
              m.role === "user"
                ? () => {
                    setText(m.content);
                    setEditId(m.id);
                    box.current?.focus();
                  }
                : undefined
            }
          />
        ))}
        {pending ? (
          <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-sm leading-relaxed text-accent-fg whitespace-pre-wrap">
            {pending}
          </div>
        ) : null}
        {draft ? (
          <div className="w-fit max-w-[80%] rounded-2xl rounded-bl-md bg-elevated px-3.5 py-2.5 text-sm leading-relaxed text-fg" data-omni-role="assistant">
            <OmniMarkdown text={draft} />
          </div>
        ) : null}
        {statusLine ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-3.5 animate-spin" />
            {statusLine}
          </p>
        ) : null}
        {citations.length > 0 && !busy ? (
          <details className="rounded-2xl border border-border p-3 open:bg-surface">
            <summary className="cursor-pointer text-xs font-medium text-muted">
              Sources · {citations.length}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {citations.map((c, i) => (
                <li key={c.url}>
                  <a href={c.url} target="_blank" rel="noreferrer" className="text-sm text-ai underline-offset-2 hover:underline">
                    [{i + 1}] {c.title || c.url}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {!busy && prompts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {prompts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => void submit(p)}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-xs hover:bg-elevated"
              >
                {p}
              </button>
            ))}
          </div>
        ) : null}
        {!busy && items.length > 0 ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={!active}
              onClick={() =>
                void regenerateOmni({ data: { threadId: active! } })
                  .then(async (r) => {
                    setPrompts(r.prompts);
                    setCitations(r.citations);
                    setFallback(r.fallback);
                    await messages.refetch();
                  })
                  .catch((err) => toast.error(shownAiError(err)))
              }
            >
              <RefreshCw className="size-3.5" />
              Regen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!active}
              onClick={() =>
                void exportOmniThread({ data: { id: active! } }).then((r) => {
                  void navigator.clipboard.writeText(r.markdown);
                  toast.success("Conversation copied");
                })
              }
            >
              <Copy className="size-3.5" />
              Export
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!active}
              onClick={() =>
                void shareOmniThread({ data: { id: active! } }).then((r) => {
                  void navigator.clipboard.writeText(r.shareId);
                  toast.success("Share id copied");
                })
              }
            >
              Share
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!lastAssistant}
              onClick={() => {
                if (!lastAssistant) return;
                const img = lastAssistant.content.match(/!\[.*?\]\((https?:[^)]+|data:[^)]+)\)/);
                const body = lastAssistant.content
                  .replace(/!\[[^\]]*]\([^)]+\)/g, "")
                  .replace(/\n>>.+$/s, "")
                  .trim()
                  .slice(0, 4000);
                try {
                  sessionStorage.setItem("omni-create-tab", "post");
                  sessionStorage.setItem(
                    "omni-create-draft",
                    JSON.stringify({ body, mediaUrl: img?.[1] ?? null, kind: img ? "image" : "text" }),
                  );
                } catch {
                  /* ignore */
                }
                window.location.assign("/create");
              }}
            >
              Review as post
            </Button>
          </div>
        ) : null}
      </div>

      {files.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto px-3 pb-1">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full bg-elevated px-2 py-1 text-xs">
              {f.kind === "image" && f.dataUrl ? (
                <img src={f.dataUrl} alt="" className="size-6 rounded object-cover" />
              ) : null}
              <span className="max-w-[8rem] truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <form
        className="kc-omni-composer flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text, editId ? { editId } : undefined);
        }}
      >
        <input ref={attachRef} type="file" className="hidden" multiple onChange={(e) => void onPick(e.target.files)} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onPick(e.target.files)} />
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Attach" onClick={() => attachRef.current?.click()}>
          <Paperclip className="size-4" />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Camera" onClick={() => camRef.current?.click()}>
          <Camera className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant={webSearch === "on" || mode === "search" || mode === "research" ? "default" : "ghost"}
          aria-label={webSearch === "on" ? "Web Search on" : "Web Search auto"}
          title={webSearch === "on" ? "Web Search on" : "Web Search auto"}
          onClick={() => setWebSearch((w) => (w === "on" ? "auto" : "on"))}
        >
          <Globe className="size-4" />
        </Button>
        <textarea
          id="omni-ask"
          ref={box}
          value={text}
          rows={1}
          maxLength={8000}
          disabled={busy}
          placeholder={editId ? "Edit and send" : "Ask NYXAI"}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(text, editId ? { editId } : undefined);
            }
          }}
          className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-subtle focus:border-ai"
        />
        <Button
          type="button"
          size="icon-sm"
          variant={listening ? "default" : "ghost"}
          aria-label={listening ? "Stop listening" : "Voice"}
          onClick={() => (listening ? stopListen() : startListen())}
        >
          <Mic className="size-4" />
        </Button>
        {busy ? (
          <Button type="button" size="icon" variant="secondary" aria-label="Stop" onClick={stopGen}>
            <Square className="size-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!text.trim() && files.length === 0} aria-label="Send">
            <ArrowUp className="size-4" />
          </Button>
        )}
      </form>

      {panel ? (
        <StudioPanel
          panel={panel}
          onClose={() => setPanel(null)}
          search={search}
          setSearch={setSearch}
          threads={filtered}
          active={active}
          busy={busy}
          handsFree={handsFree}
          setHandsFree={setHandsFree}
          speaking={speaking}
          onStopSpeak={stopSpeak}
          onSpeakLast={() => {
            const last = [...items].reverse().find((m) => m.role === "assistant");
            if (last) void speakText(last.content);
          }}
          usage={usage.data}
          mode={mode}
          setMode={setMode}
          agent={agent}
          setAgent={setAgent}
          aspect={aspect}
          setAspect={setAspect}
          onOpenThread={(id) => {
            setActive(id);
            setPanel(null);
            setPrompts([]);
            setDraft("");
          }}
          onNew={() =>
            void createOmniThread({ data: { modelId, mode } }).then((r) => {
              setActive(r.id);
              setPanel(null);
              void qc.invalidateQueries({ queryKey: ["omni-threads"] });
            })
          }
          onPatch={(id, patch) =>
            void patchOmniThread({ data: { id, ...patch } }).then(() => qc.invalidateQueries({ queryKey: ["omni-threads"] }))
          }
          onDeleteThread={(id) =>
            void deleteOmniThread({ data: { id } }).then(() => {
              if (active === id) setActive(null);
              boot.current = false;
              void threads.refetch();
            })
          }
          onUsePrompt={(body) => {
            setText(body);
            setPanel(null);
            box.current?.focus();
          }}
          onAskCode={(code) => {
            setMode("code");
            setPanel(null);
            void submit(`Review and, if useful, run:\n\n\`\`\`\n${code}\n\`\`\``, { mode: "code" });
          }}
          onAttachProject={(projectId) => {
            if (!active) return;
            void patchOmniThread({ data: { id: active, projectId } }).then(() => toast.success("Project attached to this chat"));
          }}
        />
      ) : null}
    </div>
  );
}

function MessageBubble({
  msg,
  onCopy,
  onSpeak,
  onEdit,
  onRate,
}: {
  msg: OmniMsg;
  onCopy: () => void;
  onSpeak: () => void;
  onEdit?: () => void;
  onRate?: (rating: "up" | "down" | null) => void;
}) {
  const user = msg.role === "user";
  return (
    <div className={cn("group w-fit max-w-[80%] space-y-1", user ? "ml-auto" : "")} data-omni-role={msg.role}>
      <div
        className={cn(
          "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          user
            ? "rounded-br-md bg-accent text-accent-fg whitespace-pre-wrap"
            : "rounded-bl-md bg-elevated text-fg",
        )}
      >
        {user ? msg.content : <OmniMarkdown text={msg.content} />}
      </div>
      {msg.attachments?.length ? (
        <div className="flex flex-wrap gap-1">
          {msg.attachments.map((a, i) =>
            a.kind === "image" && a.dataUrl ? (
              <img key={i} src={a.dataUrl} alt={a.name} className="h-16 rounded-lg object-cover" />
            ) : (
              <span key={i} className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
                {a.name}
              </span>
            ),
          )}
        </div>
      ) : null}
      {msg.citations?.length ? (
        <details className="text-[11px] text-muted">
          <summary className="cursor-pointer">
            {msg.citations.length} source{msg.citations.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {msg.citations.map((c, i) => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noreferrer" className="text-ai hover:underline">
                  [{i + 1}] {c.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="flex gap-1 opacity-80">
        <button type="button" className="rounded-full p-1 text-muted hover:bg-elevated" aria-label="Copy" onClick={onCopy}>
          <Copy className="size-3.5" />
        </button>
        {!user ? (
          <button type="button" className="rounded-full p-1 text-muted hover:bg-elevated" aria-label="Speak" onClick={onSpeak}>
            <Volume2 className="size-3.5" />
          </button>
        ) : null}
        {onRate ? (
          <>
            <button
              type="button"
              className={cn("rounded-full p-1 hover:bg-elevated", msg.rating === "up" ? "text-ok" : "text-muted")}
              aria-label="Helpful"
              onClick={() => onRate(msg.rating === "up" ? null : "up")}
            >
              <ThumbsUp className="size-3.5" />
            </button>
            <button
              type="button"
              className={cn("rounded-full p-1 hover:bg-elevated", msg.rating === "down" ? "text-danger" : "text-muted")}
              aria-label="Not helpful"
              onClick={() => onRate(msg.rating === "down" ? null : "down")}
            >
              <ThumbsDown className="size-3.5" />
            </button>
          </>
        ) : null}
        {onEdit ? (
          <button type="button" className="rounded-full p-1 text-muted hover:bg-elevated" aria-label="Edit" onClick={onEdit}>
            Edit
          </button>
        ) : null}
      </div>
    </div>
  );
}


type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function StudioPanel(props: {
  panel: Exclude<Panel, null>;
  onClose: () => void;
  search: string;
  setSearch: (s: string) => void;
  threads: { id: string; title: string; pinned: boolean; archived: boolean; folder: string }[];
  active: string | null;
  busy: boolean;
  handsFree: boolean;
  setHandsFree: (v: boolean) => void;
  speaking: boolean;
  onStopSpeak: () => void;
  onSpeakLast: () => void;
  usage?: { hours: number; rows: { kind: string; n: number }[]; caps: { chatPerMin: number; imagesPerHour: number; ttsPerHour: number } };
  mode: OmniMode;
  setMode: (m: OmniMode) => void;
  agent: OmniAgentId;
  setAgent: (a: OmniAgentId) => void;
  aspect: string;
  setAspect: (a: string) => void;
  onOpenThread: (id: string) => void;
  onNew: () => void;
  onPatch: (id: string, patch: { pinned?: boolean; archived?: boolean; title?: string; folder?: string }) => void;
  onDeleteThread: (id: string) => void;
  onUsePrompt: (body: string) => void;
  onAskCode: (code: string) => void;
  onAttachProject: (id: string) => void;
}) {
  const [tab, setTab] = useState(props.panel === "history" ? "chats" : props.panel);
  useEffect(() => {
    setTab(props.panel === "history" ? "chats" : props.panel);
  }, [props.panel]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-bg/95 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between px-3">
        <p className="text-sm font-semibold">NYXAI</p>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={props.onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="kc-hide-scrollbar flex gap-1 overflow-x-auto px-3 pb-2">
        {(
          [
            ["chats", "Chats"],
            ["projects", "Projects"],
            ["memory", "Memory"],
            ["prompts", "Prompts"],
            ["code", "Code"],
            ["settings", "Settings"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn("rounded-full px-3 py-1 text-xs", tab === id ? "bg-elevated text-fg" : "text-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {tab === "chats" ? (
          <ChatsPane {...props} />
        ) : tab === "projects" ? (
          <ProjectsPane onAttach={props.onAttachProject} />
        ) : tab === "memory" ? (
          <MemoryPane />
        ) : tab === "prompts" ? (
          <PromptsPane onUse={props.onUsePrompt} />
        ) : tab === "code" ? (
          <CodePane onAsk={props.onAskCode} />
        ) : (
          <SettingsPane
            handsFree={props.handsFree}
            setHandsFree={props.setHandsFree}
            speaking={props.speaking}
            onStopSpeak={props.onStopSpeak}
            onSpeakLast={props.onSpeakLast}
            usage={props.usage}
            mode={props.mode}
            setMode={props.setMode}
            agent={props.agent}
            setAgent={props.setAgent}
            aspect={props.aspect}
            setAspect={props.setAspect}
          />
        )}
      </div>
    </div>
  );
}

function ChatsPane(props: {
  search: string;
  setSearch: (s: string) => void;
  threads: { id: string; title: string; pinned: boolean; archived: boolean; folder: string }[];
  active: string | null;
  onOpenThread: (id: string) => void;
  onNew: () => void;
  onPatch: (id: string, patch: { pinned?: boolean; archived?: boolean; title?: string }) => void;
  onDeleteThread: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <input
            value={props.search}
            onChange={(e) => props.setSearch(e.target.value)}
            placeholder="Search chats"
            className="h-10 w-full rounded-full border border-border bg-surface pl-9 pr-3 text-sm outline-none"
          />
        </div>
        <Button size="sm" onClick={props.onNew}>
          New
        </Button>
      </div>
      <ul className="mt-3 space-y-1">
        {props.threads.map((t) => (
          <li key={t.id} className={cn("flex items-center gap-1 rounded-xl px-2 py-2", props.active === t.id && "bg-elevated")}>
            <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => props.onOpenThread(t.id)}>
              {t.pinned ? "📌 " : ""}
              {t.title}
            </button>
            <button type="button" aria-label="Pin" onClick={() => props.onPatch(t.id, { pinned: !t.pinned })}>
              <Pin className="size-3.5 text-muted" />
            </button>
            <button type="button" aria-label="Archive" onClick={() => props.onPatch(t.id, { archived: true })}>
              <Archive className="size-3.5 text-muted" />
            </button>
            <button type="button" aria-label="Delete" onClick={() => props.onDeleteThread(t.id)}>
              <Trash2 className="size-3.5 text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MemoryPane() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["omni-mem"], queryFn: () => listOmniMemory() });
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Saved only if you add it. Disable or delete any time.</p>
      {(list.data ?? []).map((m) => (
        <div key={m.id} className="rounded-xl border border-border p-3 text-sm">
          <p className="font-medium">{m.key}</p>
          <p className="text-muted">{m.value}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void deleteOmniMemory({ data: { id: m.id } }).then(() => qc.invalidateQueries({ queryKey: ["omni-mem"] }))}
          >
            Delete
          </Button>
        </div>
      ))}
      <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Label" className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="What to remember" className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
      <Button
        disabled={!key.trim() || !value.trim()}
        onClick={() =>
          void saveOmniMemory({ data: { key, value } }).then(() => {
            setKey("");
            setValue("");
            void qc.invalidateQueries({ queryKey: ["omni-mem"] });
          })
        }
      >
        Save memory
      </Button>
    </div>
  );
}

function ProjectsPane({ onAttach }: { onAttach: (id: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["omni-proj"], queryFn: () => listOmniProjects() });
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const files = useQuery({
    queryKey: ["omni-proj-files", open],
    enabled: Boolean(open),
    queryFn: () => listOmniProjectFiles({ data: { projectId: open! } }),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Keep files with a project so NYXAI can use them across chats.</p>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" className="h-10 flex-1 rounded-xl border border-border bg-surface px-3 text-sm" />
        <Button
          size="sm"
          disabled={!name.trim()}
          onClick={() =>
            void upsertOmniProject({ data: { name } }).then(() => {
              setName("");
              void qc.invalidateQueries({ queryKey: ["omni-proj"] });
            })
          }
        >
          Add
        </Button>
      </div>
      {(list.data ?? []).map((p) => (
        <div key={p.id} className="rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <button type="button" className="text-left text-sm font-medium" onClick={() => setOpen(p.id)}>
              <FolderKanban className="mr-1 inline size-4" />
              {p.name}
            </button>
            <Button size="sm" variant="ghost" onClick={() => onAttach(p.id)}>
              Use here
            </Button>
          </div>
          {open === p.id ? (
            <div className="mt-2 space-y-2">
              {(files.data ?? []).map((f) => (
                <p key={f.id} className="text-xs text-muted">
                  {f.name}
                </p>
              ))}
              <input
                type="file"
                multiple
                onChange={(e) => {
                  if (!e.target.files) return;
                  void attachmentsFromFiles([...e.target.files]).then(async (atts) => {
                    for (const file of atts) {
                      await addOmniProjectFile({ data: { projectId: p.id, file } });
                    }
                    void files.refetch();
                  });
                }}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PromptsPane({ onUse }: { onUse: (body: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["omni-pr"], queryFn: () => listOmniPrompts() });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <div className="space-y-3">
      {(list.data ?? []).map((p) => (
        <div key={p.id} className="rounded-xl border border-border p-3">
          <p className="text-sm font-medium">{p.title}</p>
          <p className="text-[11px] text-muted">{p.category}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => onUse(p.body)}>
              Use
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void saveOmniPrompt({ data: { ...p, favorite: !p.favorite } }).then(() => qc.invalidateQueries({ queryKey: ["omni-pr"] }))}
            >
              {p.favorite ? "★" : "☆"}
            </Button>
            {!p.id.startsWith("seed_") ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void deleteOmniPrompt({ data: { id: p.id } }).then(() => qc.invalidateQueries({ queryKey: ["omni-pr"] }))}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Prompt title" className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Prompt body" className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm" />
      <Button
        disabled={!title.trim() || !body.trim()}
        onClick={() =>
          void saveOmniPrompt({ data: { title, body, category: "Writing" } }).then(() => {
            setTitle("");
            setBody("");
            void qc.invalidateQueries({ queryKey: ["omni-pr"] });
          })
        }
      >
        Save prompt
      </Button>
    </div>
  );
}

function CodePane({ onAsk }: { onAsk: (code: string) => void }) {
  const [code, setCode] = useState("function hello() {\n  return 42;\n}\n");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Paste code. NYXAI can review it and run calculations through the coding tools — it will not invent runtime output.</p>
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={14}
        spellCheck={false}
        className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs"
      />
      <Button onClick={() => onAsk(code)}>Ask NYXAI</Button>
    </div>
  );
}

function SettingsPane({
  handsFree,
  setHandsFree,
  speaking,
  onStopSpeak,
  onSpeakLast,
  usage,
  mode,
  setMode,
  agent,
  setAgent,
  aspect,
  setAspect,
}: {
  handsFree: boolean;
  setHandsFree: (v: boolean) => void;
  speaking: boolean;
  onStopSpeak: () => void;
  onSpeakLast: () => void;
  usage?: { hours: number; rows: { kind: string; n: number }[]; caps: { chatPerMin: number; imagesPerHour: number; ttsPerHour: number } };
  mode: OmniMode;
  setMode: (m: OmniMode) => void;
  agent: OmniAgentId;
  setAgent: (a: OmniAgentId) => void;
  aspect: string;
  setAspect: (a: string) => void;
}) {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["omni-prefs"], queryFn: () => getOmniPrefs() });
  const p = prefs.data;
  function save(partial: {
    displayName?: string;
    personality?: string;
    lengthPref?: string;
    language?: string;
    customInstructions?: string;
    memoryEnabled?: boolean;
    searchPref?: "auto" | "on" | "off";
  }) {
    void saveOmniPrefs({ data: partial }).then(() => qc.invalidateQueries({ queryKey: ["omni-prefs"] }));
  }

  return (
    <div className="space-y-4 text-sm">
      <label className="block">
        <span className="text-muted">Display name</span>
        <input
          defaultValue={p?.displayName}
          onBlur={(e) => save({ displayName: e.target.value })}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3"
        />
      </label>
      <label className="block">
        <span className="text-muted">Personality</span>
        <select
          value={p?.personality ?? "friendly"}
          onChange={(e) => save({ personality: e.target.value })}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3"
        >
          {PERSONALITIES.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-muted">Reply length</span>
        <select
          value={p?.lengthPref ?? "medium"}
          onChange={(e) => save({ lengthPref: e.target.value })}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3"
        >
          <option value="short">Short</option>
          <option value="medium">Medium</option>
          <option value="long">Long</option>
        </select>
      </label>
      <label className="block">
        <span className="text-muted">Language</span>
        <input
          defaultValue={p?.language ?? "English"}
          onBlur={(e) => save({ language: e.target.value })}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3"
        />
      </label>
      <label className="block">
        <span className="text-muted">Web Search</span>
        <select
          value={p?.searchPref ?? "auto"}
          onChange={(e) => save({ searchPref: e.target.value as "auto" | "on" | "off" })}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3"
        >
          <option value="auto">Auto — search when the question needs current facts</option>
          <option value="on">Always search</option>
          <option value="off">Never search</option>
        </select>
      </label>
      <label className="block">
        <span className="text-muted">Mode</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as OmniMode)}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3"
        >
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {mode === "image" || mode === "video" ? (
        <label className="block">
          <span className="text-muted">Image size</span>
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3"
          >
            <option value="1:1">1:1</option>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
          </select>
        </label>
      ) : null}
      {mode === "agent" ? (
        <label className="block">
          <span className="text-muted">Agent</span>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value as OmniAgentId)}
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3"
          >
            {(Object.keys(AGENT_LABEL) as OmniAgentId[]).map((id) => (
              <option key={id} value={id} title={AGENT_BRIEF[id]}>
                {AGENT_LABEL[id]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block">
        <span className="text-muted">Custom instructions</span>

        <textarea
          defaultValue={p?.customInstructions}
          onBlur={(e) => save({ customInstructions: e.target.value })}
          rows={3}
          className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2"
        />
      </label>
      <label className="flex items-center justify-between">
        <span>Remember facts I save</span>
        <input
          type="checkbox"
          checked={p?.memoryEnabled ?? true}
          onChange={(e) => save({ memoryEnabled: e.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between">
        <span>Hands-free voice</span>
        <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onSpeakLast}>
          <Volume2 className="size-3.5" />
          Speak last
        </Button>
        {speaking ? (
          <Button size="sm" variant="ghost" onClick={onStopSpeak}>
            <VolumeX className="size-3.5" />
            Stop
          </Button>
        ) : null}
      </div>
      {usage ? (
        <div className="rounded-xl bg-elevated p-3 text-xs text-muted">
          <p className="font-medium text-fg">Activity · last {usage.hours}h</p>
          <ul className="mt-1">
            {usage.rows.map((r) => (
              <li key={r.kind}>
                {r.kind}: {r.n}
              </li>
            ))}
            {usage.rows.length === 0 ? <li>Nothing yet — talk, search, or generate freely.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
