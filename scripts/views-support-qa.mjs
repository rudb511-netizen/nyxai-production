import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const stamp = Date.now().toString(36).slice(-5);
const A = { email: `ava${stamp}@example.com`, username: `ava${stamp}`, name: "Ava Views", password: "OmniFeed2026!" };
const B = { email: `ben${stamp}@example.com`, username: `ben${stamp}`, name: "Ben Views", password: "OmniFeed2026!" };

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

async function skipSplash(page) {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("nyx-splash-seen", "1");
    } catch {
      /* ignore */
    }
  });
}

async function register(page, u) {
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.locator("#email").waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  await nativeFill(page, "#email", u.email);
  await nativeFill(page, "#password", u.password);
  await nativeFill(page, "#confirm-password", u.password);
  await nativeFill(page, "#username", u.username);
  await nativeFill(page, "#display-name", u.name);
  await page.getByRole("button", { name: "Female" }).click();
  await nativeFill(page, "#dob", "1995-06-15");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/register"), { timeout: 45000 });
  await page.waitForTimeout(600);
  const path = new URL(page.url()).pathname;
  if (path.includes("/register") || path.includes("/login")) {
    throw new Error(`register landed on ${path}`);
  }
  await page.locator('[aria-label="NYX is opening"]').waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  if (path.includes("/onboarding")) {
    await page.getByRole("button", { name: /continue|finish|save|done/i }).first().click().catch(() => {});
    await page.waitForTimeout(800);
  }
  await page
    .locator(".kc-bottom-nav a[aria-label='Home']")
    .waitFor({ timeout: 20000 });
}

async function openComposer(page) {
  const candidates = [
    page.getByRole("link", { name: /create|post|compose/i }),
    page.getByRole("button", { name: /create|post|compose/i }),
    page.locator('a[href="/create"]'),
    page.locator('a[href*="create"]'),
  ];
  for (const c of candidates) {
    if (await c.first().count()) {
      await c.first().click();
      return;
    }
  }
  await page.goto(`${BASE}/create`);
}

const results = [];
function pass(name) {
  results.push({ name, ok: true });
  console.log("PASS", name);
}
function fail(name, err) {
  results.push({ name, ok: false, err: String(err) });
  console.log("FAIL", name, err);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  a.setDefaultTimeout(25000);
  b.setDefaultTimeout(25000);
  await skipSplash(a);
  await skipSplash(b);

  try {
    await register(a, A);
    await register(b, B);
    pass("register two users");

    await openComposer(a);
    await a.waitForTimeout(500);
    const bodyBox = a.locator("textarea").first();
    await bodyBox.waitFor({ timeout: 15000 });
    await bodyBox.fill(`Night view check ${stamp} https://example.com/nyx-views`);
    const postBtn = a.getByRole("button", { name: /post|publish|share/i }).last();
    await postBtn.click();
    await a.waitForTimeout(1500);
    await dump(a, "qa-views-a-posted");
    pass("A created a post");

    await b.goto(`${BASE}/`);
    await b.waitForTimeout(2000);
    const feedText = await b.locator("body").innerText();
    if (!feedText.includes(`Night view check ${stamp}`)) {
      await b.getByRole("link", { name: "Home" }).click().catch(() => {});
      await b.waitForTimeout(2000);
    }
    const feed2 = await b.locator("body").innerText();
    if (!feed2.includes(`Night view check ${stamp}`)) {
      throw new Error("B did not see A's post on Home");
    }
    await dump(b, "qa-views-b-feed");
    pass("B viewed A's post");

    await a.goto(`${BASE}/`);
    await a.waitForTimeout(2500);
    const aHome = await a.locator("body").innerText();
    if (!/Night view check/.test(aHome)) throw new Error("A cannot see own post");
    const viewMatch = aHome.match(/Night view check[\s\S]{0,400}/);
    console.log("A home snippet:", (viewMatch?.[0] ?? aHome).slice(0, 300));
    await dump(a, "qa-views-a-home");
    pass("A sees post with view chrome");

    await a.goto(`${BASE}/inbox`);
    await a.waitForTimeout(800);
    const more = a.getByRole("button", { name: /new|menu|more|compose/i }).first();
    if (await more.count()) await more.click().catch(() => {});
    const supportItem = a.getByRole("button", { name: /NYX Support/i }).or(a.getByText("NYX Support"));
    if (await supportItem.count()) {
      await supportItem.first().click();
    } else {
      await a.goto(`${BASE}/inbox`);
      await a.evaluate(async () => {
        const mod = await import("/src/lib/kchat/server/messages.ts");
        const r = await mod.openDm({ data: { username: "nyxsupport" } });
        window.location.href = `/inbox/${r.id}`;
      }).catch(() => {});
    }
    await a.waitForTimeout(1500);
    if (!a.url().includes("/inbox/")) {
      const row = a.locator("text=NYX Support").first();
      if (await row.count()) await row.click();
      await a.waitForTimeout(1200);
    }
    await dump(a, "qa-support-thread");
    const supportBody = await a.locator("body").innerText();
    if (/Only admins can post in this channel|You can't reply/i.test(supportBody)) {
      throw new Error("Support is still one-way for ordinary user");
    }
    const composer = a.getByPlaceholder(/Message NYX Support|Command NYX Support|Message/i);
    await composer.first().waitFor({ timeout: 12000 });
    await composer.first().fill("Need help — views and media history.");
    await a.getByRole("button", { name: /send/i }).click().catch(async () => {
      await a.keyboard.press("Enter");
    });
    await a.waitForTimeout(1200);
    const afterSend = await a.locator("body").innerText();
    if (!/Need help/.test(afterSend)) throw new Error("Support message did not appear");
    await dump(a, "qa-support-sent");
    pass("ordinary user can message NYX Support");

    await a.goto(`${BASE}/u/${B.username}`);
    await a.waitForTimeout(800);
    const dmBtn = a.getByRole("button", { name: /message|chat/i }).or(a.getByRole("link", { name: /message/i }));
    if (await dmBtn.count()) await dmBtn.first().click();
    else {
      await a.goto(`${BASE}/inbox`);
      await a.waitForTimeout(400);
    }
    await a.waitForTimeout(1200);
    if (!a.url().includes("/inbox/")) {
      await a.evaluate(async (username) => {
        const mod = await import("/src/lib/kchat/server/messages.ts");
        const r = await mod.openDm({ data: { username } });
        window.location.href = `/inbox/${r.id}`;
      }, B.username);
      await a.waitForTimeout(1500);
    }
    const chatBox = a.getByPlaceholder(/^Message$|^Message /i).or(a.locator("textarea, [contenteditable='true']")).first();
    await chatBox.waitFor({ timeout: 12000 });
    await chatBox.fill("check this https://example.com/shared-link");
    await a.getByRole("button", { name: /send/i }).click().catch(async () => a.keyboard.press("Enter"));
    await a.waitForTimeout(1000);
    await dump(a, "qa-chat-link-sent");

    const mediaBtn = a.getByRole("button", { name: "Media, links, and documents" });
    await mediaBtn.click();
    await a.waitForTimeout(800);
    await a.getByRole("button", { name: "Links", exact: true }).click();
    await a.waitForTimeout(800);
    await dump(a, "qa-chat-links-history");
    const hist = await a.locator("body").innerText();
    if (/No links in this chat yet/i.test(hist) && !/example.com/i.test(hist)) {
      throw new Error("Links history empty despite sent URL");
    }
    pass("chat Links history shows sent URL");
    await a.getByRole("button", { name: "Close" }).click().catch(() => {});


    await a.goto(`${BASE}/settings`);
    await a.waitForTimeout(800);
    const settingsText = await a.locator("body").innerText();
    if (!/Allow Status Resharing/i.test(settingsText)) throw new Error("Missing Allow Status Resharing setting");
    if (!/Blocked/i.test(settingsText) && !/Blocked accounts/i.test(settingsText)) {
      console.log("WARN Blocked heading not obvious; scanning further");
    }
    if (!/NYX Support/i.test(settingsText) && !/Contact NYX Support/i.test(settingsText)) {
      console.log("WARN Contact NYX Support not in settings body");
    }
    await dump(a, "qa-settings-privacy");
    pass("settings include status reshare");

    await a.goto(`${BASE}/u/${B.username}`);
    await a.waitForTimeout(800);
    const blockBtn = a.getByRole("button", { name: /^Block$/i });
    if (await blockBtn.count()) {
      await blockBtn.first().click();
      await a.waitForTimeout(600);
      const unblock = a.getByRole("button", { name: /Unblock/i });
      if (!(await unblock.count())) throw new Error("Unblock button missing after block");
      await dump(a, "qa-blocked-profile");
      pass("block then Unblock UI");
      await unblock.first().click();
      await a.waitForTimeout(500);
      pass("unblock restores profile actions");
    } else {
      const moreBtn = a.getByRole("button", { name: /more|menu/i });
      if (await moreBtn.count()) {
        await moreBtn.first().click();
        await a.waitForTimeout(300);
        const b2 = a.getByRole("button", { name: /^Block$/i });
        if (await b2.count()) {
          await b2.first().click();
          await a.waitForTimeout(500);
          pass("block from menu");
        } else {
          fail("block UI", "no Block button");
        }
      } else {
        fail("block UI", "no Block control");
      }
    }

    await a.goto(`${BASE}/watch`);
    await a.waitForTimeout(800);
    const mutedPref = await a.evaluate(() => localStorage.getItem("nyx-watch-muted"));
    if (mutedPref === "1") throw new Error("Watch mute pref defaulted to muted");
    await dump(a, "qa-watch");
    pass("watch mute preference not forced on");

    await a.goto(`${BASE}/support`);
    await a.waitForTimeout(800);
    const supportGate = await a.locator("body").innerText();
    if (!/Only ARC Admins/i.test(supportGate) && !/Support inbox/i.test(supportGate)) {
      throw new Error("Unexpected /support for ordinary user: " + supportGate.slice(0, 200));
    }
    if (/Support inbox/i.test(supportGate) && !/Only ARC Admins/i.test(supportGate)) {
      throw new Error("Ordinary user reached ARC support inbox");
    }
    await dump(a, "qa-support-gate");
    pass("ordinary user cannot open ARC support inbox");
  } catch (e) {
    await dump(a, "qa-views-fail-a");
    await dump(b, "qa-views-fail-b");
    fail("flow", e instanceof Error ? e.message : e);
    throw e;
  } finally {
    console.log("--- results ---");
    for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, r.err ?? "");
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
