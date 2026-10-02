import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const stamp = Date.now().toString(36).slice(-5);
const U = {
  email: `omni${stamp}@example.com`,
  username: `omni${stamp}`,
  name: "Omni Repair",
  password: "OmniFeed2026!",
};

mkdirSync("/workspace/screenshots", { recursive: true });

function nativeFill(page, selector, value) {
  return page.evaluate(({ selector, value }) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error("missing " + selector);
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, { selector, value });
}

async function dump(page, name) {
  try {
    await page.screenshot({ path: `/workspace/screenshots/${name}.png`, fullPage: true });
    writeFileSync(`/workspace/screenshots/${name}.html`, (await page.content()).slice(0, 80_000));
  } catch {
    /* ignore */
  }
}

async function register(page) {
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await nativeFill(page, "#email", U.email);
  await nativeFill(page, "#password", U.password);
  await nativeFill(page, "#confirm-password", U.password);
  await nativeFill(page, "#username", U.username);
  await nativeFill(page, "#display-name", U.name);
  await page.getByRole("button", { name: "Female" }).click();
  await nativeFill(page, "#dob", "1995-06-15");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/register"), { timeout: 25000 });
}

async function waitReady(page) {
  const box = page.locator("#omni-ask");
  await box.waitFor({ state: "visible", timeout: 25000 });
  const started = Date.now();
  while (Date.now() - started < 40000) {
    const disabledBox = await box.isDisabled().catch(() => true);
    const stopVisible = await page.getByRole("button", { name: "Stop" }).isVisible().catch(() => false);
    if (!disabledBox && !stopVisible) return;
    await page.waitForTimeout(300);
  }
  throw new Error("composer never became ready url=" + page.url());
}

async function lastAssistant(page) {
  const loc = page.locator('[data-omni-role="assistant"]');
  const n = await loc.count();
  if (!n) return "";
  return loc.nth(n - 1).innerText();
}

async function ask(page, text, waitFor) {
  await waitReady(page);
  await page.waitForTimeout(300);
  const box = page.locator("#omni-ask");
  await box.click();
  await box.fill(text);
  const send = page.getByRole("button", { name: "Send" });
  const enableWait = Date.now();
  while (Date.now() - enableWait < 8000) {
    if (await send.isEnabled().catch(() => false)) break;
    await box.fill(text);
    await page.waitForTimeout(200);
  }
  if (!(await send.isEnabled().catch(() => false))) {
    throw new Error("Send stayed disabled. value=" + (await box.inputValue()) + " url=" + page.url());
  }
  await send.click();
  const started = Date.now();
  const limit = waitFor === "image" ? 28000 : 18000;
  while (Date.now() - started < limit) {
    await page.waitForTimeout(500);
    const generating = await page.locator("body").innerText().then((t) =>
      /Generating image|Searching the web|Looking that up|Writing a reply|Generating response/.test(t),
    );
    if (waitFor === "image") {
      const n = await page.locator('img[alt="generated"], img[src^="data:image"]').count();
      if (n > 0) return lastAssistant(page);
    }
    if (!generating) {
      const last = await lastAssistant(page);
      if (last.trim()) return last;
    }
  }
  return lastAssistant(page);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await register(page);
    await page.goto(`${BASE}/kai`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/kai/, { timeout: 15000 });
    await page.locator("#omni-ask").waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Talk" }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);

    let last = await ask(page, "What is 17 times 19?");
    await dump(page, "omniai-math");
    if (/slogan|I'm with you|I’m with you|Which layer|credit|paywall/i.test(last)) {
      throw new Error("slogan/credits leak on math: " + last.slice(0, 400));
    }
    if (!/323/.test(last)) throw new Error("math missed 323: " + last.slice(0, 400));

    last = await ask(page, "I need dating advice about my crush");
    await dump(page, "omniai-dating");
    if (/slogan|Which layer|credit|subject you asked about/i.test(last)) throw new Error("filler on dating: " + last.slice(0, 400));
    if (!/clarity|true sentence|crush|want|exit|miss|options|afraid|date|feel/i.test(last)) {
      throw new Error("dating reply ignored the request: " + last.slice(0, 400));
    }

    last = await ask(page, "Generate a picture of a car", "image");
    await dump(page, "omniai-car");
    if (/dating|crush|slogan|Which layer|last you said/i.test(last)) {
      throw new Error("topic change failed: " + last.slice(0, 500));
    }
    const hasImg =
      (await page.locator('img[alt="generated"], img[src^="data:image"]').count()) > 0 ||
      /Here's an image|generated/i.test(last);
    if (!hasImg) throw new Error("image request did not produce an image: " + last.slice(0, 400));

    await page.getByRole("button", { name: "Live voice" }).waitFor({ timeout: 5000 });
    await page.getByText("Voice", { exact: true }).first().waitFor();
    await dump(page, "omniai-voice");

    for (let i = 0; i < 3; i++) {
      try {
        await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 15000 });
        if (page.url().includes("/settings")) break;
      } catch {
        await page.waitForTimeout(800);
      }
    }
    if (!page.url().includes("/settings")) {
      throw new Error("could not open settings: " + page.url());
    }
    await page.locator("#account-mark-code").waitFor({ state: "visible", timeout: 20000 });
    await page.locator("#account-mark-code").scrollIntoViewIfNeeded();
    await nativeFill(page, "#account-mark-code", "0916");
    await page.getByRole("button", { name: "Apply mark" }).click();
    await page.waitForTimeout(1500);
    await page.locator("body").getByText("Omni Founder").first().waitFor({ timeout: 8000 }).catch(() => {});
    const settings = await page.locator("body").innerText();
    await dump(page, "omniai-founder");
    if (!/Omni Founder/.test(settings)) throw new Error("Founder label missing: " + settings.slice(0, 400));

    const hook = errors.find((m) => /fewer hooks|#300|Minified React error/i.test(m));
    if (hook) throw new Error(hook);
    console.log("OMNIAI_REPAIR_OK", U.username);
  } catch (e) {
    await dump(page, "omniai-repair-fail");
    console.error("OMNIAI_REPAIR_FAIL", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
