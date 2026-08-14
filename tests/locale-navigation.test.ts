import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("English artist history links have a locale-aware detail route", () => {
  const history = readSource("src/components/dashboard/artist-history.tsx");
  const detail = readSource("src/app/dashboard/artists/[id]/page.tsx");
  const englishWrapper = readSource(
    "src/app/en/dashboard/artists/[id]/page.tsx",
  );

  assert.match(
    history,
    /href=\{`\$\{localePrefix\}\/dashboard\/artists\/\$\{encodeURIComponent\(group\.artistId\)\}`\}/,
  );
  assert.match(detail, /localePrefix\?: "" \| "\/en"/);
  assert.match(englishWrapper, /localePrefix: "\/en"/);
});

test("English magazine credit requests preserve locale on every redirect", () => {
  const englishWrapper = readSource("src/app/en/magazine/page.tsx");
  const page = readSource("src/app/magazine/page.tsx");
  const actions = readSource("src/features/credits/actions.ts");

  assert.match(englishWrapper, /localePrefix: "\/en"/);
  assert.match(
    page,
    /redirectTo=\{`\$\{localePrefix\}\/magazine\?tab=services#credit-use`\}/,
  );
  assert.match(actions, /"\/en\/magazine"/);
  assert.match(
    actions,
    /parsed\.success \? parsed\.data\.redirectTo : rawRedirectTo/,
  );
});

test("English header home and logout actions preserve locale", () => {
  const header = readSource("src/components/site/header.tsx");
  const logout = readSource("src/app/logout/route.ts");

  assert.match(header, /<SiteLogo href=\{isEnglishRoute \? "\/en" : "\/"\} \/>/);
  assert.match(
    header,
    /action=\{isEnglishRoute \? "\/logout\?next=%2Fen" : "\/logout"\}/,
  );
  assert.match(logout, /getSafeInternalPath/);
  assert.match(
    logout,
    /new URL\(requestedPath \?\? "\/", getBaseUrl\(request\)\)/,
  );
});
