import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("admin dashboard cards rely on concise titles and counts", () => {
  const source = readSource("src/app/admin/page.tsx");

  assert.match(source, />대시보드<\/h1>/);
  assert.doesNotMatch(source, /관리자 대시보드|처리할 업무를 선택하세요/);
  assert.doesNotMatch(source, /description: string|description="/);
  assert.doesNotMatch(source, /전체 유형 합산/);
  assert.doesNotMatch(
    source,
    /접수 리스트와 결제 승인|메타 정보를 관리합니다|요청 접수를 관리합니다/,
  );
});

test("admin list pages omit decorative admin kickers and repeated intros", () => {
  const listPages = [
    "submissions/page.tsx",
    "payments/page.tsx",
    "artists/page.tsx",
    "banners/page.tsx",
    "chat/page.tsx",
    "config/page.tsx",
    "credits/page.tsx",
    "credits/requests/page.tsx",
    "files/page.tsx",
    "inquiries/page.tsx",
    "karaoke/page.tsx",
    "magazine/page.tsx",
    "users/page.tsx",
  ].map((path) => readSource(`src/app/admin/${path}`));

  for (const source of listPages) {
    assert.doesNotMatch(source, />\s*(?:Admin|관리자|관리자 설정)\s*</);
  }

  const combined = listPages.join("\n");
  assert.doesNotMatch(
    combined,
    /심의 접수에 등장한 아티스트를 관리합니다|문의 내용과 처리 상태를 관리합니다|회원 정보와 연락처를 확인합니다/,
  );
});

test("submission detail keeps one workflow status source and operational data", () => {
  const source = readSource("src/app/admin/submissions/detail/page.tsx");
  const header = source.match(
    /<div className="flex flex-wrap items-start justify-between gap-4">([\s\S]*?)<div className="mt-8 rounded/,
  )?.[1];
  const summary = source.match(
    /<aside className="space-y-4 xl:sticky[\s\S]*?자료 요약([\s\S]*?)<p className="text-xs font-semibold uppercase tracking-\[0\.3em\] text-muted-foreground">\s*신청자/,
  )?.[1];

  assert.ok(header, "detail header must exist");
  assert.doesNotMatch(header, /statusLabel|paymentLabel|>\s*관리자\s*</);
  assert.match(header, /ID: \{submission\.id\.slice\(0, 8\)\}/);

  assert.ok(summary, "compact material summary must exist");
  assert.doesNotMatch(summary, /접수 상태|paymentLabel|statusLabel/);
  assert.match(summary, /\{files\.length\}개/);
  assert.match(summary, /\{completedReviewCount\}\/\{reviews\.length\}/);

  assert.match(source, /const workflowSteps/);
  assert.match(source, /saveSubmissionAdminFormAction/);
  assert.match(source, /latestEvent\.event_type/);
  assert.match(source, /value: hasPaymentComplete \? "결제 완료" : paymentLabel/);
});
