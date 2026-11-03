import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("English member pages carry their own English, non-indexed tab titles", () => {
  for (const path of [
    "src/app/en/dashboard/page.tsx",
    "src/app/en/dashboard/history/page.tsx",
    "src/app/en/dashboard/artists/[id]/page.tsx",
    "src/app/en/dashboard/submissions/[id]/page.tsx",
    "src/app/en/mypage/page.tsx",
    "src/app/en/mypage/history/page.tsx",
    "src/app/en/mypage/drafts/page.tsx",
    "src/app/en/mypage/profile/page.tsx",
    "src/app/en/mypage/cart/page.tsx",
    "src/app/en/mypage/credits/page.tsx",
    "src/app/en/mypage/music/page.tsx",
    "src/app/en/mypage/music/results/[id]/page.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /export \{ metadata \} from "@\/app\/(?!en\/)/, path);
    // The root template would append the Korean site name to a plain title.
    assert.match(source, /title: \{ absolute: "[A-Z][^"가-힣]* \| Onside" \}/, path);
    assert.match(source, /robots: \{ index: false, follow: false \}/, path);
  }
  assert.match(read("src/app/mypage/submissions/[id]/page.tsx"), /title: "심의 상세"/);
});

test("the English archive result page keeps its links under /en", () => {
  const page = read("src/app/en/mypage/music/results/[id]/page.tsx");
  assert.doesNotMatch(page, /export \{ default \} from/);
  assert.match(page, /SubmissionDetailPageView\(\{[\s\S]*view: "archive-result"[\s\S]*localePrefix: "\/en"/);
  assert.match(page, /export const dynamic = "force-dynamic";/);
});

test("server-rendered detail and archive error states have English copy", () => {
  const view = read("src/app/dashboard/submissions/[id]/view.tsx");
  const states = view.slice(view.indexOf("export async function SubmissionDetailPageView"));
  assert.match(view, /const copy = detailCopy\[localePrefix === "\/en" \? "en" : "ko"\];/);
  // No hard-coded Korean remains in the rendered error and empty states.
  assert.doesNotMatch(states.slice(0, states.indexOf("const fallbackPackage")), /[가-힣]/);
  assert.match(view, /en: \{[\s\S]*invalidTitle: "Invalid submission ID\."[\s\S]*backToHistory: "Back to My Review History"/);

  const album = read("src/app/dashboard/new/album/view.tsx");
  assert.match(album, /isEnglish \? "Return to My Music" : "내 음악 관리로 돌아가기"/);
});
