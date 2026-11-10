import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BannerRotationToggle, bannerRotationState } from "../src/components/site/banner-rotation";
import { LegalPage } from "../src/components/site/legal-page";
import { DOCUMENT_FLAGS_SCRIPT } from "../src/lib/session-cookie";

const require = createRequire(import.meta.url);
const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("English pages switch to lang=en before first paint without a dynamic root layout", () => {
  const layout = readSource("src/app/layout.tsx");
  assert.match(layout, /<body[^>]*>\s*<script dangerouslySetInnerHTML=\{\{ __html: `\$\{SESSION_COOKIE_FLAG_SCRIPT\}\$\{DOCUMENT_FLAGS_SCRIPT\}` \}\} \/>/);
  assert.doesNotMatch(layout, /next\/headers|headers\(\)|cookies\(\)/, "the root layout must not read the request");
  for (const [pathname, lang] of [
    ["/en", "en"], ["/en/", "en"], ["/en/guide/album-review", "en"],
    ["/", undefined], ["/guide", undefined], ["/english", undefined], ["/enroll", undefined],
  ] as const) {
    const attributes: Record<string, string> = {};
    const documentElement = { setAttribute(name: string, value: string) { attributes[name] = value; } };
    new Function("document", "location", DOCUMENT_FLAGS_SCRIPT)({ documentElement }, { pathname });
    assert.equal(attributes.lang, lang, pathname);
    assert.equal(attributes["data-js"], "", `${pathname} marks that scripts run`);
  }
});

test("scroll-reveal sections stay visible without JavaScript or with reduced motion", async () => {
  const { compile } = require("tailwindcss") as typeof import("tailwindcss");
  const compiler = await compile(`@import "tailwindcss/theme"; @import "tailwindcss/utilities";`, {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const path = require.resolve(`${id}.css`);
      return { path, base, content: readFileSync(path, "utf8") };
    },
  });
  for (const file of ["src/app/page.tsx", "src/components/about/about-reveal-section.tsx"]) {
    const classes = readSource(file).match(/"([^"]*will-change-transform[^"]*)"/)?.[1].split(/\s+/);
    assert.ok(classes, file);
    const hiding = classes.filter((name) => /opacity-0|translate-y-/.test(name));
    assert.equal(hiding.length, 2, file);
    for (const name of hiding) {
      assert.match(name, /^motion-safe:\[html\[data-js\]_&\[data-reveal-state=hidden\]\]:/, `${file}: ${name} must be gated`);
    }
    const css = compiler.build(hiding);
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
    assert.match(css, /html\[data-js\] &\[data-reveal-state=hidden\]/, "Tailwind must emit the gated selector");
  }
  // The about cards use the shared observer, which reveals at once for reduced motion.
  assert.match(readSource("src/components/about/about-reveal-section.tsx"), /<ScrollRevealObserver selector="\[data-reveal\]" \/>/);
  assert.match(readSource("src/components/scroll-reveal-observer.tsx"), /prefers-reduced-motion: reduce/);
});

test("footer policies are real links and the terms page carries the refund and file rules", () => {
  const footer = readSource("src/components/site/footer.tsx");
  for (const path of ["/terms", "/privacy", "/terms#refund", "/terms#file-policy"]) {
    assert.match(footer, new RegExp(`path: "${path}"`), path);
  }
  assert.match(footer, /<a\s+key=\{policy\.modal\}\s+href=\{`\$\{siteLinkPrefix\}\$\{policy\.path\}`\}/);
  assert.match(footer, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey\) return;\s+event\.preventDefault\(\);/);

  for (const english of [false, true]) {
    const html = renderToStaticMarkup(createElement(LegalPage, { policy: "terms", english }));
    for (const id of ["refund", "file-policy"]) {
      assert.match(html, new RegExp(`<section id="${id}" aria-labelledby="${id}-title"`), `${id} (${english ? "en" : "ko"})`);
      assert.match(html, new RegExp(`href="${english ? "/en" : ""}/terms#${id}"`));
    }
    assert.match(html, english ? /<h2 id="refund-title"[^>]*>Refund \/ Cancellation Policy<\/h2>/ : /<h2 id="refund-title"[^>]*>환불\/취소 규정<\/h2>/);
  }
  assert.doesNotMatch(renderToStaticMarkup(createElement(LegalPage, { policy: "privacy" })), /id="refund"/);
});

test("the strip banner can be paused and holds still for hover, focus and reduced motion", () => {
  const state = (input: Partial<Parameters<typeof bannerRotationState>[0]>) =>
    bannerRotationState({ count: 3, choice: null, reducedMotion: false, hovered: false, ...input });
  assert.deepEqual(state({}), { playing: true, rotating: true });
  assert.deepEqual(state({ hovered: true }), { playing: true, rotating: false }, "hover holds the current banner");
  assert.deepEqual(state({ choice: "pause" }), { playing: false, rotating: false });
  assert.deepEqual(state({ reducedMotion: true }), { playing: false, rotating: false }, "reduced motion starts paused");
  assert.deepEqual(state({ reducedMotion: true, choice: "play" }), { playing: true, rotating: true }, "the visitor can still start it");
  assert.deepEqual(state({ count: 1 }), { playing: true, rotating: false });

  for (const [playing, english, label] of [
    [true, false, "배너 자동 넘김 멈춤"], [false, false, "배너 자동 넘김 재생"],
    [true, true, "Pause banner rotation"], [false, true, "Play banner rotation"],
  ] as const) {
    const html = renderToStaticMarkup(createElement(BannerRotationToggle, { playing, english, onToggle: () => {}, className: "" }));
    assert.match(html, new RegExp(`<button type="button" aria-label="${label}"`));
    // A calm paper grey that turns white on hover, so the control does not
    // pull the eye away from the banner (same as the arrows).
    assert.match(html, /border-\[#111111\] bg-\[#ebe7de\] text-\[#111111\]/);
    assert.match(html, / hover:bg-white /);
    assert.doesNotMatch(html, /(?<!dark:)bg-\[#f2cf27\]/);
  }
  const arrows = readSource("src/components/site/strip-ad-banner-client.tsx");
  assert.match(arrows, /border-\[#111111\] bg-\[#ebe7de\] text-\[#111111\][^"`]* hover:bg-white /);
  assert.doesNotMatch(arrows, /function BannerNavButton[\s\S]*bg-\[#f2cf27\][\s\S]*function normalizeHref/);

  const banner = readSource("src/components/site/strip-ad-banner-client.tsx");
  assert.match(banner, /useBannerRotation\(safeBanners\.length, ROTATE_MS\)/);
  assert.match(banner, /<BannerRotationToggle/);
  assert.match(banner, /\{\.\.\.regionProps\}/);
  assert.doesNotMatch(banner, /setInterval/);
  // Keyboard focus entering the banner stops it until the visitor resumes it.
  assert.match(readSource("src/components/site/banner-rotation.tsx"), /if \(entered && isKeyboardFocus\(event\.target\)\) setChoice\("pause"\);/);
});

test("public status boxes use the solid house palette, not pastel tints", () => {
  const tinted = /\b(?:bg|border|text)-(?:amber|emerald|rose|red|green|sky|blue|yellow|orange|lime|teal)-(?:50|100|200|300|500|600|700)\b|bg-\[#[0-9a-f]{6}\]\/(?:5|10|15)\b|bg-blue-400\/15|text-blue-300/i;
  for (const file of [
    "src/features/magazine/magazine-request-form.tsx",
    "src/features/credits/credit-action-notice.tsx",
    "src/app/forgot-password/forgot-password-view.tsx",
    "src/components/site/home-hero-ad-banner.tsx",
  ]) {
    assert.doesNotMatch(readSource(file), tinted, file);
  }
  const karaoke = readSource("src/features/karaoke/karaoke-form.tsx").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.doesNotMatch(karaoke, tinted, "karaoke form (outside the parked credit section)");
  assert.match(karaoke, /\$\{brandStatusTones\.success\}`\}>\s*첨부 완료/);
});

test("pages that used to inherit the home title carry their own metadata", () => {
  const korean = readSource("src/app/forgot-password/page.tsx");
  assert.doesNotMatch(korean, /^"use client"/);
  assert.match(korean, /pageMetadata\(\{\s*title: "비밀번호 찾기"[\s\S]*noindex: true/);
  const english = readSource("src/app/en/forgot-password/page.tsx");
  assert.match(english, /locale: "en"[\s\S]*noindex: true/);
  assert.match(english, /export \{ default \} from "@\/app\/forgot-password\/page";/);
  assert.match(readSource("src/app/forgot-password/forgot-password-view.tsx"), /^"use client";/);
  assert.match(readSource("src/app/karaoke-request/page.tsx"), /pageMetadata\(\{[\s\S]*description:[\s\S]*noindex: true/);
  // English pages never fall back to the "| 온사이드" title template.
  for (const file of ["src/app/en/about/page.tsx", "src/app/en/faq/page.tsx", "src/app/en/forms/page.tsx", "src/app/en/support/page.tsx", "src/app/en/guide/page.tsx", "src/app/en/guide/[slug]/page.tsx", "src/app/en/forgot-password/page.tsx"]) {
    assert.match(readSource(file), /pageMetadata\(\{\s*locale: "en"/, file);
  }
});

test("the home hero makes 심의 신청 the yellow main card and keeps 결과 조회 white with a black border", () => {
  const home = readSource("src/app/page.tsx");
  const card = (title: string) => {
    const match = new RegExp(`title: "${title}",[\\s\\S]*?cardClass:\\s*"([^"]+)"`).exec(home);
    assert.ok(match, `${title} card`);
    return match[1];
  };
  const apply = card("심의 신청");
  const results = card("결과 조회");
  // 2026-11-10 editorial pass: shadows are lighter, the 2:1 step between them stays.
  assert.match(apply, /^bg-\[#f2cf27\] text-\[#111111\] shadow-\[4px_4px_0_#111111\]/);
  assert.match(results, /^bg-white text-\[#111111\] shadow-\[2px_2px_0_#111111\]/);
  assert.doesNotMatch(results, /(?<!dark:)bg-\[#(?:f2cf27|1556a4)\]/);
  // Both cards share one size and border; only colour and shadow differ.
  // Owner 2026-11-10: the cards are short (68/80px), the banner above is the visual.
  assert.match(home, /className=\{`group flex min-h-\[68px\] items-center justify-center gap-2\.5 rounded-\[10px\] border-\[1\.5px\] border-\[#111111\] px-3 transition hover:-translate-y-0\.5 sm:min-h-\[80px\] sm:gap-3 \$\{cta\.cardClass\}`\}/);
});

test("the home banner keeps a two-line text headline in both languages and lets visitors stop its motion", () => {
  const home = readSource("src/app/page.tsx");
  assert.match(home, /<HomeHeroBanner lines=\{\["음반·뮤직비디오 심의,", "신청부터 결과 확인까지"\]\} \/>/);
  const banner = readSource("src/components/site/home-hero-banner.tsx");
  assert.match(banner, /<h1 className="onside-hero-title">\s*<span>\{lines\[0\]\}<\/span>\s*<span>\{lines\[1\]\}<\/span>\s*<\/h1>/);
  assert.match(banner, /STATION_GUIDES\.map/, "the band lists the real review offices");
  assert.match(banner, /<StationList hidden \/>/, "the looping copy is hidden from screen readers");
  const css = readSource("src/app/globals.css");
  // Lines never wrap; the size is derived from the banner width per language.
  assert.match(css, /\.onside-hero-title > span \{\s*display: block;\s*white-space: nowrap;/);
  assert.match(css, /\.onside-hero-title \{[^}]*font-size: min\(2\.875rem, calc\(\(100cqi - 2 \* var\(--hero-pad\)\) \/ 10\.6\)\);/);
  assert.match(css, /html\[lang="en"\] \.onside-hero-title \{\s*font-size: min\(2\.5rem, calc\(\(100cqi - 2 \* var\(--hero-pad\)\) \/ 15\.2\)\);/);
  assert.match(css, /\[data-hero-motion="paused"\] \.onside-hero-wave svg,\s*\[data-hero-motion="paused"\] \.onside-hero-track \{\s*animation-play-state: paused;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.onside-hero-wave svg,\s*\.onside-hero-track \{\s*animation: none;/);
  // 2026-11-10: the waveform is the only graphic; it sits in the flow under
  // the headline (never behind it) and no fake play control comes back.
  assert.match(banner, /<div className="onside-hero-wave" aria-hidden="true">/);
  assert.doesNotMatch(banner, /onside-hero-(?:record|play)\b/);
  assert.doesNotMatch(css, /\.onside-hero-(?:record|play)\b/);
  assert.match(css, /\.onside-hero-wave \{[^}]*margin-top: auto;/);
  const toggle = readSource("src/components/site/hero-motion-toggle.tsx");
  assert.match(toggle, /setAttribute\("data-hero-motion", paused \? "paused" : "on"\)/);
  for (const label of ["배너 움직임 멈춤", "배너 움직임 재생", "Pause banner motion", "Play banner motion"]) assert.ok(toggle.includes(label));
});
