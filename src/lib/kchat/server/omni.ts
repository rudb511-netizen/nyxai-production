import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import { newId } from "../ids";
import {
  buildOmniSystem,
  isMetaCommentary,
  parseOmniTail,
  repliesLoop,
  sanitizeOmniOutput,
} from "../omni-ai";
import type { OmniAttachment } from "../omni-files";
import { summarizeExtract } from "../omni-files";
import {
  compactHistory,
  detectIntent,
  extractExplicitMemory,
  isFrustration,
  isGreeting,
  isTopicChange,
  lastOpenUserQuestion,
} from "../omni-intent";
import {
  applySuperOmni,
  getModel,
  resolveModel,
  resolveSearch,
  wantsImage,
  type OmniMode,
} from "../omni-router";
import { takeToken, rateError } from "../rate-limit";
import { omniCaps, type OmniCaps } from "../superomni";
import type { ChatTurn, XaiCitation } from "../xai";
import { isCannedOutage, providerFailureMessage } from "../ai-errors";
import { hasSuperOmni } from "./billing";
import { assertNotBanned, ensureProfile, requireSafety, sqlClient } from "./helpers";

export type OmniPrefs = {
  displayName: string;
  personality: string;
  lengthPref: string;
  language: string;
  customInstructions: string;
  memoryEnabled: boolean;
  voiceId: string;
  voiceSpeed: number;
  defaultModel: string;
  searchPref: "auto" | "on" | "off";
};

export type OmniThread = {
  id: string;
  title: string;
  modelId: string;
  mode: string;
  pinned: boolean;
  archived: boolean;
  folder: string;
  projectId: string | null;
  updatedAt: string;
};

export type OmniMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelId: string | null;
  citations: XaiCitation[];
  attachments: OmniAttachment[];
  rating: "up" | "down" | null;
  createdAt: string;
};

export type OmniTurnEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "citation"; citations: XaiCitation[] };

export type OmniTurnResult = {
  text: string;
  prompts: string[];
  citations: XaiCitation[];
  model: string;
  fallback: boolean;
  searched: boolean;
};

type FeedAssistKind =
  | "post"
  | "caption"
  | "hashtags"
  | "rewrite"
  | "translate"
  | "bio"
  | "replies"
  | "calendar";

const SEED_PROMPTS = [
  {
    title: "Rewrite this post",
    category: "Writing",
    body: "Rewrite this NYX post so it sounds like a person, not a brand. Keep it under 80 words:\n\n",
  },
  {
    title: "Three caption styles",
    category: "Social Media",
    body: "Write 3 captions for this: one dry, one warm, one punchy. Then 8 hashtags.\n\n",
  },
  {
    title: "Explain this code",
    category: "Coding",
    body: "Explain this code, list bugs, and suggest a cleaner version:\n\n```\n\n```",
  },
  {
    title: "Research brief",
    category: "Research",
    body: "Research this with live sources. Separate facts vs claims. End with a 5-bullet brief and citations:\n\n",
  },
  {
    title: "Study notes",
    category: "Education",
    body: "Turn this into study notes: key ideas, a quiz of 5 questions, and a one-paragraph recap.\n\n",
  },
  {
    title: "Business teardown",
    category: "Business",
    body: "Analyze this idea: who it's for, why it might fail, 90-day plan, and costs I should expect.\n\n",
  },
  {
    title: "Content calendar",
    category: "Marketing",
    body: "Make a 7-day NYX content calendar around this topic. Each day: post, story, flash idea.\n\n",
  },
  {
    title: "Debug this error",
    category: "Coding",
    body: "Here's the error and the code. What's actually broken and how do I fix it?\n\n",
  },
];

async function logUsage(
  sql: Sql,
  userId: string,
  kind: string,
  modelId: string | null,
  tokensIn = 0,
  tokensOut = 0,
) {
  await sql`
    insert into omni_usage (id, user_id, kind, model_id, tokens_in, tokens_out)
    values (${newId("ou")}, ${userId}, ${kind}, ${modelId}, ${tokensIn}, ${tokensOut})
  `;
}

async function getPrefs(sql: Sql, userId: string): Promise<OmniPrefs> {
  const r = (
    await sql<{
      display_name: string;
      personality: string;
      length_pref: string;
      language: string;
      custom_instructions: string;
      memory_enabled: boolean;
      voice_id: string;
      voice_speed: number | string | null;
      default_model: string;
      search_pref: string | null;
    }>`select * from omni_prefs where user_id = ${userId}`
  )[0];
  if (!r) {
    return {
      displayName: "NYXAI",
      personality: "friendly",
      lengthPref: "medium",
      language: "English",
      customInstructions: "",
      memoryEnabled: true,
      voiceId: "eve",
      voiceSpeed: 1,
      defaultModel: "auto",
      searchPref: "auto",
    };
  }
  const searchPref = r.search_pref === "on" || r.search_pref === "off" ? r.search_pref : "auto";
  return {
    displayName: r.display_name,
    personality: r.personality,
    lengthPref: r.length_pref,
    language: r.language,
    customInstructions: r.custom_instructions,
    memoryEnabled: r.memory_enabled,
    voiceId: r.voice_id,
    voiceSpeed: Number(r.voice_speed) || 1,
    defaultModel: r.default_model,
    searchPref,
  };
}

export const getOmniPrefs = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<OmniPrefs> => {
    return getPrefs(await sqlClient(), context.userId);
  });

export const saveOmniPrefs = createServerFn({ method: "POST" })
  .validator((d: Partial<OmniPrefs>) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const next = { ...(await getPrefs(sql, context.userId)), ...data };
    try {
      await sql`
        insert into omni_prefs (
          user_id, display_name, personality, length_pref, language, custom_instructions,
          memory_enabled, voice_id, voice_speed, default_model, search_pref, updated_at
        ) values (
          ${context.userId}, ${next.displayName}, ${next.personality}, ${next.lengthPref},
          ${next.language}, ${next.customInstructions}, ${next.memoryEnabled}, ${next.voiceId},
          ${next.voiceSpeed}, ${next.defaultModel}, ${next.searchPref}, now()
        )
        on conflict (user_id) do update set
          display_name = excluded.display_name,
          personality = excluded.personality,
          length_pref = excluded.length_pref,
          language = excluded.language,
          custom_instructions = excluded.custom_instructions,
          memory_enabled = excluded.memory_enabled,
          voice_id = excluded.voice_id,
          voice_speed = excluded.voice_speed,
          default_model = excluded.default_model,
          search_pref = excluded.search_pref,
          updated_at = now()
      `;
    } catch {
      await sql`
        insert into omni_prefs (
          user_id, display_name, personality, length_pref, language, custom_instructions,
          memory_enabled, voice_id, voice_speed, default_model, updated_at
        ) values (
          ${context.userId}, ${next.displayName}, ${next.personality}, ${next.lengthPref},
          ${next.language}, ${next.customInstructions}, ${next.memoryEnabled}, ${next.voiceId},
          ${next.voiceSpeed}, ${next.defaultModel}, now()
        )
        on conflict (user_id) do update set
          display_name = excluded.display_name,
          personality = excluded.personality,
          length_pref = excluded.length_pref,
          language = excluded.language,
          custom_instructions = excluded.custom_instructions,
          memory_enabled = excluded.memory_enabled,
          voice_id = excluded.voice_id,
          voice_speed = excluded.voice_speed,
          default_model = excluded.default_model,
          updated_at = now()
      `;
    }
    return { ok: true as const };
  });

export const listOmniThreads = createServerFn({ method: "GET" })
  .validator((d: { archived?: boolean } = {}) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<OmniThread[]> => {
    const sql = await sqlClient();
    const archived = Boolean(data.archived);
    const rows = await sql<{
      id: string;
      title: string;
      model_id: string;
      mode: string;
      pinned: boolean;
      archived: boolean;
      folder: string;
      project_id: string | null;
      updated_at: string;
    }>`
      select id, title, model_id, mode, pinned, archived, folder, project_id, updated_at
      from kai_threads
      where user_id = ${context.userId} and archived = ${archived}
      order by pinned desc, updated_at desc
      limit 80
    `;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      modelId: r.model_id,
      mode: r.mode,
      pinned: r.pinned,
      archived: r.archived,
      folder: r.folder,
      projectId: r.project_id,
      updatedAt: r.updated_at,
    }));
  });

export const createOmniThread = createServerFn({ method: "POST" })
  .validator((d: { modelId?: string; mode?: string; projectId?: string | null; folder?: string } = {}) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const id = newId("kai");
    await sql`
      insert into kai_threads (id, user_id, title, model_id, mode, project_id, folder)
      values (
        ${id}, ${context.userId}, 'New chat', ${data.modelId ?? "auto"}, ${data.mode ?? "chat"},
        ${data.projectId ?? null}, ${data.folder ?? ""}
      )
    `;
    return { id };
  });

export const patchOmniThread = createServerFn({ method: "POST" })
  .validator(
    (d: {
      id: string;
      title?: string;
      pinned?: boolean;
      archived?: boolean;
      folder?: string;
      modelId?: string;
      mode?: string;
      projectId?: string | null;
    }) => d,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const owned = await sql<{ id: string }>`
      select id from kai_threads where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Conversation not found.");
    if (data.title != null) await sql`update kai_threads set title = ${data.title.slice(0, 80)} where id = ${data.id}`;
    if (data.pinned != null) await sql`update kai_threads set pinned = ${data.pinned} where id = ${data.id}`;
    if (data.archived != null) await sql`update kai_threads set archived = ${data.archived} where id = ${data.id}`;
    if (data.folder != null) await sql`update kai_threads set folder = ${data.folder.slice(0, 40)} where id = ${data.id}`;
    if (data.modelId) await sql`update kai_threads set model_id = ${data.modelId} where id = ${data.id}`;
    if (data.mode) await sql`update kai_threads set mode = ${data.mode} where id = ${data.id}`;
    if (data.projectId !== undefined) await sql`update kai_threads set project_id = ${data.projectId} where id = ${data.id}`;
    return { ok: true as const };
  });

export const shareOmniThread = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const shareId = newId("os");
    await sql`
      update kai_threads set share_id = ${shareId}
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { shareId };
  });

export const exportOmniThread = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const thread = await sql<{ title: string }>`
      select title from kai_threads where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!thread[0]) throw new Error("Conversation not found.");
    const msgs = await sql<{ role: string; content: string }>`
      select role, content from kai_messages where thread_id = ${data.id} order by created_at
    `;
    const md = [`# ${thread[0].title}`, "", ...msgs.map((m) => `**${m.role}:**\n\n${m.content}`)].join("\n\n");
    return { title: thread[0].title, markdown: md };
  });

export const listOmniMessages = createServerFn({ method: "GET" })
  .validator((d: { threadId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<OmniMsg[]> => {
    const sql = await sqlClient();
    const owned = await sql<{ n: number }>`
      select count(*)::int as n from kai_threads where id = ${data.threadId} and user_id = ${context.userId}
    `;
    if ((owned[0]?.n ?? 0) === 0) throw new Error("Conversation not found.");
    const rows = await sql<{
      id: string;
      role: "user" | "assistant";
      content: string;
      model_id: string | null;
      citations_json: unknown;
      attachments_json: unknown;
      meta_json: unknown;
      created_at: string;
    }>`
      select id, role, content, model_id, citations_json, attachments_json, meta_json, created_at
      from kai_messages where thread_id = ${data.threadId} order by created_at
    `;
    return rows
      .filter((r) => r.role !== "assistant" || !isCannedOutage(r.content))
      .map((r) => {
      const meta = r.meta_json && typeof r.meta_json === "object" ? (r.meta_json as { rating?: string }) : {};
      const rating = meta.rating === "up" || meta.rating === "down" ? meta.rating : null;
      return {
        id: r.id,
        role: r.role,
        content: r.content,
        modelId: r.model_id,
        citations: Array.isArray(r.citations_json) ? (r.citations_json as XaiCitation[]) : [],
        attachments: Array.isArray(r.attachments_json) ? (r.attachments_json as OmniAttachment[]) : [],
        rating,
        createdAt: r.created_at,
      };
    });
  });

async function loadContext(sql: Sql, userId: string, threadId: string, caps: OmniCaps = omniCaps(false)) {
  const prefs = await getPrefs(sql, userId);
  const thread = await sql<{
    title: string;
    model_id: string;
    mode: string;
    project_id: string | null;
    instructions: string | null;
  }>`
    select title, model_id, mode, project_id, instructions from kai_threads
    where id = ${threadId} and user_id = ${userId}
  `;
  if (!thread[0]) throw new Error("Conversation not found.");
  let memories: { key: string; value: string }[] = [];
  if (prefs.memoryEnabled) {
    memories = await sql<{ key: string; value: string }>`
      select key, value from omni_memory
      where user_id = ${userId} and enabled = true
      order by updated_at desc limit ${caps.memoryLimit}
    `;
  }
  let project: { name: string; files: { name: string; text: string }[] } | null = null;
  if (thread[0].project_id) {
    const p = await sql<{ name: string }>`
      select name from omni_projects where id = ${thread[0].project_id} and user_id = ${userId}
    `;
    if (p[0]) {
      const files = await sql<{ name: string; text_extract: string }>`
        select name, text_extract from omni_project_files
        where project_id = ${thread[0].project_id} order by created_at limit ${caps.workspaceFiles}
      `;
      project = {
        name: p[0].name,
        files: files.map((f) => ({ name: f.name, text: f.text_extract })),
      };
    }
  }
  return { prefs, thread: thread[0], memories, project };
}

export async function runOmniTurn(opts: {
  userId: string;
  threadId: string;
  content: string;
  attachments?: OmniAttachment[];
  mode?: OmniMode | string;
  modelId?: string;
  agent?: string | null;
  aspect?: string;
  style?: string;
  searchPref?: "auto" | "on" | "off";
  onEvent?: (e: OmniTurnEvent) => void;
}): Promise<OmniTurnResult> {
  const sql = await sqlClient();
  const me = await ensureProfile(sql, { id: opts.userId });
  assertNotBanned(me);
  const superActive = await hasSuperOmni(sql, opts.userId);
  const caps = omniCaps(superActive);
  const wait = takeToken(`kai:${opts.userId}`, caps.chatPerMin, 60_000);
  if (wait) throw new Error(rateError(wait));
  const content = opts.content.trim().slice(0, 8_000);
  if (!content && !(opts.attachments ?? []).length) throw new Error("Type a message or attach a file.");
  const ctx = await loadContext(sql, opts.userId, opts.threadId, caps);
  const selectedId = opts.modelId ?? ctx.thread.model_id ?? "auto";
  let mode: OmniMode = ((opts.mode ?? ctx.thread.mode ?? "chat") as OmniMode) || "chat";
  if (mode === "agent") {
    if (opts.agent === "coding") mode = "code";
    else if (opts.agent === "research" || opts.agent === "travel") mode = "research";
    else if (opts.agent === "writing" || opts.agent === "social" || opts.agent === "marketing") mode = "chat";
  }
  const searchPref = opts.searchPref ?? ctx.prefs.searchPref ?? "auto";
  const fileBlock = (opts.attachments ?? []).map(summarizeExtract).join("\n\n");
  const userText = fileBlock ? `${content}\n\n${fileBlock}` : content;
  const history = (
    await sql<{ role: "user" | "assistant"; content: string }>`
      select role, content from kai_messages
      where thread_id = ${opts.threadId}
      order by created_at desc
      limit 40
    `
  )
    .reverse()
    .filter((m) => m.role !== "assistant" || !isCannedOutage(m.content));
  const frustrated = isFrustration(content);
  const openQuestion = lastOpenUserQuestion(history);
  const ask = frustrated && openQuestion ? openQuestion : content;
  const intent = detectIntent(ask, mode);
  const liveSearch = resolveSearch(mode, searchPref, ask);
  const model = applySuperOmni(
    resolveModel(selectedId, liveSearch === "on" && selectedId === "auto" ? "research" : mode, ask),
    superActive,
  );
  const topicChange = frustrated ? false : isTopicChange(content, history);
  const packed = compactHistory(history, Math.max(2, caps.historyKeep - 1), caps.olderChars);
  const outgoing = frustrated && openQuestion ? openQuestion : userText;
  await sql`
    insert into kai_messages (id, thread_id, role, content, attachments_json)
    values (${newId("km")}, ${opts.threadId}, 'user', ${content || "(attachment)"}, ${JSON.stringify(opts.attachments ?? [])}::jsonb)
  `;
  if (ctx.thread.title === "New chat") {
    await sql`update kai_threads set title = ${content.slice(0, 48) || "New chat"} where id = ${opts.threadId}`;
  }
  if (ctx.prefs.memoryEnabled) {
    const mem = extractExplicitMemory(content);
    if (mem) {
      await sql`
        insert into omni_memory (id, user_id, key, value, enabled, updated_at)
        values (${newId("om")}, ${opts.userId}, ${mem.key}, ${mem.value}, true, now())
      `;
    }
  }
  const turns: ChatTurn[] = [
    {
      role: "system",
      content: buildOmniSystem({
        name: ctx.prefs.displayName || "NYXAI",
        personality: ctx.prefs.personality,
        custom: [ctx.prefs.customInstructions, ctx.thread.instructions].filter(Boolean).join("\n"),
        memories: ctx.memories,
        project: ctx.project,
        mode,
        agent: opts.agent,
        length: ctx.prefs.lengthPref,
        language: ctx.prefs.language,
        intent: intent.intent,
        searched: liveSearch === "on",
        older: packed.older.slice(0, caps.olderChars),
        topicChange,
        superOmni: superActive,
        frustrated,
      }),
    },
    ...packed.recent.map((m) => ({
      role: m.role,
      content: m.content.slice(0, 4_000),
    })),
  ];
  const images = (opts.attachments ?? []).filter((a) => a.kind === "image" && a.dataUrl);
  if (images.length) {
    turns.push({
      role: "user",
      content: [
        { type: "text", text: outgoing.slice(0, 6_000) },
        ...images.slice(0, 3).map((img) => ({
          type: "image_url" as const,
          image_url: { url: img.dataUrl! },
        })),
      ],
    });
  } else {
    turns.push({ role: "user", content: outgoing.slice(0, 8_000) });
  }

  let text = "";
  let citations: XaiCitation[] = [];
  let usedModel = model.upstream;
  let searched = false;
  const emit = opts.onEvent ?? (() => {});
  const tools: Array<{ type: string }> = [];
  if (liveSearch === "on") {
    tools.push({ type: "web_search" });
    if (mode === "research" || intent.intent === "research") tools.push({ type: "x_search" });
  }
  if (mode === "code" || intent.intent === "code" || intent.intent === "math" || intent.intent === "analyze") {
    tools.push({ type: "code_interpreter" });
  }
  if ((opts.attachments ?? []).some((a) => a.kind === "table" || a.kind === "doc" || /\.(csv|xlsx|xls|json|tsv)$/i.test(a.name || ""))) {
    if (!tools.some((t) => t.type === "code_interpreter")) tools.push({ type: "code_interpreter" });
  }
  const spec = {
    model: model.upstream,
    fallbackModel: model.fallback,
    maxTokens: model.maxTokens,
    temperature: model.temperature,
    reasoningEffort: model.reasoning,
    search: liveSearch,
    tools,
  };

  if (intent.intent === "video" || mode === "video") {
    emit({ type: "status", text: "Starting video generation…" });
    const videoWait = takeToken(`omni-video:${opts.userId}`, caps.videosPerHour, 60 * 60 * 1000);
    if (videoWait) throw new Error(rateError(videoWait));
    const { liveGenerateVideo } = await import("../live-media");
    const video = await liveGenerateVideo({
      prompt: content,
      aspect: opts.aspect === "9:16" ? "9:16" : "16:9",
      onStatus: (s) => emit({ type: "status", text: s }),
    });
    if (!video.ok) {
      await logUsage(sql, opts.userId, "error", "video", 0, 0);
      throw new Error(video.error);
    }
    text = `Here's the video.\n\n![video](${video.url})`;
    usedModel = video.model;
    emit({ type: "delta", text });
    await logUsage(sql, opts.userId, "video", video.model, 0, 0);
  } else if (
    intent.intent === "image" ||
    wantsImage(content) ||
    (mode === "image" && !isGreeting(content) && content.trim().length > 8)
  ) {
    emit({ type: "status", text: "Generating image…" });
    const imgWait = takeToken(`omni-img:${opts.userId}`, caps.imagesPerHour, 60 * 60 * 1000);
    if (imgWait) throw new Error(rateError(imgWait));
    const refs = (opts.attachments ?? []).filter((a) => a.kind === "image" && a.dataUrl).map((a) => a.dataUrl!);
    const { liveGenerateImage } = await import("../live-media");
    const img = await liveGenerateImage({
      prompt: content,
      aspect: opts.aspect || "1:1",
      style: opts.style,
      references: refs,
    });
    if (!img.ok) {
      await logUsage(sql, opts.userId, "error", "imagine", 0, 0);
      throw new Error(img.error);
    }
    text = `Here's an image for that.\n\n![generated](${img.url})`;
    usedModel = img.model;
    emit({ type: "delta", text });
    await logUsage(sql, opts.userId, "image", img.model, 0, 0);
    await sql`
      insert into memories (id, user_id, media_url, media_kind, caption)
      values (${newId("mm")}, ${opts.userId}, ${img.url}, 'photo', ${content.slice(0, 120)})
    `;
  }

  if (!text) {
    emit({ type: "status", text: "Generating response…" });
    const cleanHistory = history
      .filter((m) => m.role === "user" || !isCannedOutage(m.content))
      .map((m) => ({ role: m.role, content: m.content }));
    const { nyxChat } = await import("./nyx-brain");
    const spoken = await nyxChat({
      userText: outgoing,
      history: cleanHistory,
      onDelta: opts.onEvent ? (chunk) => emit({ type: "delta", text: chunk }) : undefined,
    });
    text = spoken.text;
    usedModel = spoken.model;
    await logUsage(sql, opts.userId, "chat", spoken.model, 0, spoken.text.length);
  }

  const parsed = parseOmniTail(text);
  const finalText = (parsed.text || text).trim();
  if (!finalText) throw new Error("NYXAI could not answer. Tap Retry.");
  await sql`
    insert into kai_messages (id, thread_id, role, content, model_id, citations_json)
    values (
      ${newId("km")}, ${opts.threadId}, 'assistant', ${finalText}, ${usedModel},
      ${JSON.stringify(citations)}::jsonb
    )
  `;
  await sql`update kai_threads set updated_at = now(), mode = ${opts.mode ?? mode}, model_id = ${selectedId} where id = ${opts.threadId}`;
  return {
    text: finalText,
    prompts: parsed.prompts,
    citations,
    model: usedModel,
    fallback: false,
    searched,
  };
}

export const sendOmniMessage = createServerFn({ method: "POST" })
  .validator(
    (d: {
      threadId: string;
      content: string;
      attachments?: OmniAttachment[];
      mode?: OmniMode;
      modelId?: string;
      agent?: string | null;
      aspect?: string;
      style?: string;
      searchPref?: "auto" | "on" | "off";
    }) => d,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return runOmniTurn({
      userId: context.userId,
      threadId: data.threadId,
      content: data.content,
      attachments: data.attachments,
      mode: data.mode,
      modelId: data.modelId,
      agent: data.agent,
      aspect: data.aspect,
      style: data.style,
      searchPref: data.searchPref,
    });
  });

/** Plain chat. One provider call, no tools, no history poisoning. */
export const quickNyxReply = createServerFn({ method: "POST" })
  .validator((d: { threadId: string; content: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const content = data.content.trim().slice(0, 8_000);
    if (!content) throw new Error("Type a message.");
    const { nyxChat } = await import("./nyx-brain");
    const spoken = await nyxChat({ userText: content, history: [] });
    const text = spoken.text.trim();
    if (!text) throw new Error("NYXAI could not answer. Tap Retry.");
    try {
      const sql = await sqlClient();
      await sql`
        insert into kai_messages (id, thread_id, role, content, attachments_json)
        values (${newId("km")}, ${data.threadId}, 'user', ${content}, '[]'::jsonb)
      `;
      await sql`
        insert into kai_messages (id, thread_id, role, content, model_id, citations_json)
        values (${newId("km")}, ${data.threadId}, 'assistant', ${text}, ${spoken.model}, '[]'::jsonb)
      `;
      await sql`
        update kai_threads set updated_at = now(), title = case when title = 'New chat' then ${content.slice(0, 48)} else title end
        where id = ${data.threadId} and user_id = ${context.userId}
      `;
    } catch {
      /* The answer is still returned if the save fails. */
    }
    return {
      text,
      prompts: [] as string[],
      citations: [] as XaiCitation[],
      model: spoken.model,
      fallback: false,
    };
  });

export const aiProviderStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { providerOrder, refreshProviderStatus } = await import("./ai-router");
    return { providers: await refreshProviderStatus(), order: providerOrder() };
  });

export const regenerateOmni = createServerFn({ method: "POST" })
  .validator((d: { threadId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const last = await sql<{ id: string; role: string; content: string }>`
      select id, role, content from kai_messages
      where thread_id = ${data.threadId}
      order by created_at desc limit 2
    `;
    const assistant = last.find((m) => m.role === "assistant");
    const user = last.find((m) => m.role === "user") ?? last[1];
    if (assistant) await sql`delete from kai_messages where id = ${assistant.id}`;
    if (!user || user.role !== "user") throw new Error("Nothing to regenerate.");
    await sql`delete from kai_messages where id = ${user.id}`;
    const thread = await sql<{ model_id: string; mode: string }>`
      select model_id, mode from kai_threads where id = ${data.threadId} and user_id = ${context.userId}
    `;
    return runOmniTurn({
      userId: context.userId,
      threadId: data.threadId,
      content: user.content,
      modelId: thread[0]?.model_id,
      mode: thread[0]?.mode || "chat",
    });
  });

export const editOmniUser = createServerFn({ method: "POST" })
  .validator((d: { threadId: string; messageId: string; content: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const row = await sql<{ created_at: string; role: string }>`
      select created_at, role from kai_messages
      where id = ${data.messageId} and thread_id = ${data.threadId}
    `;
    if (!row[0] || row[0].role !== "user") throw new Error("Message not found.");
    await sql`
      delete from kai_messages
      where thread_id = ${data.threadId} and created_at >= ${row[0].created_at}
    `;
    const thread = await sql<{ model_id: string; mode: string }>`
      select model_id, mode from kai_threads where id = ${data.threadId} and user_id = ${context.userId}
    `;
    return runOmniTurn({
      userId: context.userId,
      threadId: data.threadId,
      content: data.content,
      modelId: thread[0]?.model_id,
      mode: thread[0]?.mode || "chat",
    });
  });

export const listOmniMemory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    return sql<{ id: string; key: string; value: string; enabled: boolean }>`
      select id, key, value, enabled from omni_memory
      where user_id = ${context.userId} order by updated_at desc limit 50
    `;
  });

export const saveOmniMemory = createServerFn({ method: "POST" })
  .validator((d: { id?: string; key: string; value: string; enabled?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const id = data.id ?? newId("om");
    await sql`
      insert into omni_memory (id, user_id, key, value, enabled, updated_at)
      values (${id}, ${context.userId}, ${data.key.slice(0, 80)}, ${data.value.slice(0, 500)}, ${data.enabled ?? true}, now())
      on conflict (id) do update set
        key = excluded.key, value = excluded.value, enabled = excluded.enabled, updated_at = now()
    `;
    return { id };
  });

export const deleteOmniMemory = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`delete from omni_memory where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listOmniProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    return sql<{ id: string; name: string; description: string; updated_at: string }>`
      select id, name, description, updated_at from omni_projects
      where user_id = ${context.userId} order by updated_at desc limit 30
    `;
  });

export const upsertOmniProject = createServerFn({ method: "POST" })
  .validator((d: { id?: string; name: string; description?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const id = data.id ?? newId("op");
    await sql`
      insert into omni_projects (id, user_id, name, description, updated_at)
      values (${id}, ${context.userId}, ${data.name.slice(0, 60)}, ${(data.description ?? "").slice(0, 400)}, now())
      on conflict (id) do update set name = excluded.name, description = excluded.description, updated_at = now()
    `;
    return { id };
  });

export const addOmniProjectFile = createServerFn({ method: "POST" })
  .validator((d: { projectId: string; file: OmniAttachment }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const owned = await sql<{ n: number }>`
      select count(*)::int as n from omni_projects where id = ${data.projectId} and user_id = ${context.userId}
    `;
    if ((owned[0]?.n ?? 0) === 0) throw new Error("Project not found.");
    const id = newId("of");
    await sql`
      insert into omni_project_files (id, project_id, name, mime, kind, text_extract, data_url, bytes)
      values (
        ${id}, ${data.projectId}, ${data.file.name.slice(0, 120)}, ${data.file.mime},
        ${data.file.kind}, ${data.file.text.slice(0, 8e4)}, ${data.file.dataUrl ?? null}, ${data.file.bytes}
      )
    `;
    await sql`update omni_projects set updated_at = now() where id = ${data.projectId}`;
    return { id };
  });

export const listOmniProjectFiles = createServerFn({ method: "GET" })
  .validator((d: { projectId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const owned = await sql<{ n: number }>`
      select count(*)::int as n from omni_projects where id = ${data.projectId} and user_id = ${context.userId}
    `;
    if ((owned[0]?.n ?? 0) === 0) throw new Error("Project not found.");
    return sql<{ id: string; name: string; kind: string; bytes: number }>`
      select id, name, kind, bytes from omni_project_files
      where project_id = ${data.projectId} order by created_at
    `;
  });

export const listOmniPrompts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const mine = await sql<{ id: string; title: string; body: string; category: string; favorite: boolean }>`
      select id, title, body, category, favorite from omni_prompts
      where user_id = ${context.userId} order by favorite desc, created_at desc
    `;
    if (mine.length) {
      const extras = SEED_PROMPTS.filter((s) => !mine.some((m) => m.title === s.title)).map((p, i) => ({
        id: `seed_${i}`,
        title: p.title,
        body: p.body,
        category: p.category,
        favorite: false,
      }));
      return [...mine, ...extras];
    }
    return SEED_PROMPTS.map((p, i) => ({
      id: `seed_${i}`,
      title: p.title,
      body: p.body,
      category: p.category,
      favorite: false,
    }));
  });

export const saveOmniPrompt = createServerFn({ method: "POST" })
  .validator((d: { id?: string; title: string; body: string; category: string; favorite?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const id = data.id && !data.id.startsWith("seed_") ? data.id : newId("pr");
    await sql`
      insert into omni_prompts (id, user_id, title, body, category, favorite)
      values (${id}, ${context.userId}, ${data.title.slice(0, 80)}, ${data.body.slice(0, 4e3)}, ${data.category}, ${data.favorite ?? false})
      on conflict (id) do update set title = excluded.title, body = excluded.body, category = excluded.category, favorite = excluded.favorite
    `;
    return { id };
  });

export const deleteOmniPrompt = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`delete from omni_prompts where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export async function runFeedAssist(
  userId: string,
  kind: FeedAssistKind | string,
  text: string,
  extra?: string,
): Promise<{ ok: true; text: string }> {
  const wait = takeToken(`kaihelp:${userId}`, 40, 60_000);
  if (wait) throw new Error(rateError(wait));
  const prompts: Record<string, string> = {
    post: "Write a complete NYX post from this. 2–4 short paragraphs, human, no hashtags yet.",
    caption: "Write 3 caption variants (dry / warm / punchy) for this.",
    hashtags: "Suggest 10 relevant hashtags, lowercase, no spaces. One line.",
    rewrite: "Rewrite this so it sounds like a person. Keep the meaning.",
    translate: `Translate this into ${extra || "English"}. Keep the tone.`,
    bio: "Write a 1–2 sentence NYX bio.",
    replies: "Suggest 3 replies: kind, witty, short. Label them.",
    calendar: "Make a 7-day NYX content plan. Day, post, story, flash.",
  };
  const prompt = `${prompts[kind] ?? prompts.post}\n\n${text}`;
  const spec = getModel("creative");
  const { runOmniModel } = await import("../xai");
  const remote = await runOmniModel(
    [
      {
        role: "system",
        content: buildOmniSystem({
          name: "NYXAI",
          personality: "creative",
          custom: "",
          memories: [],
          mode: "chat",
          length: "medium",
          language: "English",
        }),
      },
      { role: "user", content: prompt },
    ],
    {
      model: spec.upstream,
      fallbackModel: spec.fallback,
      maxTokens: 900,
      temperature: 0.95,
      reasoningEffort: "low",
      search: kind === "calendar" ? "auto" : "off",
    },
  );
  if (!remote.ok || !remote.text.trim()) {
    throw new Error(providerFailureMessage(remote.ok ? "empty" : remote.error, "text"));
  }
  return { ok: true, text: parseOmniTail(remote.text).text };
}

export const omniFeedAssist = createServerFn({ method: "POST" })
  .validator((d: { kind: FeedAssistKind | string; text: string; extra?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return runFeedAssist(context.userId, data.kind, data.text, data.extra);
  });

export const omniStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const superActive = await hasSuperOmni(sql, context.userId).catch(() => false);
    const { keyPoolStatus } = await import("./api-keys");
    return {
      connected: keyPoolStatus().length > 0,
      superOmni: superActive,
    };
  });

export const rateOmniMessage = createServerFn({ method: "POST" })
  .validator((d: { messageId: string; rating: "up" | "down" | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const row = await sql<{ id: string; thread_id: string; meta_json: unknown }>`
      select m.id, m.thread_id, m.meta_json
      from kai_messages m
      join kai_threads t on t.id = m.thread_id
      where m.id = ${data.messageId} and t.user_id = ${context.userId}
    `;
    if (!row[0]) throw new Error("Message not found.");
    const prev = row[0].meta_json && typeof row[0].meta_json === "object" ? (row[0].meta_json as Record<string, unknown>) : {};
    const next = { ...prev, rating: data.rating };
    await sql`update kai_messages set meta_json = ${JSON.stringify(next)}::jsonb where id = ${data.messageId}`;
    try {
      if (data.rating) {
        await sql`
          insert into omni_feedback (id, user_id, message_id, rating)
          values (${newId("fb")}, ${context.userId}, ${data.messageId}, ${data.rating})
          on conflict (user_id, message_id) do update set rating = excluded.rating
        `;
      } else {
        await sql`delete from omni_feedback where user_id = ${context.userId} and message_id = ${data.messageId}`;
      }
    } catch {
      /* feedback table may be missing in older schemas */
    }
    await logUsage(
      sql,
      context.userId,
      data.rating === "up" ? "rate_up" : data.rating === "down" ? "rate_down" : "rate_clear",
      null,
      0,
      0,
    );
    return { ok: true as const };
  });

export const myOmniUsage = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const superActive = await hasSuperOmni(sql, context.userId).catch(() => false);
    const caps = omniCaps(superActive);
    return {
      hours: 24,
      rows: await sql<{ kind: string; n: number }>`
        select kind, count(*)::int as n
        from omni_usage
        where user_id = ${context.userId} and created_at > now() - interval '1 day'
        group by kind
      `,
      caps: {
        chatPerMin: caps.chatPerMin,
        imagesPerHour: caps.imagesPerHour,
        videosPerHour: caps.videosPerHour,
        ttsPerHour: caps.ttsPerHour,
      },
      superOmni: superActive,
    };
  });

export const omniUsageSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    requireSafety(me);
    const { keyPoolStatus } = await import("./api-keys");
    const keys = keyPoolStatus();
    return {
      days: 7,
      rows: await sql<{ kind: string; n: number; tokens: number }>`
        select kind, count(*)::int as n, coalesce(sum(tokens_out),0)::int as tokens
        from omni_usage
        where created_at > now() - interval '7 days'
        group by kind
      `,
      connected: keys.length > 0,
      keys: keys.map((slot) => ({
        id: slot.id,
        provider: slot.provider,
        mask: slot.mask,
        status: slot.cooling ? "Cooling" : "Active",
        requests: slot.requests,
        errors: slot.errors,
      })),
    };
  });

export const deleteOmniThread = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`delete from kai_threads where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const getSharedOmni = createServerFn({ method: "GET" })
  .validator((d: { shareId: string }) => d)
  .handler(async ({ data }) => {
    const sql = await sqlClient();
    const thread = await sql<{ id: string; title: string; updated_at: string }>`
      select id, title, updated_at from kai_threads where share_id = ${data.shareId}
    `;
    if (!thread[0]) throw new Error("This shared chat is no longer available.");
    const messages = await sql<{ role: string; content: string; created_at: string }>`
      select role, content, created_at from kai_messages
      where thread_id = ${thread[0].id}
      order by created_at
    `;
    return {
      title: thread[0].title,
      updatedAt: thread[0].updated_at,
      messages,
    };
  });
