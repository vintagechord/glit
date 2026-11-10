import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { chromium } from "@playwright/test";
import ts from "typescript";

const chromiumOverride = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

// Run the actual client-only dictionary and DOM observer without a Next server,
// authentication, or network requests. Only the React effect boundary is stubbed.
const source = readFileSync(
  new URL("../src/components/i18n/english-language-pack.tsx", import.meta.url),
  "utf8",
);
const sourceFile = ts.createSourceFile("pack.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const runtime = ts.transpileModule(
  sourceFile.statements
    .filter((statement) => !ts.isImportDeclaration(statement))
    .map((statement) => statement.getText(sourceFile).replace(/^export function /, "function "))
    .join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None } },
).outputText;

test("English translation keeps exact labels, whitespace and changing counters with bounded caching", () => {
  const context = vm.createContext({});
  vm.runInContext(`${runtime}\n globalThis.harness = { translateValue, exactTranslations, phraseTranslationCache };`, context);
  const harness = context.harness as {
    translateValue: (value: string) => string;
    exactTranslations: Record<string, string>;
    phraseTranslationCache: Map<string, string>;
  };
  for (const [original, expected] of Object.entries(harness.exactTranslations)) {
    assert.equal(harness.translateValue(`  ${original}\n`), `  ${expected}\n`);
  }
  for (let seconds = 300; seconds >= 0; seconds--) {
    assert.equal(harness.translateValue(`${seconds}초 후 다시 보내기`), `Resend in ${seconds} seconds`);
  }
  assert.ok(harness.phraseTranslationCache.size <= 256);
  assert.equal(harness.translateValue("300초 후 다시 보내기"), "Resend in 300 seconds");
  for (const value of ["Already English", "2026-09-07", "https://example.test/album/123", "  123  ", ""]) {
    assert.equal(harness.translateValue(value), value);
  }
  assert.equal(harness.translateValue("  파일 전송이 완료되었습니다.\n 아래 보완 제출 버튼을 눌러 관리자에게 제출해주세요.  "), "  File transfer is complete. Select Submit materials below to send it to our team.  ");
  assert.equal(harness.translateValue("방송국 6곳 중 1곳 결과 완료 · 17%"), "1 of 6 broadcaster results complete · 17%");
  assert.equal(harness.translateValue("1곳"), "1 broadcaster");
  assert.equal(harness.translateValue("접수처 19곳 · 영등위·방송국별 안내"), "19 review offices · Korea Media Rating Board and broadcaster guides");
  assert.equal(harness.translateValue("영등위·KBS·MBC·SBS부터 국악방송까지 접수처 18곳"), "18 review offices, from the Korea Media Rating Board, KBS, MBC and SBS to Gugak FM");
  assert.equal(harness.translateValue("2026. 10. 25. 오전 9:00"), "2026-10-25 9:00 AM");
  assert.equal(harness.translateValue("2026. 10. 1. 오후 9:00"), "2026-10-1 9:00 PM");
  assert.equal(harness.translateValue("영상물등급위원회 · 적격"), "Korea Media Rating Board · Approved");
  assert.equal(harness.translateValue("앨범 가사 선택"), "Select 앨범 가사", "user-authored title is preserved inside a recognized UI label");
  assert.equal(harness.translateValue("모르는 문장에 앨범과 음원이 있습니다"), "모르는 문장에 앨범과 음원이 있습니다", "unknown sentences must not become mixed gibberish");
});

test("English DOM updates avoid whole subtrees while preserving editable text, excluded links and locale cleanup", {
  skip: !existsSync(chromiumOverride ?? chromium.executablePath()) && "Install Playwright Chromium or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to run DOM translation regression coverage.",
  timeout: 45_000,
}, async () => {
  const browser = await chromium.launch({ headless: true, ...(chromiumOverride ? { executablePath: chromiumOverride } : {}) });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(7_000);
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.route("https://onside.test/**", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html lang="ko"><head><title>로그인</title></head><body>
        <section id="large"><span id="counter">10초 후 다시 보내기</span>${"<p>로그인</p>".repeat(300)}</section>
        <section data-no-translate><p id="excluded">로그인</p></section>
        <p id="native-excluded" translate="no">앨범 가사</p>
        <p id="editable" contenteditable="true">앨범 가사</p>
        <button id="payload" name="action" value="앨범" title="앨범 가사" data-no-translate-attributes="title">파일 열기</button>
        <textarea id="lyrics" placeholder="이메일">가사 원문</textarea>
        <a id="normal" href="/guide?q=1#prepare">심의 안내</a>
        <a id="original" href="/guide" data-no-localize>심의 안내</a>
      </body></html>`,
    }));
    await page.goto("https://onside.test/en/guide", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: `
      globalThis.__pathname = "/en/guide";
      globalThis.__cleanup = null;
      const React = { useLayoutEffect(run) { const cleanup = run(); if (cleanup) globalThis.__cleanup = cleanup; } };
      const usePathname = () => globalThis.__pathname;
      ${runtime}
      globalThis.__mount = EnglishLanguagePack;
      globalThis.__initialAlert = window.alert;
      globalThis.__walks = 0;
      const originalWalker = document.createTreeWalker.bind(document);
      document.createTreeWalker = (...args) => { globalThis.__walks++; return originalWalker(...args); };
      EnglishLanguagePack();
    ` });
    assert.equal(await page.locator("#counter").textContent(), "10초 후 다시 보내기", "without React marks the server HTML waits for the hydration cap");
    await page.waitForFunction(() => document.querySelector("#counter")?.textContent === "Resend in 10 seconds").catch((error: Error) => {
      throw new Error(`${error.message}; runtime errors: ${runtimeErrors.join("; ")}`);
    });
    assert.equal(await page.locator("#excluded").textContent(), "로그인");
    assert.equal(await page.locator("#native-excluded").textContent(), "앨범 가사");
    assert.equal(await page.locator("#editable").textContent(), "앨범 가사");
    assert.equal(await page.locator("#payload").textContent(), "Open File");
    assert.equal(await page.locator("#payload").getAttribute("value"), "앨범");
    assert.equal(await page.locator("#payload").getAttribute("title"), "앨범 가사");
    assert.equal(await page.locator("#lyrics").inputValue(), "가사 원문");
    assert.equal(await page.locator("#lyrics").getAttribute("placeholder"), "Email");
    assert.equal(await page.locator("#normal").getAttribute("href"), "/en/guide?q=1#prepare");
    assert.equal(await page.locator("#original").getAttribute("href"), "/guide");

    await page.evaluate(() => {
      const global = window as unknown as { __walks: number };
      global.__walks = 0;
      document.querySelector("#counter")!.firstChild!.nodeValue = "9초 후 다시 보내기";
      document.querySelector("#large")!.setAttribute("aria-label", "로그인");
    });
    await page.waitForFunction(() => document.querySelector("#counter")?.textContent === "Resend in 9 seconds");
    assert.equal(await page.evaluate(() => (window as unknown as { __walks: number }).__walks), 0);
    assert.equal(await page.locator("#large").getAttribute("aria-label"), "Login");

    await page.evaluate(() => {
      const section = document.createElement("section");
      section.id = "inserted";
      document.body.append(section);
      section.innerHTML = '<input id="added-input" placeholder="이메일"><a id="added-link" href="/faq">로그인</a><a id="added-excluded-link" href="/faq" data-no-localize>로그인</a>';
    });
    await page.waitForFunction(() => document.querySelector("#added-input")?.getAttribute("placeholder") === "Email");
    assert.equal(await page.locator("#added-link").getAttribute("href"), "/en/faq");
    assert.equal(await page.locator("#added-excluded-link").getAttribute("href"), "/faq");
    assert.equal(await page.evaluate(() => (window as unknown as { __walks: number }).__walks), 1);

    await page.evaluate(() => {
      const state = window as unknown as { __cleanup: () => void; __pathname: string; __mount: () => void };
      state.__cleanup();
      state.__pathname = "/guide";
      state.__mount();
    });
    // Leaving English puts back the Korean each node was rendered with.
    assert.equal(await page.locator("#counter").textContent(), "9초 후 다시 보내기");
    assert.equal(await page.locator("#payload").textContent(), "파일 열기");
    assert.equal(await page.locator("#lyrics").getAttribute("placeholder"), "이메일");
    assert.equal(await page.locator("#normal").getAttribute("href"), "/guide?q=1#prepare");
    assert.equal(await page.locator("#added-link").getAttribute("href"), "/faq");
    assert.equal(await page.locator("#large").getAttribute("aria-label"), "로그인");
    assert.equal(await page.title(), "로그인");
    await page.evaluate(() => {
      document.querySelector("#counter")!.firstChild!.nodeValue = "8초 후 다시 보내기";
    });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await page.locator("#counter").textContent(), "8초 후 다시 보내기");
    assert.equal(await page.locator("html").getAttribute("lang"), "ko");
    assert.equal(await page.evaluate(() => window.alert === (window as unknown as { __initialAlert: typeof window.alert }).__initialAlert), true);

    await page.evaluate(() => {
      const state = window as unknown as { __pathname: string; __mount: () => void };
      state.__pathname = "/en/guide";
      state.__mount();
    });
    // Later client navigations translate at once instead of waiting again.
    await page.waitForFunction(() => document.querySelector("#counter")?.textContent === "Resend in 8 seconds", undefined, { timeout: 1_000 });
    assert.equal(await page.locator("html").getAttribute("lang"), "en");

    // A page reached by client navigation before the first pass is rendered
    // in the browser, so it does not wait for hydration either.
    const navigated = await browser.newPage();
    await navigated.route("https://onside.test/**", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html lang="ko"><head><title>FAQ</title></head><body><span id="counter">10초 후 다시 보내기</span></body></html>`,
    }));
    await navigated.goto("https://onside.test/en/guide", { waitUntil: "domcontentloaded" });
    await navigated.addScriptTag({ content: `
      history.pushState(null, "", "/en/faq");
      const React = { useLayoutEffect(run) { run(); } };
      const usePathname = () => "/en/faq";
      ${runtime}
      EnglishLanguagePack();
    ` });
    await navigated.waitForFunction(() => document.querySelector("#counter")?.textContent === "Resend in 10 seconds", undefined, { timeout: 1_000 });
  } finally {
    await browser.close();
  }
});

test("A loaded English page translates what React has hydrated at once and switches back to Korean in place", {
  skip: !existsSync(chromiumOverride ?? chromium.executablePath()) && "Install Playwright Chromium or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to run DOM translation regression coverage.",
  timeout: 45_000,
}, async () => {
  const browser = await chromium.launch({ headless: true, ...(chromiumOverride ? { executablePath: chromiumOverride } : {}) });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(7_000);
    await page.route("https://onside.test/**", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html lang="ko"><head><title>로그인</title></head><body><main>
        <p id="claimed" data-claim>로그인</p>
        <p id="lone" data-claim data-lone>로그인</p>
        <section id="dehydrated"><p id="later">로그인</p></section>
        <div id="boundary" data-claim>로그인</div>
        <p id="sliced" data-claim data-sliced>이메일</p>
        <div id="raw" data-claim data-raw><p id="raw-child">이메일</p></div>
        <a id="link" data-claim href="/faq">FAQ</a>
        <input id="submit" data-claim type="submit" value="로그인">
        <input id="field" data-claim placeholder="이메일">
      </main></body></html>`,
    }));
    await page.goto("https://onside.test/en/login", { waitUntil: "domcontentloaded" });
    // Mark nodes the way React does when it compares them during hydration:
    // claimed elements and their text nodes carry a fiber that leads to the
    // HostRoot (tag 3); a lone string child is written through its parent's
    // props; raw HTML is never compared. #sliced was compared by a hydration
    // pass that has not committed yet (its fragment still has Hydrating).
    await page.addScriptTag({ content: `
      const root = { tag: 3 };
      globalThis.__slicedFragment = { tag: 7, flags: 4096, return: root };
      function mark(node, props, parent = root) {
        node["__reactFiber$test"] = { tag: node.nodeType === 3 ? 6 : 5, flags: 0, return: parent, alternate: null };
        if (props) node["__reactProps$test"] = props;
      }
      mark(document.body, { children: [] });
      document.querySelectorAll("[data-claim]").forEach((element) => {
        if ("lone" in element.dataset) return mark(element, { children: element.textContent });
        if ("raw" in element.dataset) return mark(element, { dangerouslySetInnerHTML: { __html: element.innerHTML } });
        const parent = "sliced" in element.dataset ? globalThis.__slicedFragment : root;
        mark(element, { children: [] }, parent);
        if (element.id !== "boundary") element.childNodes.forEach((child) => mark(child, undefined, element["__reactFiber$test"]));
      });
    ` });
    await page.addScriptTag({ content: `
      globalThis.__cleanup = null;
      const React = { useLayoutEffect(run) { const cleanup = run(); if (cleanup) globalThis.__cleanup = cleanup; } };
      const usePathname = () => "/en/login";
      ${runtime}
      EnglishLanguagePack();
    ` });
    const read = () => page.evaluate(() => ({
      claimed: document.querySelector("#claimed")!.textContent,
      lone: document.querySelector("#lone")!.textContent,
      later: document.querySelector("#later")!.textContent,
      boundary: document.querySelector("#boundary")!.textContent,
      sliced: document.querySelector("#sliced")!.textContent,
      rawChild: document.querySelector("#raw-child")!.textContent,
      link: document.querySelector("#link")!.getAttribute("href"),
      submit: (document.querySelector("#submit") as HTMLInputElement).value,
      field: document.querySelector("#field")!.getAttribute("placeholder"),
      title: document.title,
      lang: document.documentElement.lang,
    }));
    assert.deepEqual(await read(), {
      claimed: "Login", lone: "Login", later: "로그인", boundary: "로그인", sliced: "이메일", rawChild: "Email",
      link: "/en/faq", submit: "Login", field: "Email", title: "Login", lang: "en",
    }, "committed nodes are translated in the same task; unclaimed and uncommitted ones wait");

    // React hydrates the dehydrated section and commits the sliced pass: both
    // are translated within a few frames.
    await page.addScriptTag({ content: `
      const fiber = document.body["__reactFiber$test"].return;
      for (const node of [document.querySelector("#dehydrated"), document.querySelector("#later"), document.querySelector("#later").firstChild]) {
        node["__reactFiber$test"] = { tag: 5, flags: 0, return: fiber, alternate: null };
      }
      globalThis.__slicedFragment.flags = 0;
    ` });
    await page.waitForFunction(() => document.querySelector("#later")?.textContent === "Login", undefined, { timeout: 1_000 });
    await page.waitForFunction(() => document.querySelector("#sliced")?.textContent === "Email", undefined, { timeout: 1_000 });
    assert.equal((await read()).boundary, "로그인", "text React has not compared yet is left for React");
    // A slow streamed section is still left alone after the fallback cap,
    // because React marks show it has not been compared yet.
    await page.waitForTimeout(2_700);
    assert.equal((await read()).boundary, "로그인");

    // React renders new Korean into a translated node, and someone else
    // changes another one; then the visitor switches back to Korean.
    await page.evaluate(() => {
      document.querySelector("#claimed")!.firstChild!.nodeValue = "회원가입";
    });
    await page.waitForFunction(() => document.querySelector("#claimed")?.textContent === "Sign Up");
    await page.evaluate(() => {
      document.querySelector("#raw-child")!.textContent = "Changed elsewhere";
      (globalThis as unknown as { __cleanup: () => void }).__cleanup();
    });
    assert.deepEqual(await read(), {
      claimed: "회원가입", lone: "로그인", later: "로그인", boundary: "로그인", sliced: "이메일", rawChild: "Changed elsewhere",
      link: "/faq", submit: "로그인", field: "이메일", title: "로그인", lang: "ko",
    });
  } finally {
    await browser.close();
  }
});

test("The language switch stays on the page and the pack is ready before the /en route renders", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const header = read("src/components/site/header.tsx");
  const handler = /const handleLanguageClick = React\.useCallback\(([\s\S]*?)\n  \);/.exec(header)?.[1] ?? "";
  assert.ok(handler, "language click handler");
  assert.doesNotMatch(handler, /location\.assign|location\.href\s*=/, "no full reload on the switch");
  assert.match(handler, /loadedEnglishPack\(\)\?\.stopEnglish\(\)/, "English to Korean restores in place");
  assert.match(handler, /pack\.startEnglish\(\)/, "Korean to English translates in place");
  assert.match(handler, /router\.push\([\s\S]*\{ scroll: false \}/);
  for (const event of ["onPointerEnter", "onFocus", "onTouchStart"]) {
    assert.match(header, new RegExp(`${event}=\\{warmLanguageSwitch\\}`), `${event} warms the pack and route`);
  }

  const shell = read("src/components/site/app-shell.tsx");
  assert.doesNotMatch(shell, /import\("@\/components\/i18n\/english-language-pack"\)/, "next/dynamic would add a lazy tick before the pack mounts");
  assert.match(shell, /if \(typeof window !== "undefined" && isEnglishPathname\(window\.location\.pathname\)\) \{\s*loadEnglishPack\(\)/);
  assert.match(shell, /if \(!isEnglishRoute\) loadedEnglishPack\(\)\?\.stopEnglish\(\);/);
  // The pack translates in layout effects, before the browser paints.
  assert.match(source, /React\.useLayoutEffect\(\(\) => \{\s*if \(isEnglishRoute\) \{\s*startEnglish\(\);/);
  assert.doesNotMatch(source, /HYDRATION_SETTLE_MS|React\.useEffect\(/);
});
