import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const stamp = Date.now().toString(36).slice(-5);
const A = { email: `found${stamp}@example.com`, username: `found${stamp}`, name: "Founder Reed", password: "OmniFeed2026!" };
const B = { email: `bea${stamp}@example.com`, username: `bea${stamp}`, name: "Bea Dual", password: "OmniFeed2026!" };
const C = { email: `org${stamp}@example.com`, username: `org${stamp}`, name: "Org Cay", password: "OmniFeed2026!" };
const D = { email: `arca${stamp}@example.com`, username: `arca${stamp}`, name: "Arc Dana", password: "OmniFeed2026!" };
const E = { email: `arcb${stamp}@example.com`, username: `arcb${stamp}`, name: "Arc Eden", password: "OmniFeed2026!" };

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

async function login(page, u) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const path = new URL(page.url()).pathname;
  if (path === "/" || path === "/me" || path === "/settings") return;
  await page.locator("#email").waitFor({ timeout: 15000 });
  await page.fill("#email", u.email);
  await page.fill("#password", u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 25000 });
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
  await page.waitForTimeout(1800);
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

async function manageAdmin(page, username, action, reason) {
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.locator("#arc-manage-user").waitFor({ timeout: 18000 });
  await nativeFill(page, "#arc-manage-user", username);
  if (action === "revoke") {
    await page.getByRole("button", { name: "Remove badge" }).first().click();
  } else if (action === "restore") {
    await page.getByRole("button", { name: "Restore", exact: true }).first().click();
  } else {
    await page.getByRole("button", { name: "Demote to member" }).first().click();
  }
  await nativeFill(page, "#arc-manage-reason", reason);
  await page.locator("#arc-manage-submit").click();
  await page.waitForTimeout(2000);
  const toast = await lastToast(page);
  const body = await page.locator("body").innerText();
  return `${toast}\n${body}`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxD = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxE = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const c = await ctxC.newPage();
  const d = await ctxD.newPage();
  const e = await ctxE.newPage();
  for (const p of [a, b, c, d, e]) p.setDefaultTimeout(32000);
  const pageErrors = [];
  a.on("pageerror", (err) => pageErrors.push("A:" + err.message));
  b.on("pageerror", (err) => pageErrors.push("B:" + err.message));
  c.on("pageerror", (err) => pageErrors.push("C:" + err.message));
  d.on("pageerror", (err) => pageErrors.push("D:" + err.message));
  e.on("pageerror", (err) => pageErrors.push("E:" + err.message));

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
    await register(d, D);
    await register(e, E);

    const founderBody = await applyMark(a, "0916");
    assertNoCrash(founderBody, "founder-mark");
    if (!/Founder/i.test(founderBody) || /didn’t work|didn't work/i.test(founderBody)) {
      await dump(a, "arcqa-founder-fail");
      throw new Error("Founder mark did not apply");
    }

    const secondFounder = await applyMark(b, "0916");
    if (!/didn’t work|didn't work/i.test(secondFounder)) {
      await dump(b, "arcqa-founder-twice");
      throw new Error("Second account was able to redeem the founder code");
    }

    const orgBody = await applyMark(c, "0915");
    if (!/Official organization/i.test(orgBody)) {
      await dump(c, "arcqa-org-fail");
      throw new Error("Organization mark did not apply");
    }

    const cOnA = await sanction(c, A.username);
    if (!/cannot be sanctioned/i.test(cOnA)) {
      await dump(c, "arcqa-org-punish-founder");
      throw new Error("Ordinary admin was able to sanction the founder");
    }
    const aOnC = await sanction(a, C.username);
    if (!/cannot be sanctioned/i.test(aOnC)) {
      await dump(a, "arcqa-founder-punish-org");
      throw new Error("Founder was able to sanction the org admin");
    }

    const arcA = await applyMark(a, "9999");
    assertNoCrash(arcA, "arc-a");
    if (!/ARC Admin/i.test(arcA) || /didn’t work|didn't work/i.test(arcA)) {
      await dump(a, "arcqa-arc-a-fail");
      throw new Error("Founder did not receive the additive ARC Admin role");
    }
    if (!/Founder/i.test(arcA)) {
      await dump(a, "arcqa-founder-stripped");
      throw new Error("Founder badge disappeared when ARC Admin was added");
    }
    await a.goto(`${BASE}/me`);
    const aMe = await waitText(a, /ARC ADMIN/i, 10, 500);
    if (!/Omni Founder/i.test(aMe) || !/ARC ADMIN/i.test(aMe)) {
      await dump(a, "arcqa-founder-arc-stack");
      throw new Error("Profile is missing the stacked Omni Founder + ARC Admin marks");
    }
    if ((await a.locator('[data-testid="badge-stack"]').count()) === 0) {
      await dump(a, "arcqa-founder-arc-stack");
      throw new Error("Stacked badge layout is missing on the founder+ARC profile");
    }
    await dump(a, "arcqa-founder-arc-stack");

    const arcC = await applyMark(c, "9999");
    if (!/ARC Admin/i.test(arcC) || /didn’t work|didn't work/i.test(arcC)) {
      await dump(c, "arcqa-arc-c-fail");
      throw new Error("Organization account did not receive the additive ARC Admin role");
    }
    if (!/Official organization/i.test(arcC)) {
      await dump(c, "arcqa-org-stripped");
      throw new Error("Organization badge disappeared when ARC Admin was added");
    }
    await c.goto(`${BASE}/me`);
    const cMe = await waitText(c, /ARC ADMIN/i, 10, 500);
    if (!/Official|Verified Organization/i.test(cMe) || !/ARC ADMIN/i.test(cMe)) {
      await dump(c, "arcqa-org-arc-stack");
      throw new Error("Profile is missing the stacked organization + ARC Admin marks");
    }
    await dump(c, "arcqa-org-arc-stack");

    const arcD = await applyMark(d, "9999");
    if (!/ARC Admin/i.test(arcD) || /didn’t work|didn't work/i.test(arcD)) {
      await dump(d, "arcqa-arc-d-fail");
      throw new Error("Third ARC seat did not apply");
    }
    await dump(d, "arcqa-arc-only");

    const fourthArc = await applyMark(e, "9999");
    if (!/didn’t work|didn't work/i.test(fourthArc)) {
      await dump(e, "arcqa-arc-fourth");
      throw new Error("A fourth account was able to redeem the ARC code");
    }

    const orgB = await applyMark(b, "0915");
    if (!/Official organization/i.test(orgB)) {
      await dump(b, "arcqa-org-b-fail");
      throw new Error("Member could not receive the organization mark");
    }

    const aOnE = await sanction(a, E.username);
    const aOnEToast = await lastToast(a);
    if (/cannot be sanctioned/i.test(aOnEToast)) {
      await dump(a, "arcqa-arc-member-blocked");
      throw new Error("ARC Admin could not sanction an ordinary member");
    }
    if (!/Applied|restriction|warning|restored/i.test(aOnEToast + aOnE)) {
      await dump(a, "arcqa-arc-member-sanction");
      throw new Error("ARC Admin sanction on a member did not apply");
    }

    await a.goto(`${BASE}/admin`);
    const desk = await waitText(a, /ARC Admin/i, 12, 600);
    assertNoCrash(desk, "arc-desk");
    if (!/ARC Admin/i.test(desk) || (await a.locator('[data-testid="arc-admin-panel"]').count()) === 0) {
      await dump(a, "arcqa-arc-desk");
      throw new Error("ARC Admin desk is missing");
    }
    await dump(a, "arcqa-arc-desk");

    const denyC = await manageAdmin(a, C.username, "demote", "Trying to remove another ARC seat");
    if (!/cannot manage each other/i.test(denyC)) {
      await dump(a, "arcqa-arc-on-arc");
      throw new Error("ARC Admin was able to demote another ARC Admin");
    }

    const demoteB = await manageAdmin(a, B.username, "demote", "Removing org privileges after review");
    if (/cannot manage each other|ARC access required|not an administrator/i.test(demoteB) && !/Administrator updated/i.test(demoteB)) {
      await dump(a, "arcqa-demote-org");
      throw new Error("ARC could not demote the organization admin");
    }
    if (!/Administrator updated|updated/i.test(demoteB) && /Could not apply|Failed/i.test(demoteB)) {
      await dump(a, "arcqa-demote-org");
      throw new Error("ARC demote of org admin failed");
    }

    await e.goto(`${BASE}/u/${A.username}`);
    const aPublic = await waitText(e, /ARC ADMIN/i, 10, 500);
    assertNoCrash(aPublic, "founder-public");
    if (!/Omni Founder/i.test(aPublic) || !/ARC ADMIN/i.test(aPublic)) {
      await dump(e, "arcqa-founder-public");
      throw new Error("Public profile lost the stacked Founder + ARC Admin marks");
    }
    await dump(e, "arcqa-founder-public");

    await e.goto(`${BASE}/u/${C.username}`);
    const cPublic = await waitText(e, /ARC ADMIN/i, 10, 500);
    if (!/Official|Verified Organization/i.test(cPublic) || !/ARC ADMIN/i.test(cPublic)) {
      await dump(e, "arcqa-org-public");
      throw new Error("Public profile lost the stacked organization + ARC Admin marks");
    }

    await e.goto(`${BASE}/u/${B.username}`);
    const bPublic = await waitText(e, new RegExp(B.name, "i"), 10, 500);
    if (/Official organization/i.test(bPublic) && /aria-label="Official organization"/i.test(bPublic)) {
      await dump(e, "arcqa-org-still-public");
      throw new Error("Demoted org badge still shows on the public profile");
    }

    await e.goto(`${BASE}/u/${A.username}`);
    await waitText(e, /ARC ADMIN/i, 10, 500);
    await e.getByRole("button", { name: /Report/i }).click();
    await e.getByRole("button", { name: "Send report" }).waitFor({ timeout: 8000 });
    await nativeFill(e, "#report-details", "Review this ARC account please");
    await e.getByRole("button", { name: "Send report" }).click();
    await e.waitForTimeout(1500);
    const reportToast = await lastToast(e);
    if (/Could not send|can't report/i.test(reportToast)) {
      await dump(e, "arcqa-report-arc");
      throw new Error("Ordinary member could not report an ARC Admin");
    }

    await a.goto(`${BASE}/admin`);
    const reports = await waitText(a, /review-only|ARC Admin accounts are review-only|reported/i, 14, 700);
    assertNoCrash(reports, "arc-report");
    const row = a.locator('[data-testid="report-row"]').filter({ hasText: new RegExp(A.username, "i") }).first();
    if ((await row.count()) > 0) {
      const rowText = await row.innerText();
      if (!/review-only/i.test(rowText)) {
        await dump(a, "arcqa-report-row");
        throw new Error("ARC report is missing review-only protection");
      }
      if (await row.getByRole("button", { name: "ban" }).count()) {
        throw new Error("Punish buttons shown on an ARC report");
      }
    }
    await dump(a, "arcqa-report-center");

    const leaked = `${founderBody}\n${arcA}\n${desk}`;
    if (/\b9999\b/.test(leaked) || /\b0916\b/.test(leaked) || /\b0914\b/.test(leaked)) {
      throw new Error("A mark code leaked into visible UI copy");
    }

    if (pageErrors.length) {
      const fatal = pageErrors.filter((m) => /#300|hooks|Minified React/i.test(m));
      if (fatal.length) throw new Error(fatal.join(" | "));
    }
    console.log("ARC_QA_OK", {
      A: A.username,
      B: B.username,
      C: C.username,
      D: D.username,
      E: E.username,
    });
  } catch (err) {
    await dump(a, "arcqa-a-error");
    await dump(b, "arcqa-b-error");
    await dump(c, "arcqa-c-error");
    await dump(d, "arcqa-d-error");
    await dump(e, "arcqa-e-error");
    console.error("ARC_QA_FAIL", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
