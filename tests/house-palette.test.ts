import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// The owner's rule (AGENTS.md): no pastel colours. Status and emphasis use the
// solid Bauhaus tones in src/lib/brand-status-tones.ts with black borders.
const sources = readdirSync(new URL("../src", import.meta.url), { recursive: true, encoding: "utf8" })
  .filter((path) => /\.(tsx|ts)$/.test(path))
  .map((path) => ({
    path: `src/${path}`,
    // Parked JSX inside {/* */} is not rendered.
    source: readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\{\/\*[\s\S]*?\*\/\}/g, ""),
  }));

const hues = "amber|emerald|rose|red|green|sky|blue|yellow|orange|lime|teal|cyan|indigo|violet|purple|fuchsia|pink";
const tinted = [
  // Tailwind hue backgrounds and gradients (bg-amber-50, dark:bg-red-500/10 …).
  new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:bg|from|via|to)-(?:${hues})-\\d+(?:/\\d+)?(?![\\w-])`),
  // Hue borders, except hover and focus affordances.
  new RegExp(`(?<![\\w:-])(?:(?:dark|md|sm|lg):)*border-(?:${hues})-\\d+(?:/\\d+)?(?![\\w-])`),
  // Translucent brand tints (bg-[#d9362c]/10, bg-primary/8 …).
  /(?<![\w-])(?:[\w-]+:)*bg-(?:\[#(?:d9362c|1f7a5a|1556a4|f2cf27|3f8ad8|2997ff|ff6258)\]|primary|accent|destructive)\/\d+/,
  /(?<![\w:-])(?:dark:)?border-(?:\[#(?:d9362c|1f7a5a|1556a4|3f8ad8|2997ff)\]|primary|destructive)\/\d+/,
];

test("no source file styles status or emphasis with pastel or translucent tints", () => {
  assert.ok(sources.length > 300);
  for (const { path, source } of sources) {
    for (const pattern of tinted) {
      const match = pattern.exec(source);
      assert.equal(match, null, `${path}: ${match?.[0]}`);
    }
  }
});

test("hover and focus outlines and parked JSX are the only hue borders left", () => {
  const radio = sources.find(({ path }) => path.endsWith("radio-request-ui.tsx"))!.source;
  assert.match(radio, /focus-visible:border-blue-700/);
  assert.match(sources.find(({ path }) => path.endsWith("brand-status-tones.ts"))!.source, /danger: "border-\[var\(--bauhaus-ink\)\] bg-\[#d9362c\] text-white"/);
});
