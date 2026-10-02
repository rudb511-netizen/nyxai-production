import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCannedOutage, providerFailureMessage } from "./ai-errors.ts";
import {
  extractXaiCitations,
  extractXaiText,
  hasXaiKey,
  isRetryableXaiCode,
  mapXaiHttpError,
  noteLiveFailure,
  NYXAI_UNAVAILABLE,
  nyxaiBackoffMs,
  redactXaiSecrets,
  resetLiveCircuit,
  runOmniModel,
  shouldCallLiveModel,
} from "./xai.ts";

describe("mapXaiHttpError", () => {
  it("maps spending-limit 403 to credits for logs", () => {
    const r = mapXaiHttpError(
      403,
      JSON.stringify({
        code: "personal-team-blocked:spending-limit",
        error: "You have run out of credits or need a Grok subscription.",
      }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "credits");
    }
  });

  it("maps a generic 403 as upstream, not a spending lock", () => {
    const r = mapXaiHttpError(403, '{"error":"model temporarily unavailable"}');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "upstream");
  });

  it("maps 401 to auth", () => {
    const r = mapXaiHttpError(401, '{"error":"Incorrect API key"}');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "auth");
  });

  it("maps 429 to rate", () => {
    const r = mapXaiHttpError(429, '{"error":"rate limit"}');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "rate");
  });

  it("maps 400/invalid model as non-retryable invalid", () => {
    const r = mapXaiHttpError(400, '{"error":"Invalid model"}');
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "invalid");
      assert.equal(isRetryableXaiCode(r.code), false);
    }
  });
});

describe("extractXaiText", () => {
  it("reads string content", () => {
    assert.equal(
      extractXaiText({ choices: [{ message: { content: "  Hello there.  " } }] }),
      "Hello there.",
    );
  });

  it("reads array content parts", () => {
    assert.equal(
      extractXaiText({
        choices: [{ message: { content: [{ type: "text", text: "Part " }, { text: "two" }] } }],
      }),
      "Part two",
    );
  });

  it("reads responses output_text", () => {
    assert.equal(extractXaiText({ output_text: "From responses." }), "From responses.");
  });

  it("returns empty when the model only reasoned", () => {
    assert.equal(extractXaiText({ choices: [{ message: { content: "" } }] }), "");
  });
});

describe("live circuit", () => {
  it("does not skip later turns after a spending failure", () => {
    resetLiveCircuit();
    noteLiveFailure("credits");
    assert.equal(shouldCallLiveModel(), hasXaiKey());
    resetLiveCircuit();
  });
});

describe("retry helpers", () => {
  it("retries rate, upstream, and empty only", () => {
    assert.equal(isRetryableXaiCode("rate"), true);
    assert.equal(isRetryableXaiCode("upstream"), true);
    assert.equal(isRetryableXaiCode("empty"), true);
    assert.equal(isRetryableXaiCode("auth"), false);
    assert.equal(isRetryableXaiCode("credits"), false);
    assert.equal(isRetryableXaiCode("no_key"), false);
    assert.equal(isRetryableXaiCode("invalid"), false);
  });

  it("backs off exponentially", () => {
    assert.equal(nyxaiBackoffMs(0), 400);
    assert.equal(nyxaiBackoffMs(1), 800);
    assert.equal(nyxaiBackoffMs(2), 1600);
  });
});

describe("redactXaiSecrets", () => {
  it("strips xAI keys and bearer tokens", () => {
    const out = redactXaiSecrets("Bearer xai-abcdefghijklmnopqrstuv Authorization: Bearer secret");
    assert.doesNotMatch(out, /xai-[A-Za-z]/);
    assert.doesNotMatch(out, /Bearer secret/i);
    assert.match(out, /redacted/i);
  });
});

describe("runOmniModel without a key", () => {
  it("returns the unavailable copy and does not invent an answer", async () => {
    const prev = process.env.XAI_API_KEY;
    const gemini = process.env.GEMINI_API_KEY;
    const google = process.env.GOOGLE_API_KEY;
    const skip = process.env.NYX_SKIP_ENV_FILE;
    delete process.env.XAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    process.env.NYX_SKIP_ENV_FILE = "1";
    try {
      const r = await runOmniModel([{ role: "user", content: "Hi" }], { model: "grok-4.5" });
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.code, "no_key");
        assert.equal(r.error, NYXAI_UNAVAILABLE);
        assert.doesNotMatch(r.error, /credit|paywall|subscription|api key/i);
      }
    } finally {
      if (prev !== undefined) process.env.XAI_API_KEY = prev;
      else delete process.env.XAI_API_KEY;
      if (gemini !== undefined) process.env.GEMINI_API_KEY = gemini;
      else delete process.env.GEMINI_API_KEY;
      if (google !== undefined) process.env.GOOGLE_API_KEY = google;
      else delete process.env.GOOGLE_API_KEY;
      if (skip !== undefined) process.env.NYX_SKIP_ENV_FILE = skip;
      else delete process.env.NYX_SKIP_ENV_FILE;
    }
  });
});

describe("extractXaiCitations", () => {
  it("reads API citations only", () => {
    const c = extractXaiCitations({
      citations: ["https://example.com/a", { url: "https://news.example/b", title: "News" }],
    });
    assert.equal(c.length, 2);
    assert.equal(c[1]?.title, "News");
  });

  it("reads annotation url_citation", () => {
    const c = extractXaiCitations({
      output: [
        {
          content: [
            {
              annotations: [{ type: "url_citation", url_citation: { url: "https://src.test/x", title: "Src" } }],
            },
          ],
        },
      ],
    });
    assert.equal(c[0]?.url, "https://src.test/x");
  });

  it("does not invent citations from answer text", () => {
    const c = extractXaiCitations({
      output_text: "See https://made-up.example/nope",
      choices: [{ message: { content: "See https://made-up.example/nope" } }],
    });
    assert.equal(c.length, 0);
  });
});

describe("providerFailureMessage", () => {
  it("does not call a provider quota an in-app credit pause", () => {
    const image = providerFailureMessage("free_tier limit: 0 spending-limit", "image");
    const video = providerFailureMessage("RESOURCE_EXHAUSTED limit: 0", "video");
    assert.match(image, /Image generation failed/);
    assert.match(video, /Video generation failed/);
    assert.doesNotMatch(image, /paused because this app is out of credits/i);
    assert.doesNotMatch(video, /paused because this app is out of credits/i);
  });

  it("detects the canned credit-pause reply", () => {
    assert.equal(
      isCannedOutage("OmniAI is paused because this app is out of credits. Try again after credits are restored."),
      true,
    );
    assert.equal(isCannedOutage("Hello! I am NYXAI. How can I help you today?"), false);
  });

  it("tells a timed-out text request to retry", () => {
    assert.match(providerFailureMessage("request timed out", "text"), /timed out/i);
  });
});
