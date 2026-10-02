import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const stamp = Date.now().toString(36).slice(-5);
const USER = {
  email: `so${stamp}@example.com`,
  username: `so${stamp}`,
  name: "Somi User",
  password: "OmniFeed2026!",
};
const ORG = {
  email: `sorg${stamp}@example.com`,
  username: `sorg${stamp}`,
  name: "Somi Org",
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

async function register(page, u) {
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.locator("#email").waitFor({ timeout: 15000 });
  await page.fill("#email", u.email);
  await page.fill("#password", u.password);
  await page.fill("#confirm-password", u.password);
  await page.fill("#username", u.username);
  await page.fill("#display-name", u.name);
  await page.getByRole("button", { name: "Female" }).click();
  await page.fill("#dob", "1995-06-15");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/register"), { timeout: 45000 });
  await page.getByRole("link", { name: "Home" }).waitFor({ timeout: 20000 });
}

async function signOut(page) {
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign out", exact: true }).last().click();
  await page.waitForURL((url) => url.pathname.includes("/login") || url.pathname.includes("/register"), {
    timeout: 20000,
  }).catch(() => {});
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-NG" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(32000);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  try {
    await register(page, USER);
    await page.goto(`${BASE}/superomni`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /Think further than OmniAI/i }).waitFor({ timeout: 15000 });
    const body = await page.locator("body").innerText();
    if (!/₦\s*1,000|NGN\s*1,000|1,000\.00/.test(body)) {
      await dump(page, "superomni-missing-monthly");
      throw new Error("Monthly ₦1,000 not shown: " + body.slice(0, 400));
    }
    if (!/₦\s*12,000|NGN\s*12,000|12,000\.00/.test(body)) {
      throw new Error("Yearly ₦12,000 not shown");
    }
    if (!/free OmniAI/i.test(body)) throw new Error("Free OmniAI status missing");
    await page.getByTestId("plan-monthly").click();
    await page.getByTestId("subscribe-superomni").click();
    await page.getByTestId("store-instruction").waitFor({ timeout: 8000 });
    const after = await page.locator("body").innerText();
    if (/SuperOmni is on/i.test(after) && !/free OmniAI/i.test(after)) {
      throw new Error("Client unlocked SuperOmni without a store receipt");
    }
    await dump(page, "superomni-monthly-web");

    const fake = await page.evaluate(async () => {
      const res = await fetch("/api/billing/apple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchased: true, productId: "superomni.monthly", userId: "me" }),
      });
      return { status: res.status, body: await res.text() };
    });
    if (fake.status === 200 && /applied":true/.test(fake.body)) {
      throw new Error("Unsigned purchased:true activated SuperOmni");
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("superomni-inactive").waitFor({ timeout: 10000 });

    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    const adminBody = await page.locator("body").innerText();
    if (/Organization treasury/i.test(adminBody) && !/Safety access required|required/i.test(adminBody)) {
      throw new Error("Ordinary user saw treasury");
    }
    await dump(page, "superomni-user-admin");

    await signOut(page);
    const page2 = await ctx.newPage();
    await register(page2, ORG);
    await page2.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await page2.locator("#account-mark-code").waitFor({ timeout: 15000 });
    await nativeFill(page2, "#account-mark-code", "0915");
    await page2.getByRole("button", { name: "Apply mark" }).click();
    await page2.waitForTimeout(1500);
    await page2.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page2.getByTestId("treasury-desk").waitFor({ timeout: 15000 });
    const t = await page2.locator("body").innerText();
    if (!/Pending platform/i.test(t) || !/Settled USD/i.test(t)) {
      throw new Error("Treasury missing pending vs settled: " + t.slice(0, 400));
    }
    if (/0x[a-f0-9]{64}/i.test(t)) {
      throw new Error("Treasury invented a transaction hash");
    }
    await dump(page2, "superomni-org-treasury");

    const fatal = pageErrors.filter((m) => /#300|hooks|Minified React/i.test(m));
    if (fatal.length) throw new Error(fatal.join(" | "));
    console.log("SUPEROMNI_QA_OK", {
      user: USER.username,
      org: ORG.username,
      fakeStatus: fake.status,
    });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("SUPEROMNI_QA_FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
