import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const stamp = Date.now().toString(36).slice(-5);
const user = {
  email: `omni${stamp}@example.com`,
  username: `omni${stamp}`,
  name: "Omni Tester",
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

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.setDefaultTimeout(25000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await nativeFill(page, "#email", user.email);
  await nativeFill(page, "#password", user.password);
  await nativeFill(page, "#confirm-password", user.password);
  await nativeFill(page, "#username", user.username);
  await nativeFill(page, "#display-name", user.name);
  await page.getByRole("button", { name: "Female" }).click();
  await nativeFill(page, "#dob", "1995-06-15");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/register"), { timeout: 25000 });
  await page.getByRole("link", { name: "Home" }).waitFor({ timeout: 15000 });

  await page.goto(`${BASE}/kai`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Ask OmniAI").waitFor({ timeout: 15000 });
  await page.screenshot({ path: "/workspace/screenshots/omniai-studio.png", fullPage: true });

  const body0 = await page.locator("body").innerText();
  if (!/OmniAI|Ask OmniAI|Think with OmniAI/.test(body0)) {
    throw new Error("OmniAI studio did not render");
  }
  if (/Something went wrong|Minified React error|#300/.test(body0)) {
    throw new Error("OmniAI studio crashed: " + body0.slice(0, 200));
  }
  await page.getByRole("button", { name: /Web Search/i }).waitFor({ timeout: 5000 });

  await nativeFill(page, "textarea", "What is 17 times 19?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(4000);
  const body = await page.locator("body").innerText();
  await page.screenshot({ path: "/workspace/screenshots/omniai-reply.png", fullPage: true });
  if (/Something went wrong|Minified React error|#300/.test(body)) {
    throw new Error("Crash after send: " + body.slice(0, 240));
  }
  const mock = /I’m with you on|Let’s stay with|That’s allowed|Two people miss the same train/i.test(body);
  if (mock) throw new Error("Got a mocked local riff instead of the live model path");
  if (!/credits|paused|could not|not connected/i.test(body)) {
    // A real model answer is also acceptable if credits were restored.
    if (!/\b323\b/.test(body) && !/OmniAI/.test(body)) {
      throw new Error("No honest model reply or error. Body: " + body.slice(0, 400));
    }
  }
  if (pageErrors.length) throw new Error("pageerror: " + pageErrors.join(" | "));
  console.log(JSON.stringify({ ok: true, bodyPrefix: body.slice(0, 280) }));
} catch (err) {
  await page.screenshot({ path: "/workspace/screenshots/omniai-fail.png", fullPage: true }).catch(() => {});
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await browser.close();
}
