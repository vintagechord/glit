import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { chromium } from "@playwright/test";
import ts from "typescript";

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
});

test("English DOM updates avoid whole subtrees while preserving editable text, excluded links and locale cleanup", {
  skip: !existsSync(chromium.executablePath()) && "Install Playwright Chromium to run DOM translation regression coverage.",
  timeout: 45_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
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
        <textarea id="lyrics" placeholder="이메일">가사 원문</textarea>
        <a id="normal" href="/guide?q=1#prepare">심의 안내</a>
        <a id="original" href="/guide" data-no-localize>심의 안내</a>
      </body></html>`,
    }));
    await page.goto("https://onside.test/en/guide", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: `
      globalThis.__pathname = "/en/guide";
      globalThis.__cleanup = null;
      const React = { useEffect(run) { globalThis.__cleanup = run(); } };
      const usePathname = () => globalThis.__pathname;
      ${runtime}
      globalThis.__mount = EnglishLanguagePack;
      globalThis.__initialAlert = window.alert;
      globalThis.__walks = 0;
      const originalWalker = document.createTreeWalker.bind(document);
      document.createTreeWalker = (...args) => { globalThis.__walks++; return originalWalker(...args); };
      EnglishLanguagePack();
    ` });
    await page.waitForFunction(() => document.querySelector("#counter")?.textContent === "Resend in 10 seconds").catch((error: Error) => {
      throw new Error(`${error.message}; runtime errors: ${runtimeErrors.join("; ")}`);
    });
    assert.equal(await page.locator("#excluded").textContent(), "로그인");
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
    await page.waitForFunction(() => document.querySelector("#counter")?.textContent === "Resend in 8 seconds");
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
  } finally {
    await browser.close();
  }
});
