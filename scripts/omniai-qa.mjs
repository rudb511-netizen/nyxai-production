import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const stamp = Date.now().toString(36).slice(-5);
const U = {
  email: `omni${stamp}@example.com`,
  username: `omni${stamp}`,
  name: "Omni Tester",
  password: "OmniFeed2026!",
};

mkdirSync("/workspace/screenshots", { recursive: true });

async function nativeFill(page, selector, value) {
  await page.evaluate(
    ({ selector, value }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error("missing " + selector);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { selector, value },
  );
}

async function dump(page, name) {
  try {
    await page.screenshot({ path: `/workspace/screenshots/${name}.png`, fullPage: true });
  } catch {
    /* ignore */
  }
}

async function register(page) {
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.locator("#email").waitFor({ timeout: 15000 });
  await page.fill("#email", U.email);
  await page.fill("#password", U.password);
  await page.fill("#confirm-password", U.password);
  await page.fill("#username", U.username);
  await page.fill("#display-name", U.name);
  await page.getByRole("button", { name: "Female" }).click();
  await page.fill("#dob", "1995-06-15");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/register"), { timeout: 45000 });
  await page.getByRole("link", { name: "Home" }).waitFor({ timeout: 20000 });
}

async function ask(page, text) {
  const box = page.locator("#omni-ask");
  await box.waitFor({ timeout: 15000 });
  const before = await page.locator('[data-omni-role="assistant"]').count();
  await nativeFill(page, "#omni-ask", text);
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Stop" }).waitFor({ timeout: 8000 }).catch(() => {});
  const start = Date.now();
  while (Date.now() - start < 50000) {
    const busy = await page.getByRole("button", { name: "Stop" }).count();
    const after = await page.locator('[data-omni-role="assistant"]').count();
    const draft = await page.locator('[data-omni-role="assistant"]').count();
    if (busy === 0 && (after > before || draft > before)) {
      await page.waitForTimeout(700);
      return page.locator("body").innerText();
    }
    await page.waitForTimeout(500);
  }
  return page.locator("body").innerText();
}

async function lastAssistant(page) {
  const nodes = page.locator('[data-omni-role="assistant"]');
  const n = await nodes.count();
  if (!n) return "";
  return nodes.nth(n - 1).innerText();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(32000);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  try {
    await register(page);
    await page.goto(`${BASE}/kai`, { waitUntil: "domcontentloaded" });
    await page.locator("#omni-ask").waitFor({ timeout: 20000 });

    const dating = await ask(page, "I need dating advice about my crush");
    if (/Something went wrong|Minified React error|#300/i.test(dating)) {
      await dump(page, "omniai-crash-dating");
      throw new Error("OmniAI crashed on dating turn");
    }
    const dReply = await lastAssistant(page);
    if (!dReply.trim()) throw new Error("No dating reply");

    const imageTurn = await ask(page, "Generate a picture of a car");
    await dump(page, "omniai-car-after-dating");
    const iReply = await lastAssistant(page);
    if (/dating|crush|true sentence/i.test(iReply)) {
      throw new Error("OmniAI kept talking about dating after an image request: " + iReply.slice(0, 240));
    }
    if (!/image|car|generated/i.test(iReply) && !(await page.locator('[data-omni-role="assistant"] img').count())) {
      throw new Error("OmniAI did not handle the image request: " + iReply.slice(0, 240));
    }

    const factTurn = await ask(page, "What is photosynthesis?");
    await dump(page, "omniai-photosynthesis");
    const fReply = await lastAssistant(page);
    if (/dating|crush|true sentence|which layer/i.test(fReply)) {
      throw new Error("OmniAI ignored photosynthesis: " + fReply.slice(0, 240));
    }
    if (!/plant|chlorophyll|light|carbon|sugar|photosynth/i.test(fReply)) {
      throw new Error("OmniAI did not answer photosynthesis: " + fReply.slice(0, 280));
    }

    const leaked = `${dating}\n${imageTurn}\n${factTurn}`;
    if (/\bcredit\b|paywall|xai|grok-4/i.test(leaked)) {
      throw new Error("Credit or provider copy leaked");
    }
    const fatal = pageErrors.filter((m) => /#300|hooks|Minified React/i.test(m));
    if (fatal.length) throw new Error(fatal.join(" | "));
    console.log("OMNIAI_QA_OK", { user: U.username, dating: dReply.slice(0, 80), image: iReply.slice(0, 80), fact: fReply.slice(0, 80) });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
