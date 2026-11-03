import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { NextRequest } from "next/server";

type Op = [string, ...unknown[]];
type Call = { table: string; ops: Op[] };
type Fixture = {
  POST: (request: NextRequest) => Promise<Response>;
  state: { user: { id: string; email: string } | null; openCount: number; existing: Record<string, unknown> | null; deny: string[]; limits: Array<{ namespace: string; identifier: string; limit: number; windowMs: number }> };
  calls: Call[];
};

async function chatFixture(): Promise<Fixture> {
  const result = await build({
    stdin: { contents: "export {POST} from './src/app/api/chat/route'; export {state,calls} from 'chat-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "chat-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(chat-fixture|@\/lib\/supabase\/(?:server|admin|env)|@\/lib\/request-rate-limit|@\/lib\/support-chat-history)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'chat-fixture';";
        const modules: Record<string, string> = {
          "chat-fixture": `export const calls=[]; export const state={user:null,openCount:0,existing:null,deny:[],limits:[]};
            const row=(values)=>({id:'conversation-new',access_token:'token-new-0123456789abcdef',user_id:null,guest_name:null,guest_email:null,guest_phone:null,status:'WAITING_ADMIN',last_message_preview:null,last_message_at:'2026-11-03T00:00:00Z',unread_admin_count:0,unread_visitor_count:0,visitor_left_at:null,created_at:'2026-11-03T00:00:00Z',updated_at:'2026-11-03T00:00:00Z',...values});
            const resolve=(table,ops)=>{calls.push({table,ops});const names=ops.map(op=>op[0]);
              if(table==='profiles')return {data:{name:'회원',phone:'010'},error:null};
              if(table==='support_chat_messages')return {data:{id:'message',conversation_id:'conversation-new',sender_type:'VISITOR',sender_user_id:null,sender_name:'방문자',body:'hi',created_at:'2026-11-03T00:00:01Z'},error:null};
              const select=ops.find(op=>op[0]==='select');
              if(select&&select[2]&&select[2].head)return {count:state.openCount,error:null,data:null};
              if(names.includes('insert'))return {data:row(ops.find(op=>op[0]==='insert')[1]),error:null};
              if(names.includes('update'))return {data:row(ops.find(op=>op[0]==='update')[1]),error:null};
              return {data:state.existing,error:null};};
            export const chain=(table)=>{const ops=[];const proxy=new Proxy({}, {get(_,prop){
              if(prop==='then')return (ok,fail)=>Promise.resolve(resolve(table,ops)).then(ok,fail);
              if(prop==='maybeSingle')return ()=>Promise.resolve(resolve(table,[...ops,['maybeSingle']]));
              return (...args)=>{ops.push([prop,...args]);return proxy;};}});return proxy;};`,
          "@/lib/supabase/admin": "import {chain} from 'chat-fixture'; export const createAdminClient=()=>({from:chain});",
          "@/lib/supabase/server": `${shared} import {chain} from 'chat-fixture'; export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:state.user}})},from:chain});`,
          "@/lib/supabase/env": "export const getServiceRoleKey=()=> 'fixture-service-key';",
          "@/lib/support-chat-history": "export const loadChatHistory=async()=>({messages:[]}); export const parseChatHistoryCursor=()=>undefined;",
          "@/lib/request-rate-limit": `${shared} export const consumeRateLimit=()=>({allowed:true,retryAfterSeconds:0}); export const consumePersistentRateLimit=async input=>{state.limits.push(input);const allowed=!state.deny.includes(input.namespace);return {allowed,retryAfterSeconds:allowed?0:300};}; export const getRequestIdentifier=headers=>headers.get('x-real-ip')||'unknown';`,
        };
        return { contents: modules[path], loader: "js" };
      });
    } }],
  });
  const bundled = { exports: {} as Fixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  return bundled.exports;
}

const post = (body: Record<string, unknown>) => new NextRequest("https://example.test/api/chat", {
  method: "POST", headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" }, body: JSON.stringify(body),
});
const inserted = (calls: Call[]) => calls.find(call => call.table === "support_chat_conversations" && call.ops.some(op => op[0] === "insert"));
const countCall = (calls: Call[]) => calls.find(call => call.ops.some(op => op[0] === "select" && (op[2] as { head?: boolean } | undefined)?.head));

test("a guest's new conversation passes shared limits and the open-conversation cap, stored under an address HMAC", async () => {
  const chat = await chatFixture();
  const response = await chat.POST(post({ body: "문의드립니다" }));
  assert.equal(response.status, 200);
  assert.deepEqual(chat.state.limits.map(limit => [limit.namespace, limit.identifier]), [["support-chat-new-ip-3600000", "203.0.113.7"], ["support-chat-new-ip-86400000", "203.0.113.7"]]);
  const count = countCall(chat.calls)!;
  assert.ok(count.ops.some(op => op[0] === "is" && op[1] === "user_id" && op[2] === null));
  assert.ok(count.ops.some(op => op[0] === "neq" && op[1] === "status" && op[2] === "CLOSED"));
  const visitorKey = count.ops.find(op => op[0] === "eq" && op[1] === "visitor_key")?.[2];
  assert.match(String(visitorKey), /^[a-f0-9]{64}$/);
  const insert = inserted(chat.calls)!.ops.find(op => op[0] === "insert")![1] as Record<string, unknown>;
  assert.equal(insert.visitor_key, visitorKey);
  assert.doesNotMatch(JSON.stringify(chat.calls), /203\.0\.113\.7/, "the raw address is never written");
});

test("the cap and the shared limit refuse new guest or member conversations with Korean messages", async () => {
  const capped = await chatFixture();
  capped.state.openCount = 3;
  let response = await capped.POST(post({ body: "또 문의" }));
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /진행 중인 상담이 3개/);
  assert.equal(inserted(capped.calls), undefined);

  const limited = await chatFixture();
  limited.state.deny = ["support-chat-new-ip-3600000"];
  response = await limited.POST(post({ body: "문의" }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "300");
  assert.match((await response.json()).error, /새 상담 요청이 너무 많습니다/);
  assert.equal(countCall(limited.calls), undefined);
  assert.equal(inserted(limited.calls), undefined);

  const member = await chatFixture();
  member.state.user = { id: "member-1", email: "member@example.invalid" };
  member.state.openCount = 3;
  response = await member.POST(post({ body: "문의" }));
  assert.equal(response.status, 429);
  assert.ok(countCall(member.calls)!.ops.some(op => op[0] === "eq" && op[1] === "user_id" && op[2] === "member-1"));
  member.state.openCount = 0;
  member.calls.length = 0;
  assert.equal((await member.POST(post({ body: "문의" }))).status, 200);
  assert.equal((inserted(member.calls)!.ops.find(op => op[0] === "insert")![1] as Record<string, unknown>).visitor_key, null);
});

test("messages to an existing conversation are not counted as new conversations", async () => {
  const chat = await chatFixture();
  chat.state.existing = { id: "conversation-1", access_token: "existing-token-0123456789", user_id: null, status: "WAITING_ADMIN", unread_admin_count: 1, visitor_left_at: null };
  chat.state.openCount = 99;
  const response = await chat.POST(post({ body: "이어서", accessToken: "existing-token-0123456789" }));
  assert.equal(response.status, 200);
  assert.equal(chat.state.limits.length, 0);
  assert.equal(inserted(chat.calls), undefined);
});

test("admin chat lists page by the latest message with an id tiebreak", async () => {
  const { loadAdminChatConversationRows, parseAdminChatListLimit, ADMIN_CHAT_PAGE_SIZE, ADMIN_CHAT_LIST_MAX } = await import("../src/features/chat/admin-chat-list");
  assert.equal(parseAdminChatListLimit(null), ADMIN_CHAT_PAGE_SIZE);
  assert.equal(parseAdminChatListLimit("61"), ADMIN_CHAT_PAGE_SIZE * 2);
  assert.equal(parseAdminChatListLimit("100000"), ADMIN_CHAT_LIST_MAX);
  assert.equal(parseAdminChatListLimit("-3"), ADMIN_CHAT_PAGE_SIZE);
  const ops: unknown[][] = [];
  const query = {
    select(...args: unknown[]) { ops.push(["select", ...args]); return query; },
    order(...args: unknown[]) { ops.push(["order", ...args]); return query; },
    async limit(count: number) { ops.push(["limit", count]); return { data: Array.from({ length: count }, (_, index) => ({ id: String(index) })), error: null }; },
  };
  const result = await loadAdminChatConversationRows<{ id: string }>({ from: () => query } as never, "id", 2);
  assert.deepEqual(ops, [["select", "id"], ["order", "last_message_at", { ascending: false, nullsFirst: false }], ["order", "id", { ascending: false }], ["limit", 3]]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.hasMore, true);
  for (const file of ["src/app/admin/chat/page.tsx", "src/app/api/admin/chat/route.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /loadAdminChatConversationRows/, file);
    assert.doesNotMatch(source, /\.limit\(120\)/, file);
  }
  const client = readFileSync("src/features/chat/admin-chat-client.tsx", "utf8");
  assert.match(client, /limit: String\(listLimitRef\.current\)/);
  assert.match(client, /이전 상담 더 보기/);
});

test("support inquiries use shared per-address limits and the admin list pages with a stable order", () => {
  const route = readFileSync("src/app/api/support/inquiries/route.ts", "utf8");
  assert.match(route, /consumePersistentRateLimit\(\{\s*namespace: `support-inquiry-ip-\$\{window\.windowMs\}`/);
  assert.ok(route.indexOf("inquirySchema.safeParse") < route.indexOf("consumePersistentRateLimit({"), "only valid inquiries spend the shared limit");
  const page = readFileSync("src/app/admin/inquiries/page.tsx", "utf8");
  assert.doesNotMatch(page, /\.limit\(200\)/);
  assert.match(page, /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)/);
  assert.match(page, /query\.range\(range\.from, range\.to\)/);
  assert.match(page, /<AdminListPager/);
  assert.match(page, /name="returnTo" value=\{currentPageHref\}/);
  const migration = readFileSync("supabase/migrations/20261103160200_support_chat_visitor_cap.sql", "utf8");
  assert.match(migration, /add column if not exists visitor_key text/);
  assert.match(migration, /visitor_key ~ '\^\[a-f0-9\]\{64\}\$'/);
});
