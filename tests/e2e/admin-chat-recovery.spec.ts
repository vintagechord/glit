import { expect, test, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import type { SupportChatConversation } from "../../src/lib/support-chat";

const fixtureId = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const a: SupportChatConversation = { id: fixtureId(1), accessToken: "fixture-conversation-token-alpha", userId: null, guestName: "상담 A", guestEmail: null, guestPhone: null, status: "OPEN", lastMessagePreview: "A 상담 목록", lastMessageAt: "2026-09-10T02:00:00Z", unreadAdminCount: 0, unreadVisitorCount: 0, visitorLeftAt: null, createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T02:00:00Z" };
const b = { ...a, id: fixtureId(2), accessToken: "fixture-conversation-token-bravo", guestName: "상담 B", lastMessagePreview: "B 상담 목록", lastMessageAt: "2026-09-10T01:00:00Z" };
const message = (conversation = a, body = "최신 답변", number = 10) => ({ id: fixtureId(number), conversationId: conversation.id, senderType: "VISITOR", senderUserId: null, senderName: null, body, createdAt: "2026-09-10T00:00:10Z" });
const documents = new Map<string, Promise<string>>();
function documentFor(component: "admin" | "visitor" | "artist" | "config") {
  if (!documents.has(component)) documents.set(component, (async () => {
    const entry = component === "admin"
      ? `import {AdminChatClient as Component} from './src/features/chat/admin-chat-client'; const props={initialConversations:${JSON.stringify([a, b])}};`
      : component === "visitor" ? `import {ChatbotWidget as Component} from './src/components/chatbot-widget'; const props={};`
        : component === "config" ? `import {AdminActionForm} from './src/components/admin/action-form'; function Component(){return <AdminActionForm action={async form=>{window.__submittedForm=Object.fromEntries(form);await new Promise(resolve=>window.__resolveSave=resolve);return window.__saveResult;}}><input name="name" defaultValue="패키지 기존 이름"/><button type="submit" name="quickDiscountPercent" value="30">30% 적용</button></AdminActionForm>}; const props={};`
        : `import {ArtistEditorForm as Component} from './src/components/admin/artist-editor-form'; const props={artistId:'${fixtureId(1)}',initialName:'기존 이름',initialThumbnailUrl:'/api/admin/uploads/free?objectKey=artist-thumbnails%2Fold.jpg',action:async (_previous,form)=>{window.__savedName=form.get('name'); await new Promise(resolve=>window.__resolveSave=resolve); return window.__saveResult;}};`;
    const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; ${entry} createRoot(document.getElementById('root')).render(React.createElement(Component, props));`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", minify: true, define: { "process.env": '{"NODE_ENV":"production"}' }, plugins: [{ name: "isolated-browser-services", setup(build) {
      build.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: "supabase", namespace: "mock" }));
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "mock" }));
      build.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "mock" }));
      build.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "supabase" ? `const channels = new Set(); window.__chatBroadcast = payload => channels.forEach(channel=>channel.callback?.({payload})); export const createClient=()=>({channel(){const channel={on(_a,_b,callback){this.callback=callback;return this},subscribe(){channels.add(this);return this},async send(){return 'ok'}};return channel},removeChannel(channel){channels.delete(channel)}});` : args.path === "navigation" ? `export const usePathname=()=>'/'; export const unstable_rethrow=error=>{if(error?.digest?.startsWith('NEXT_REDIRECT')) throw error;};` : `import React from 'react'; export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>}` }));
    } }] });
    return `<!doctype html><html lang="ko"><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  })());
  return documents.get(component)!;
}
async function mount(page: Page, component: "admin" | "visitor" | "artist" | "config", api: (route: Route) => Promise<void>) {
  const html = await documentFor(component);
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/isolated-admin-check") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname.startsWith("/api/")) return api(route);
    return route.fulfill({ status: 404 });
  });
  await page.goto("/isolated-admin-check");
}
async function broadcast(page: Page, payload: unknown) {
  await page.evaluate(payload => (window as unknown as { __chatBroadcast: (payload: unknown) => void }).__chatBroadcast(payload), payload);
}

test("admin chat recovers from overlapping foreground/poll loads and retains fetched messages after read-receipt failure", async ({ page }) => {
  let firstThread: Route | undefined; let firstList: Route | undefined; let threads = 0; let lists = 0;
  await mount(page, "admin", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "PATCH") return route.fulfill({ status: 500, json: { error: "읽음 저장 테스트 실패" } });
    if (url.searchParams.has("conversationId")) {
      if (++threads === 1) { firstThread = route; return; }
      return route.fulfill({ json: { conversation: { ...a, unreadAdminCount: 1 }, messages: [message()] } });
    }
    if (++lists === 1) { firstList = route; return; }
    return route.fulfill({ json: { conversations: [a, b] } });
  });
  await expect.poll(() => !!firstThread).toBe(true);
  await broadcast(page, { conversation: a });
  await expect(page.getByText("최신 답변", { exact: true })).toBeVisible();
  await expect(page.getByText("읽음 저장 테스트 실패", { exact: true })).toBeVisible();
  await firstThread!.fulfill({ json: { conversation: a, messages: [message(a, "이전 요청의 오래된 답변")] } });
  await expect(page.getByText("이전 요청의 오래된 답변")).toHaveCount(0);
  const refresh = page.getByRole("button", { name: "채팅 목록 새로고침" });
  await refresh.click(); await expect.poll(() => !!firstList).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(refresh).toBeEnabled();
  await firstList!.fulfill({ json: { conversations: [] } });
  await expect(page.getByRole("heading", { name: "상담 A" })).toBeVisible();
});

test("admin chat keeps drafts and in-flight replies in their own conversation and loads older history", async ({ page }) => {
  let post: Route | undefined;
  await mount(page, "admin", async route => {
    if (route.request().method() === "POST") { post = route; return; }
    const url = new URL(route.request().url()); const conversation = url.searchParams.get("conversationId") === b.id ? b : a;
    if (!url.searchParams.has("conversationId")) return route.fulfill({ json: { conversations: [a, b] } });
    return route.fulfill({ json: { conversation, messages: [message(conversation, url.searchParams.has("before") ? "이전 상담 기록" : `${conversation.guestName} 최신 기록`, url.searchParams.has("before") ? 3 : 10)], earlierCursor: url.searchParams.has("before") ? null : { id: fixtureId(10), createdAt: "2026-09-10T00:00:10Z" } } });
  });
  const draft = page.getByPlaceholder("관리자 답변을 입력하세요.");
  await expect(page.getByText("상담 A 최신 기록", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이전 메시지 더 보기" }).click();
  await expect(page.getByText("이전 상담 기록", { exact: true })).toBeVisible();
  await expect(page.getByText("상담 A 최신 기록", { exact: true })).toBeVisible();
  expect(await page.getByText(/^(이전 상담 기록|상담 A 최신 기록)$/).allTextContents()).toEqual(["이전 상담 기록", "상담 A 최신 기록"]);
  await broadcast(page, { conversation: a });
  await expect(page.getByText("이전 상담 기록", { exact: true })).toBeVisible();
  await draft.fill("A 답변 초안");
  await page.getByRole("button", { name: /상담 B.*B 상담 목록/ }).click();
  await expect(draft).toHaveValue(""); await draft.fill("B 답변 초안");
  await page.getByRole("button", { name: /상담 A.*A 상담 목록/ }).click();
  await expect(draft).toHaveValue("A 답변 초안");
  await page.getByRole("button", { name: "관리자 답변 보내기" }).click(); await expect.poll(() => !!post).toBe(true);
  await page.getByRole("button", { name: /상담 B.*B 상담 목록/ }).click();
  await post!.fulfill({ json: { conversation: a, message: { ...message(a, "A 전송 완료", 20), senderType: "ADMIN" } } });
  await expect(draft).toHaveValue("B 답변 초안");
  await expect(page.getByText("A 전송 완료", { exact: true })).toHaveCount(0);
  await expect(page.getByText("상담 B 최신 기록", { exact: true })).toBeVisible();
});

test("visitor chat preserves older messages and isolates an in-flight send when switching conversations", async ({ page }) => {
  let post: Route | undefined;
  await mount(page, "visitor", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === "POST") { post = route; return; }
    if (url.searchParams.has("list")) return route.fulfill({ json: { conversations: [a, b] } });
    const conversation = request.headers()["x-support-chat-token"] === b.accessToken ? b : a;
    return route.fulfill({ json: { conversation, messages: [message(conversation, url.searchParams.has("before") ? "이전 고객 상담" : `${conversation.guestName} 최신 기록`, url.searchParams.has("before") ? 3 : 10)], earlierCursor: url.searchParams.has("before") ? null : { id: fixtureId(10), createdAt: "2026-09-10T00:00:10Z" } } });
  });
  await page.getByRole("button", { name: "실시간 채팅 열기" }).click();
  await page.getByRole("button", { name: "대화 목록", exact: true }).click();
  await page.getByRole("button", { name: /A 상담 목록/ }).click();
  await page.getByRole("button", { name: "이전 메시지 더 보기" }).click();
  await expect(page.getByText("이전 고객 상담", { exact: true })).toBeVisible();
  await broadcast(page, { conversation: a });
  await expect(page.getByText("이전 고객 상담", { exact: true })).toBeVisible();
  const draft = page.locator("textarea");
  await draft.fill("A 고객 초안");
  await page.getByRole("button", { name: "대화 목록으로 돌아가기", exact: true }).click();
  await page.getByRole("button", { name: /B 상담 목록/ }).click();
  await expect(draft).toHaveValue(""); await draft.fill("B 고객 초안");
  await page.getByRole("button", { name: "대화 목록으로 돌아가기", exact: true }).click();
  await page.getByRole("button", { name: /A 상담 목록/ }).click();
  await expect(draft).toHaveValue("A 고객 초안");
  await page.getByRole("button", { name: "메시지 보내기" }).click(); await expect.poll(() => !!post).toBe(true);
  await page.getByRole("button", { name: "대화 목록으로 돌아가기", exact: true }).click();
  await page.getByRole("button", { name: /B 상담 목록/ }).click();
  await post!.fulfill({ json: { conversation: a, message: message(a, "A 고객 전송 완료", 20) } });
  await expect(draft).toHaveValue("B 고객 초안");
  await expect(page.getByText("A 고객 전송 완료", { exact: true })).toHaveCount(0);
  await expect(page.getByText("상담 B 최신 기록", { exact: true })).toBeVisible();
});

test("artist save reports failures without losing edits and removal preserves the persisted image before save", async ({ page }) => {
  const deletes: string[] = [];
  await mount(page, "artist", async route => { if (route.request().method() === "DELETE") deletes.push(route.request().url()); await route.fulfill({ status: 404 }); });
  await page.getByRole("textbox").fill("변경할 이름");
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.getByText("삭제를 선택했습니다. 저장하면 반영됩니다.")).toBeVisible();
  expect(deletes).toEqual([]);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "저장 중..." })).toBeDisabled();
  await page.evaluate(() => { const state = window as unknown as { __saveResult: object; __resolveSave: () => void }; state.__saveResult = { error: "테스트 저장 실패" }; state.__resolveSave(); });
  await expect(page.getByRole("alert")).toHaveText("테스트 저장 실패");
  await expect(page.getByRole("textbox")).toHaveValue("변경할 이름");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "저장 중..." })).toBeDisabled();
  await page.evaluate(() => { const state = window as unknown as { __saveResult: object; __resolveSave: () => void }; state.__saveResult = { message: "아티스트 정보를 저장했습니다." }; state.__resolveSave(); });
  await expect(page.getByRole("status")).toHaveText("아티스트 정보를 저장했습니다.");
  await expect(page.getByRole("alert")).toHaveCount(0);
});


test("configuration save preserves entered values and submit-button data after a database failure", async ({ page }) => {
  await mount(page, "config", async route => { await route.fulfill({ status: 404 }); });
  await page.getByRole("textbox").fill("입력한 패키지명");
  await page.getByRole("button", { name: "30% 적용" }).click();
  await expect(page.getByRole("button", { name: "30% 적용" })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __submittedForm: object }).__submittedForm)).toEqual({ name: "입력한 패키지명", quickDiscountPercent: "30" });
  await page.evaluate(() => { const state = window as unknown as { __saveResult: object; __resolveSave: () => void }; state.__saveResult = { error: "설정 저장 테스트 실패" }; state.__resolveSave(); });
  await expect(page.getByRole("alert")).toHaveText("설정 저장 테스트 실패");
  await expect(page.getByRole("textbox")).toHaveValue("입력한 패키지명");
  await expect(page.getByRole("button", { name: "30% 적용" })).toBeEnabled();
});
