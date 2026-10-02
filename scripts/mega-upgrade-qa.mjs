import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const stamp = Date.now().toString(36).slice(-5);
const A = { email: `found${stamp}@example.com`, username: `found${stamp}`, name: "Founder Reed", password: "OmniFeed2026!" };
const B = { email: `bea${stamp}@example.com`, username: `bea${stamp}`, name: "Bea Dual", password: "OmniFeed2026!" };
const C = { email: `org${stamp}@example.com`, username: `org${stamp}`, name: "Org Cay", password: "OmniFeed2026!" };

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
  } catch {
    /* ignore */
  }
}

async function waitText(page, re, tries = 10, delay = 800) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    last = await page.locator("body").innerText();
    if (re.test(last)) return last;
    await page.waitForTimeout(delay);
  }
  return last;
}

async function lastToast(page) {
  const loc = page.locator("[data-sonner-toast]");
  const n = await loc.count();
  if (n > 0) return loc.nth(n - 1).innerText();
  return page.locator("body").innerText();
}

async function register(page, u) {
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.locator("#email").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await page.fill("#email", u.email);
  await page.fill("#password", u.password);
  await page.fill("#confirm-password", u.password);
  await page.fill("#username", u.username);
  await page.fill("#display-name", u.name);
  await page.getByRole("button", { name: "Female" }).click();
  await page.fill("#dob", "1995-06-15");
  const failed = [];
  const onRes = (res) => {
    if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
  };
  page.on("response", onRes);
  await page.getByRole("button", { name: "Create account" }).click();
  try {
    await page.waitForURL((url) => !url.pathname.includes("/register"), { timeout: 45000 });
  } catch {
    const body = await page.locator("body").innerText();
    throw new Error(`register stuck on ${page.url()} :: ${body.slice(0, 400)} :: ${failed.slice(0, 6).join(" | ")}`);
  } finally {
    page.off("response", onRes);
  }
  await page.waitForTimeout(800);
  const path = new URL(page.url()).pathname;
  if (path.includes("/register") || path.includes("/login")) {
    throw new Error(`register landed on ${path}`);
  }
  await page.getByRole("link", { name: "Home" }).waitFor({ timeout: 20000 });
}

async function applyMark(page, code) {
  for (let i = 0; i < 4; i++) {
    try {
      await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 20000 });
      break;
    } catch {
      await page.waitForTimeout(1200);
    }
  }
  await page.locator("#account-mark-code").waitFor({ timeout: 15000 });
  await nativeFill(page, "#account-mark-code", code);
  await page.getByRole("button", { name: "Apply mark" }).click();
  await page.waitForTimeout(1600);
  return page.locator("body").innerText();
}

async function sanction(page, username) {
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.locator("#sanction-user").waitFor({ timeout: 15000 });
  await nativeFill(page, "#sanction-user", username);
  await page.getByRole("button", { name: "Apply" }).click();
  await page.waitForTimeout(1800);
  const toast = await lastToast(page);
  const body = await page.locator("body").innerText();
  return `${toast}\n${body}`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const c = await ctxC.newPage();
  a.setDefaultTimeout(28000);
  b.setDefaultTimeout(28000);
  c.setDefaultTimeout(28000);
  const pageErrors = [];
  a.on("pageerror", (e) => pageErrors.push("A:" + e.message));
  b.on("pageerror", (e) => pageErrors.push("B:" + e.message));
  c.on("pageerror", (e) => pageErrors.push("C:" + e.message));

  function assertNoCrash(text, where) {
    if (/Something went wrong|Minified React error|#300/i.test(text)) {
      throw new Error(`React crash at ${where}: ${text.slice(0, 280)}`);
    }
    const hook = pageErrors.find((m) => /fewer hooks|#300|Minified React error/i.test(m));
    if (hook) throw new Error(`React crash at ${where}: ${hook}`);
  }

  try {
    await register(a, A);
    await register(b, B);
    await register(c, C);

    await a.goto(`${BASE}/inbox`);
    const inboxA = await waitText(a, /OmniSupport/i, 12, 700);
    assertNoCrash(inboxA, "inbox-a");
    if (!/OmniSupport/i.test(inboxA)) {
      await dump(a, "qa-welcome-missing");
      throw new Error("Welcome DM from OmniSupport was not in the inbox");
    }
    await a.getByText("OmniSupport", { exact: true }).first().click();
    await a.waitForURL(/\/inbox\//, { timeout: 15000 });
    const welcome = await waitText(a, /glad you’re here|glad you're here|Welcome to Omnifeed/i, 12, 600);
    assertNoCrash(welcome, "welcome-thread");
    if (!/glad you’re here|glad you're here|Welcome to Omnifeed/i.test(welcome)) {
      await dump(a, "qa-welcome-body");
      throw new Error("Welcome message body missing");
    }
    const supportComposer = await a.locator("textarea").count();
    if (!supportComposer) {
      await dump(a, "qa-oneway-copy");
      throw new Error("Ordinary user should be able to message NYX Support");
    }
    await a.screenshot({ path: "/workspace/screenshots/qa-welcome-omnisupport.png" });

    const founderBody = await applyMark(a, "0916");
    assertNoCrash(founderBody, "founder-mark");
    if (!/Founder/i.test(founderBody) || /didn’t work|didn't work/i.test(founderBody)) {
      await dump(a, "qa-founder-fail");
      throw new Error("Founder mark did not apply");
    }
    if (/Omnifeed developer/i.test(founderBody)) {
      throw new Error("Founder still labeled as developer");
    }
    await a.screenshot({ path: "/workspace/screenshots/qa-founder-settings.png" });

    await a.goto(`${BASE}/me`);
    const meBody = await waitText(a, /Omni Founder/i, 8, 500);
    assertNoCrash(meBody, "founder-profile");
    if (!/Omni Founder/i.test(meBody)) {
      await dump(a, "qa-founder-profile");
      throw new Error("Profile is missing the Omni Founder badge");
    }
    await a.screenshot({ path: "/workspace/screenshots/qa-founder-profile.png" });

    const secondFounder = await applyMark(b, "0916");
    if (!/didn’t work|didn't work/i.test(secondFounder)) {
      await dump(b, "qa-founder-twice");
      throw new Error("Second account was able to redeem the founder code");
    }

    const orgBody = await applyMark(c, "0915");
    if (!/Official organization/i.test(orgBody)) {
      await dump(c, "qa-org-fail");
      throw new Error("Organization mark did not apply");
    }
    await c.screenshot({ path: "/workspace/screenshots/qa-org-settings.png" });

    const aOnC = await sanction(a, C.username);
    if (!/cannot be sanctioned/i.test(aOnC)) {
      await dump(a, "qa-admin-punish-org");
      throw new Error("Founder was able to sanction the org admin");
    }
    const cOnA = await sanction(c, A.username);
    if (!/cannot be sanctioned/i.test(cOnA)) {
      await dump(c, "qa-admin-punish-founder");
      throw new Error("Org admin was able to sanction the founder");
    }

    const aOnB = await sanction(a, B.username);
    const aOnBToast = await lastToast(a);
    if (/cannot be sanctioned/i.test(aOnBToast)) {
      await dump(a, "qa-member-blocked");
      throw new Error("Founder could not sanction an ordinary member");
    }
    if (!/Applied|restriction|warning|restored/i.test(aOnBToast + aOnB)) {
      await dump(a, "qa-member-sanction");
      throw new Error("Founder sanction on a member did not apply");
    }

    await a.goto(`${BASE}/inbox`);
    await waitText(a, /OmniSupport/i, 8, 500);
    await a.getByText("OmniSupport", { exact: true }).first().click();
    await a.waitForURL(/\/inbox\//, { timeout: 15000 });
    const adminSupport = await waitText(a, /textarea|Send|OmniSupport desk/i, 8, 500);
    if (/one-way/i.test(adminSupport) && !(await a.locator("textarea").count())) {
      await dump(a, "qa-admin-support-locked");
      throw new Error("Administrator could not command OmniSupport");
    }
    const cmd = a.locator("textarea").first();
    await cmd.waitFor({ state: "visible", timeout: 8000 });
    await cmd.fill("help");
    await a.getByRole("button", { name: "Send" }).click();
    let sawHelp = false;
    for (let i = 0; i < 10; i++) {
      await a.waitForTimeout(1000);
      const t = await a.locator("body").innerText();
      if (/Open reports|OmniSupport desk/i.test(t)) {
        sawHelp = true;
        break;
      }
    }
    if (!sawHelp) {
      await dump(a, "qa-support-cmd");
      throw new Error("OmniSupport did not answer an admin command");
    }

    await b.goto(`${BASE}/create`);
    const composer = b.getByPlaceholder("What's happening? Use @ to mention someone");
    await composer.waitFor({ timeout: 12000 });
    await composer.fill("I will kill you tomorrow.");
    await b.getByRole("button", { name: "Publish" }).click();
    await b.waitForTimeout(2800);

    await b.goto(`${BASE}/settings`);
    const warnBody = await waitText(b, /Warning 1 of 3/i, 12, 700);
    assertNoCrash(warnBody, "warning-status");
    if (!/Warning 1 of 3/i.test(warnBody)) {
      await dump(b, "qa-warning-missing");
      throw new Error("Warning status was not shown after a violation");
    }

    await a.goto(`${BASE}/admin`);
    const desk = await waitText(a, /Priority · violence|violence · post|Warning 1 of 3/i, 16, 700);
    assertNoCrash(desk, "admin-desk");
    const reportRow = await a.locator('[data-testid="report-row"]').count();
    if (!reportRow && !/Priority ·|violence/i.test(desk)) {
      await dump(a, "qa-report-center");
      throw new Error("Admin report center did not show the OmniSupport report");
    }
    if (!/I will kill you tomorrow|Direct threat|violence/i.test(desk)) {
      await dump(a, "qa-report-center");
      throw new Error("Admin report center is missing evidence for the violence report");
    }
    await a.screenshot({ path: "/workspace/screenshots/qa-report-center.png" });

    await a.goto(`${BASE}/kai`);
    await a.locator("#omni-ask").waitFor({ timeout: 15000 });
    for (let i = 0; i < 20; i++) {
      const disabled = await a.locator("#omni-ask").getAttribute("disabled");
      if (!disabled) break;
      await a.waitForTimeout(400);
    }
    await nativeFill(a, "#omni-ask", "What is 17 times 19?");
    await a.getByRole("button", { name: "Send" }).click();
    let omni = "";
    for (let i = 0; i < 22; i++) {
      await a.waitForTimeout(900);
      omni = await a.locator("body").innerText();
      if (/323/.test(omni)) break;
    }
    await a.screenshot({ path: "/workspace/screenshots/qa-omniai.png" });
    if (/credits|paused because|paywall|out of credits/i.test(omni)) {
      throw new Error("OmniAI surfaced credit/paywall copy");
    }
    if (!/\b(323|three hundred)\b/i.test(omni)) {
      await dump(a, "qa-omniai-empty");
      throw new Error("OmniAI did not return a working reply for 17×19");
    }

    if (pageErrors.length) {
      const fatal = pageErrors.filter((m) => /#300|hooks|Minified React/i.test(m));
      if (fatal.length) throw new Error(fatal.join(" | "));
    }
    console.log("MEGA_QA_OK", { A: A.username, B: B.username, C: C.username });
  } catch (e) {
    await dump(a, "qa-a-error");
    await dump(b, "qa-b-error");
    await dump(c, "qa-c-error");
    console.error("MEGA_QA_FAIL", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
