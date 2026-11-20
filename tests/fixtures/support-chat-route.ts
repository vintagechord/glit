import { createRequire } from "node:module";
import { build } from "esbuild";
import type { NextRequest } from "next/server";

export type ChatFixtureState = {
  user: { id: string; email: string } | null;
  profile: { role?: string; name?: string | null; phone?: string | null } | null;
  conversation: Record<string, unknown> | null;
  history: unknown[];
};

export type ChatRouteFixture = {
  GET: (request: NextRequest) => Promise<Response>;
  POST: (request: NextRequest) => Promise<Response>;
  state: ChatFixtureState;
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
};

// In-memory stand-ins for the database, session, rate limits and message
// history. No network, database or Supabase project is involved.
const fixtureModules: Record<string, string> = {
  "chat-fixture": `
    export const state = { user: null, profile: null, conversation: null, history: [] };
    export const inserts = [];
    const respond = (table, ops) => {
      if (table === "profiles") return { data: state.profile, error: null };
      const insert = ops.find((op) => op[0] === "insert");
      if (insert) {
        inserts.push({ table, values: insert[1] });
        if (table === "support_chat_messages") return { data: { id: "message-new", created_at: "2026-11-21T00:00:00Z", ...insert[1] }, error: null };
        return { data: { ...state.conversation, ...insert[1] }, error: null };
      }
      const update = ops.find((op) => op[0] === "update");
      if (update) return { data: { ...state.conversation, ...update[1] }, error: null };
      const select = ops.find((op) => op[0] === "select");
      if (select && select[2] && select[2].head) return { count: 0, data: null, error: null };
      return { data: state.conversation, error: null };
    };
    export const chain = (table) => {
      const ops = [];
      const proxy = new Proxy({}, { get(_, prop) {
        if (prop === "then") return (ok, fail) => Promise.resolve(respond(table, ops)).then(ok, fail);
        if (prop === "maybeSingle") return () => Promise.resolve(respond(table, [...ops, ["maybeSingle"]]));
        return (...args) => { ops.push([prop, ...args]); return proxy; };
      } });
      return proxy;
    };`,
  "@/lib/supabase/admin": "import { chain } from 'chat-fixture'; export const createAdminClient = () => ({ from: chain });",
  "@/lib/supabase/server": "import { chain, state } from 'chat-fixture'; export const createServerSupabase = async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: chain });",
  "@/lib/supabase/env": "export const getServiceRoleKey = () => 'fixture-service-key';",
  "@/lib/request-rate-limit": "export const consumeRateLimit = () => ({ allowed: true, retryAfterSeconds: 0 }); export const consumePersistentRateLimit = async () => ({ allowed: true, retryAfterSeconds: 0 }); export const getRequestIdentifier = () => 'unknown';",
  "@/lib/support-chat-history": "import { state } from 'chat-fixture'; export const loadChatHistory = async () => ({ messages: state.history, earlierCursor: null }); export const parseChatHistoryCursor = () => undefined;",
};

/** Bundles a chat route with its database, session and history modules replaced by the fixtures above. */
export async function chatRouteFixture(
  route: "src/app/api/chat/route" | "src/app/api/admin/chat/route",
): Promise<ChatRouteFixture> {
  const result = await build({
    stdin: {
      contents: `export { GET, POST } from './${route}'; export { state, inserts } from 'chat-fixture';`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    write: false,
    plugins: [{
      name: "support-chat-route-fixture",
      setup(plugin) {
        plugin.onResolve(
          { filter: /^(chat-fixture|@\/lib\/supabase\/(?:server|admin|env)|@\/lib\/request-rate-limit|@\/lib\/support-chat-history)$/ },
          (args) => ({ path: args.path, namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: fixtureModules[path], loader: "js" }));
      },
    }],
  });
  const bundled = { exports: {} as ChatRouteFixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  return bundled.exports;
}
