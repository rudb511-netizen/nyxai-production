import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const stamp = Date.now().toString(36).slice(-5);
const A = { email: `reed${stamp}@example.com`, username: `reed${stamp}`, name: "Reed Dual", password: "OmniFeed2026!" };
const B = { email: `bea${stamp}@example.com`, username: `bea${stamp}`, name: "Bea Dual", password: "OmniFeed2026!" };

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
    const html = await page.content();
    writeFileSync(`/workspace/screenshots/${name}.html`, html.slice(0, 80_000));
  } catch {
    /* ignore */
  }
}

async function register(page, u) {
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await nativeFill(page, "#email", u.email);
  await nativeFill(page, "#password", u.password);
  await nativeFill(page, "#confirm-password", u.password);
  await nativeFill(page, "#username", u.username);
  await nativeFill(page, "#display-name", u.name);
  await page.getByRole("button", { name: "Female" }).click();
  await nativeFill(page, "#dob", "1995-06-15");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/register"), { timeout: 25000 });
  await page.waitForTimeout(1000);
  const path = new URL(page.url()).pathname;
  if (path.includes("/register") || path.includes("/login")) {
    throw new Error(`register landed on ${path}`);
  }
  await page.getByRole("link", { name: "Home" }).waitFor({ timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  a.setDefaultTimeout(25000);
  b.setDefaultTimeout(25000);
  const pageErrors = [];
  a.on("pageerror", (e) => pageErrors.push("A:" + e.message));
  b.on("pageerror", (e) => pageErrors.push("B:" + e.message));

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
    await a.screenshot({ path: "/workspace/screenshots/qa-a-home.png" });
    await b.screenshot({ path: "/workspace/screenshots/qa-b-home.png" });

    // Mount the inbox list first. Opening a thread from here used to trip React #300
    // (early return skipped a useMemo).
    await a.goto(`${BASE}/inbox`);
    await a.getByPlaceholder("Ask OmniAI or Search").waitFor({ timeout: 8000 });
    assertNoCrash(await a.locator("body").innerText(), "inbox-list");

    await a.goto(`${BASE}/u/${B.username}`);
    await a.getByRole("button", { name: "Add friend" }).click();
    await a.waitForTimeout(800);
    await b.goto(`${BASE}/u/${A.username}`);
    await b.getByRole("button", { name: "Accept" }).click();
    await b.waitForTimeout(800);

    await a.goto(`${BASE}/u/${B.username}`);
    await a.getByRole("button", { name: "Message" }).click();
    await a.waitForURL(/\/inbox\//, { timeout: 15000 });
    assertNoCrash(await a.locator("body").innerText(), "profile-message");
    const composer = a.locator("textarea").first();
    await composer.waitFor({ state: "visible" });
    await composer.fill("Hey Bea — this is a real DM.");
    await a.getByRole("button", { name: "Send" }).click();
    await a.waitForTimeout(1800);
    await a.screenshot({ path: "/workspace/screenshots/qa-a-dm.png" });
    assertNoCrash(await a.locator("body").innerText(), "after-send");

    await b.goto(a.url());
    await b.waitForTimeout(2500);
    const bodyB = await b.locator("body").innerText();
    assertNoCrash(bodyB, "recipient-open");
    if (!bodyB.includes("Hey Bea")) {
      await dump(b, "qa-b-dm-fail");
      throw new Error("Recipient did not receive the DM");
    }
    await b.screenshot({ path: "/workspace/screenshots/qa-b-dm.png" });

    await a.goto(`${BASE}/inbox`);
    await a.getByPlaceholder("Ask OmniAI or Search").waitFor({ timeout: 8000 });
    await a.getByText("Bea Dual").first().click();
    await a.waitForURL(/\/inbox\/cv_/, { timeout: 15000 });
    const reopened = await a.locator("body").innerText();
    assertNoCrash(reopened, "inbox-row-reopen");
    if (!reopened.includes("Hey Bea")) {
      await dump(a, "qa-a-reopen-fail");
      throw new Error("Reopening the chat from the inbox lost the messages");
    }
    const composer2 = a.locator("textarea").first();
    await composer2.waitFor({ state: "visible" });

    await composer2.fill("second ping from Reed");
    await a.getByRole("button", { name: "Send" }).click();
    let sawSecond = false;
    for (let i = 0; i < 8; i++) {
      await b.waitForTimeout(1500);
      const t = await b.locator("body").innerText();
      if (t.includes("second ping from Reed")) {
        sawSecond = true;
        break;
      }
    }
    if (!sawSecond) {
      await dump(b, "qa-b-poll-fail");
      throw new Error("Live poll did not deliver the second message");
    }

    const realDm = a.url();
    await a.goto(`${BASE}/inbox/cv_${"0".repeat(24)}`);
    await a.waitForTimeout(1500);
    const idor = await a.locator("body").innerText();
    if (/sql|postgres|column "|relation /i.test(idor)) {
      await dump(a, "qa-a-idor-leak");
      throw new Error("IDOR leaked SQL");
    }
    if (!/Couldn.?t open this conversation/i.test(idor)) {
      await dump(a, "qa-a-idor-fail");
      throw new Error("Fake conversation did not fail closed");
    }
    await a.goto(realDm);
    const threadBox = a.locator("textarea").first();
    await threadBox.waitFor({ state: "visible" });

    await a.getByText("Hey Bea — this is a real DM.").click();
    const editBtn = a.getByRole("button", { name: "Edit" });
    await editBtn.waitFor({ timeout: 8000 });
    await editBtn.click();
    await a.getByLabel("Edit message").fill("Hey Bea — edited for everyone.");
    await a.getByRole("button", { name: "Save" }).click();
    await a.waitForTimeout(1800);
    await b.reload();
    await b.waitForTimeout(1500);
    const edited = await b.locator("body").innerText();
    if (!edited.includes("edited for everyone")) {
      await dump(b, "qa-b-edit-fail");
      throw new Error("Edit did not sync to recipient");
    }

    await threadBox.fill("@omniai ping from Reed");
    await a.getByRole("button", { name: "Send" }).click();
    let omniHit = false;
    for (let i = 0; i < 10; i++) {
      await a.waitForTimeout(1000);
      const t = await a.locator("body").innerText();
      if (/OmniAI/i.test(t) && t.includes("ping from Reed")) {
        omniHit = true;
        break;
      }
    }
    await a.screenshot({ path: "/workspace/screenshots/qa-a-omniai-dm.png" });
    if (!omniHit) {
      await dump(a, "qa-a-omniai-dm-fail");
      throw new Error("OmniAI did not reply in the DM");
    }

    await a.getByRole("button", { name: "Voice call" }).click();
    await a.waitForURL(/\/call\//, { timeout: 15000 });
    await a.waitForTimeout(2500);
    await b.goto(`${BASE}/`);
    let incoming = "";
    for (let i = 0; i < 8; i++) {
      await b.waitForTimeout(1500);
      incoming = await b.locator("body").innerText();
      if (/Incoming (voice|group voice) call|is calling/i.test(incoming)) break;
    }
    await b.screenshot({ path: "/workspace/screenshots/qa-b-incoming.png" });
    await a.screenshot({ path: "/workspace/screenshots/qa-a-calling.png" });
    if (!/Incoming (voice|group voice) call|is calling/i.test(incoming)) {
      await dump(b, "qa-b-incoming-fail");
      throw new Error("Incoming voice call did not appear for recipient");
    }

    await b.getByRole("button", { name: "Decline" }).click();
    await a.waitForTimeout(800);

    await a.goto(`${BASE}/kai`);
    await a.waitForTimeout(1500);
    const kai = await a.locator("body").innerText();
    if (!kai.includes("OmniAI")) {
      await dump(a, "qa-omniai-fail");
      throw new Error("OmniAI studio did not load");
    }
    await a.screenshot({ path: "/workspace/screenshots/qa-omniai.png" });

    await a.goto(`${BASE}/create`);
    await a.waitForTimeout(800);
    const createText = await a.locator("body").innerText();
    if (!/status/i.test(createText)) throw new Error("Create is missing Status tab");
    await a.getByRole("button", { name: "status" }).click();
    const statusUi = await a.locator("body").innerText();
    if (!/Friends except|Only share with|View once/i.test(statusUi)) {
      throw new Error("Status privacy / view once controls missing");
    }
    await a.getByPlaceholder("What's going on?").fill("Status for friends only");
    await a.getByRole("button", { name: "Share status" }).click();
    await a.waitForTimeout(1800);

    await b.goto(`${BASE}/`);
    await b.waitForTimeout(1800);
    await b.screenshot({ path: "/workspace/screenshots/qa-b-status.png" });
    const homeB = await b.locator("body").innerText();
    if (!homeB.toLowerCase().includes("status") && !homeB.includes(A.username) && !homeB.includes("Reed")) {
      console.warn("Home after status:", homeB.slice(0, 500));
    }

    await a.goto(`${BASE}/watch`);
    await a.waitForTimeout(1500);
    const watch = await a.locator("body").innerText();
    if (!/For you|Following|No videos yet|Watch/i.test(watch)) {
      await dump(a, "qa-a-watch-fail");
      throw new Error("Watch feed did not load");
    }
    await a.screenshot({ path: "/workspace/screenshots/qa-a-watch.png" });

    await a.goto(`${BASE}/settings`);
    await a.waitForTimeout(800);
    const settings = await a.locator("body").innerText();
    if (!/Default Status audience/i.test(settings)) {
      throw new Error("Settings missing Status audience");
    }

    await a.goto(`${BASE}/inbox`);
    await a.waitForTimeout(1500);
    await a.getByPlaceholder("Ask OmniAI or Search").waitFor({ timeout: 8000 });
    const inboxA = await a.locator("body").innerText();
    if (!inboxA.includes("OmniFeed")) throw new Error("Inbox missing OmniFeed title");
    for (const chip of ["All", "Unread", "Favorites", "Groups"]) {
      if (!inboxA.includes(chip)) throw new Error(`Inbox missing ${chip} filter`);
    }
    await a.screenshot({ path: "/workspace/screenshots/qa-a-inbox.png" });

    const beaName = a.getByText("Bea Dual").first();
    await beaName.waitFor({ timeout: 8000 });
    await beaName.click({ button: "right" });
    const pinBtn = a.getByRole("button", { name: /^Pin$/ });
    await pinBtn.waitFor({ timeout: 5000 });
    await pinBtn.click();
    await a.waitForTimeout(1200);
    const pinned = await a.locator("body").innerText();
    if (!/Pinned/i.test(pinned)) throw new Error("Pin did not persist in the inbox");
    await a.screenshot({ path: "/workspace/screenshots/qa-a-inbox-pin.png" });

    await nativeFill(a, 'input[placeholder="Ask OmniAI or Search"]', "edited for everyone");
    await a.waitForTimeout(1800);
    await a.getByText("Ask OmniAI").first().waitFor({ timeout: 5000 });
    await a.screenshot({ path: "/workspace/screenshots/qa-a-inbox-search.png" });

    await b.goto(`${BASE}/inbox`);
    await b.waitForTimeout(1800);
    await b.getByPlaceholder("Ask OmniAI or Search").waitFor({ timeout: 8000 });
    const inboxB = await b.locator("body").innerText();
    if (!inboxB.includes("OmniFeed")) throw new Error("Recipient inbox missing OmniFeed");
    if (!inboxB.includes("Reed Dual") && !inboxB.includes("edited")) {
      await dump(b, "qa-b-inbox-fail");
      throw new Error("Recipient inbox did not list the conversation");
    }
    await b.screenshot({ path: "/workspace/screenshots/qa-b-inbox.png" });

    const fatal = pageErrors.filter((m) => /fewer hooks|#300|Minified React error|invalid element type/i.test(m));
    if (fatal.length) throw new Error(fatal.join(" | "));

    console.log(JSON.stringify({ ok: true, A: A.username, B: B.username }, null, 2));
  } catch (err) {
    await dump(a, "qa-a-error");
    await dump(b, "qa-b-error");
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
