/** Live lookups that do not depend on the chat model. Server-only. */

export type WebHit = { title: string; text: string; url: string };

function topicOf(query: string): string {
  return query
    .replace(/^(what(?:'s| is)|who(?:'s| is)|what's|tell me about|define|explain|look up|search for)\s+/i, "")
    .replace(/[?!.]+$/g, "")
    .trim()
    .slice(0, 80);
}

export async function lookupWeb(query: string): Promise<WebHit | null> {
  const topic = topicOf(query);
  if (topic.length < 2) return null;
  const wiki = await wikiSummary(topic);
  if (wiki) return wiki;
  return duckDuck(query);
}

export async function lookupWebMulti(query: string): Promise<WebHit[]> {
  const topic = topicOf(query);
  const hits: WebHit[] = [];
  const seen = new Set<string>();
  const add = (h: WebHit | null) => {
    if (!h) return;
    const key = h.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(h);
  };
  add(await wikiSummary(topic));
  add(await duckDuck(query));
  if (hits.length < 2 && topic.includes(" ")) {
    const alt = topic.split(" ").slice(0, 3).join(" ");
    if (alt !== topic) add(await wikiSummary(alt));
  }
  return hits;
}

async function wikiSummary(topic: string): Promise<WebHit | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
      {
        headers: { Accept: "application/json", "User-Agent": "NYX/1.0" },
        signal: AbortSignal.timeout(5500),
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      title?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
      type?: string;
    };
    if (j.type === "disambiguation") return null;
    const text = (j.extract ?? "").trim();
    if (text.length < 40) return null;
    return {
      title: j.title || topic,
      text: text.slice(0, 900),
      url: j.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(topic)}`,
    };
  } catch {
    return null;
  }
}

async function duckDuck(query: string): Promise<WebHit | null> {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5500) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };
    if (j.AbstractText && j.AbstractText.length > 40) {
      return {
        title: j.Heading || query,
        text: j.AbstractText.slice(0, 900),
        url: j.AbstractURL || "https://duckduckgo.com",
      };
    }
    const rel = j.RelatedTopics?.find((t) => t.Text && t.FirstURL);
    if (rel?.Text && rel.FirstURL) {
      return { title: j.Heading || query, text: rel.Text.slice(0, 900), url: rel.FirstURL };
    }
    return null;
  } catch {
    return null;
  }
}
