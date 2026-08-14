import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("mobile header keeps account actions compact and accessible", () => {
  const source = readSource("src/components/site/header.tsx");

  assert.match(source, /const subtleButtonClass =\s*\n\s*"[^"]*w-10/);
  assert.match(source, /const primaryButtonClass =\s*\n\s*"[^"]*w-10/);
  assert.match(source, /aria-label=\{isEnglishRoute \? "Login" : "로그인"\}/);
  assert.match(source, /<LogIn className="h-4 w-4 sm:hidden"/);
  assert.match(source, /<UserPlus className="h-4 w-4 sm:hidden"/);
});

test("dashboard status dialogs collapse three columns on narrow viewports", () => {
  for (const relativePath of [
    "src/components/dashboard/submission-status-list.tsx",
    "src/components/dashboard/history-list.tsx",
  ]) {
    const source = readSource(relativePath);

    assert.match(
      source,
      /grid-cols-\[minmax\(0,1fr\)_minmax\(100px,auto\)\]/,
    );
    assert.match(
      source,
      /sm:grid-cols-\[minmax\(0,1\.4fr\)_minmax\(110px,0\.8fr\)_96px\]/,
    );
    assert.match(source, /max-h-\[calc\(100dvh-2rem\)\]/);
    assert.match(source, /className="hidden text-right[^\"]*sm:block"/);
  }
});

test("central dialog host is bounded by the dynamic viewport", () => {
  const source = readSource("src/components/ui/centered-dialog-host.tsx");

  assert.match(source, /max-h-\[calc\(100dvh-3rem\)\]/);
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
});

test("mobile form controls avoid focus zoom", () => {
  const source = readSource("src/app/globals.css");

  assert.match(source, /@media \(max-width: 639px\) and \(pointer: coarse\)/);
  assert.match(source, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  assert.match(source, /font-size: 16px/);
  assert.match(source, /min-height: 100vh;\s*min-height: 100dvh;/);
});
