/** In-process provider health. One open circuit never blocks the other catalogs. */

export type ProviderHealth = {
  provider: string;
  status: "ok" | "open";
  failures: number;
  lastStatus: number | null;
  lastMs: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  openUntil: number;
};

const book = new Map<string, ProviderHealth>();

function row(provider: string): ProviderHealth {
  let current = book.get(provider);
  if (!current) {
    current = {
      provider,
      status: "ok",
      failures: 0,
      lastStatus: null,
      lastMs: null,
      lastSuccessAt: null,
      lastError: null,
      openUntil: 0,
    };
    book.set(provider, current);
  }
  return current;
}

export function snapshotProviderHealth(): ProviderHealth[] {
  const now = Date.now();
  return [...book.values()].map((item) => ({
    ...item,
    status: item.status === "open" && now >= item.openUntil ? "ok" : item.status,
  }));
}

export function providerAvailable(provider: string): boolean {
  const current = row(provider);
  if (current.status === "open" && Date.now() < current.openUntil) return false;
  if (current.status === "open") {
    current.status = "ok";
    current.failures = 0;
  }
  return true;
}

function endpointPath(url: string): string {
  try {
    return new URL(url).pathname.slice(0, 160);
  } catch {
    return "/";
  }
}

function logProvider(input: {
  provider: string;
  url: string;
  status: number | null;
  ms: number;
  error?: string;
  trackId?: string;
}): void {
  const requestId = Math.random().toString(36).slice(2, 10);
  console.info(
    JSON.stringify({
      kind: "music-provider",
      provider: input.provider,
      endpoint: endpointPath(input.url),
      status: input.status,
      ms: input.ms,
      error: input.error || null,
      trackId: input.trackId || null,
      requestId,
    }),
  );
}

function noteFailure(provider: string, status: number | null, ms: number, error: string): void {
  const current = row(provider);
  current.failures += 1;
  current.lastStatus = status;
  current.lastMs = ms;
  current.lastError = error.slice(0, 180);
  if (current.failures >= 3) {
    current.status = "open";
    current.openUntil = Date.now() + 45_000;
  }
}

function noteSuccess(provider: string, status: number, ms: number): void {
  const current = row(provider);
  current.failures = 0;
  current.status = "ok";
  current.openUntil = 0;
  current.lastStatus = status;
  current.lastMs = ms;
  current.lastSuccessAt = Date.now();
  current.lastError = null;
}

export function providerFailureMessage(provider: string, error: unknown): string {
  const name = provider.slice(0, 24);
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 0;
  if (status === 429) return `${name} rate limit reached. Trying another source.`;
  if (error instanceof Error && /paused/i.test(error.message)) return `${name} is temporarily unavailable. Trying another source.`;
  if (error instanceof Error && error.name === "AbortError") return `${name} timed out. Trying another source.`;
  return `${name} is temporarily unavailable. Trying another source.`;
}

/** Fetch JSON with one backoff retry on 429/5xx. Logs path and status only — never the query string. */
export async function providerFetch(provider: string, url: string, ms = 8000, trackId?: string): Promise<unknown> {
  if (!providerAvailable(provider)) {
    throw Object.assign(new Error(`${provider} is temporarily paused after repeated failures.`), { status: 503 });
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try {
      const response = await fetch(url, {
        signal: ac.signal,
        headers: { Accept: "application/json", "User-Agent": "NYX/1.0 (music catalog)" },
      });
      const elapsed = Date.now() - started;
      if (response.status === 429 || response.status >= 500) {
        logProvider({ provider, url, status: response.status, ms: elapsed, error: "retryable", trackId });
        noteFailure(provider, response.status, elapsed, `HTTP ${response.status}`);
        lastError = Object.assign(new Error(`${provider} returned ${response.status}`), { status: response.status });
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, response.status === 429 ? 700 : 300));
          continue;
        }
        throw lastError;
      }
      if (!response.ok) {
        logProvider({ provider, url, status: response.status, ms: elapsed, error: "http", trackId });
        noteFailure(provider, response.status, elapsed, `HTTP ${response.status}`);
        throw Object.assign(new Error(`${provider} returned ${response.status}`), { status: response.status });
      }
      const json: unknown = await response.json();
      logProvider({ provider, url, status: response.status, ms: elapsed, trackId });
      noteSuccess(provider, response.status, elapsed);
      return json;
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) throw error;
      const elapsed = Date.now() - started;
      const name = error instanceof Error ? error.name : "error";
      logProvider({ provider, url, status: null, ms: elapsed, error: name, trackId });
      noteFailure(provider, null, elapsed, name);
      if (name === "AbortError" && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        lastError = error;
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${provider} is temporarily unavailable.`);
}
