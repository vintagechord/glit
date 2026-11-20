import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

// 상태 저장 on the admin detail page posts the 운영 단계 with every memo, title
// or artist edit. A stage the administrator did not choose must leave the
// application where it is: a refund stays a refund, a broadcast MV with a
// 보완 요청 station stays in review, and a page drawn before a station result
// (or open in another tab) cannot write its old stage back.

const submissionId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const refundedOrder = { id: orderId, status: "REFUNDED", payment_method: "BANK" };

type Row = Record<string, unknown>;
type Api = {
  saveSubmissionAdminFormAction: (form: FormData) => Promise<void>;
  state: { submission: Row; order: Row | null; memo: string | null };
  calls: Array<{ name: string; input: Row }>;
};

const modules: Record<string, string> = {
  "actions-fixture": `
    export const calls = [];
    export const state = { submission: {}, order: null, memo: null };
    // protect_submission_order_state (0097_submission_orders.sql): an
    // order-linked row refuses money edits, and every update that leaves it
    // unpaid in review or result.
    const orderStateRefuses = (old, next) => {
      const status = next.status ?? old.status;
      return Boolean(old.current_order_id) && (
        ("payment_status" in next && next.payment_status !== old.payment_status)
        || (["DRAFT", "PRE_REVIEW"].includes(status) && status !== old.status)
        || (old.payment_status !== "PAID" && ["IN_PROGRESS", "RESULT_READY", "COMPLETED"].includes(status)));
    };
    const single = (load) => { const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => load() }; return chain; };
    export const db = {
      auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) },
      async rpc(name, args) { calls.push({ name: "rpc", input: { name, ...args } }); return { data: null, error: { message: "unexpected rpc" } }; },
      from(table) {
        if (table === "submission_admin_memos") return {
          ...single(() => ({ data: state.memo === null ? null : { memo: state.memo }, error: null })),
          async upsert(value) { calls.push({ name: "memo", input: value }); state.memo = value.memo; return { error: null }; },
          delete: () => ({ eq: async () => { calls.push({ name: "memo", input: { memo: null } }); state.memo = null; return { error: null }; } }),
        };
        if (table === "submission_orders") return single(() => ({ data: state.order, error: null }));
        if (table === "submission_events") return { async insert(value) { calls.push({ name: "event", input: value }); return { error: null }; } };
        let payload = null;
        const chain = {
          select: () => chain, eq: () => chain,
          update(value) { payload = value; return chain; },
          async maybeSingle() {
            if (payload) {
              calls.push({ name: "write", input: payload });
              if (orderStateRefuses(state.submission, payload)) return { data: null, error: { code: "55000", message: "ORDER_STATE_REQUIRES_ATOMIC_ACTION" } };
              Object.assign(state.submission, payload);
            }
            return { data: { ...state.submission }, error: null };
          },
        };
        return chain;
      },
    };`,
  "@/lib/supabase/admin": "import {db} from 'actions-fixture'; export const createAdminClient = () => db;",
  "@/lib/supabase/server": "import {db} from 'actions-fixture'; export const createServerSupabase = async () => db;",
  "@/lib/payments/notifications": "import {calls} from 'actions-fixture'; export const sendPaidSubmissionNotificationsById = async input => { calls.push({ name: 'paid-notice', input }); return {}; };",
  "@/lib/admin/action-auth": "export const requireAdminAction = async () => ({ id: 'admin' });",
  "@/lib/admin/submission-notifications": "import {calls} from 'actions-fixture'; const record = name => async input => { calls.push({ name, input }); return {}; }; export const sendSubmissionUpdateNotificationById = record('notice'); export const sendReviewSummaryNotificationById = record('summary'); export const sendOnlineMvResultNotificationById = record('bundle'); export const sendSubmissionResultNotificationById = record('result');",
  "@/lib/admin/mv-review-flow": "export const completeMvReviewFlow = async () => ({ completed: false }); export const resolveMvFallbackStationId = async () => ({ stationId: null });",
  "next/server": "export const after = () => {};",
  "next/cache": "export const revalidatePath = () => {}; export const updateTag = () => {};",
  "next/navigation": "export const redirect = url => { throw Error('redirect:' + url); };",
};

let bundled: Promise<string> | undefined;
const bundleActions = () => bundled ??= build({
  stdin: { contents: "export {saveSubmissionAdminFormAction} from './src/features/admin/actions'; export {state, calls} from 'actions-fixture';", resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "actions-fixture", setup(plugin) {
    plugin.onResolve({ filter: new RegExp(`^(${Object.keys(modules).map((name) => name.replace(/[/@.]/g, "\\$&")).join("|")})$`) }, (args) => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: modules[path], loader: "js" }));
  } }],
}).then((result) => result.outputFiles[0].text);

async function fixture(submission: Row, order: Row | null = null): Promise<Api> {
  const output = { exports: {} as Api };
  new Function("require", "module", "exports", await bundleActions())(createRequire(import.meta.url), output, output.exports);
  Object.assign(output.exports.state, {
    submission: {
      id: submissionId, type: "ALBUM", status: "IN_PROGRESS", payment_status: "PAID", current_order_id: null,
      title: "Original", artist_name: "Artist", artist_name_kr: null, mv_desired_rating: null, result_status: null,
      result_notified_at: null, ...submission,
    },
    order,
  });
  return output.exports;
}

/** Posts the form as the page does and returns the query of the redirect. */
async function save(api: Api, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ submissionId, title: "Original", artistName: "Artist", ...fields })) form.set(key, value);
  const outcome = await api.saveSubmissionAdminFormAction(form).then(() => null, (error: unknown) => error);
  assert.ok(outcome instanceof Error && outcome.message.startsWith("redirect:"), `the save redirects: ${String(outcome)}`);
  return new URL(outcome.message.slice("redirect:".length), "https://admin.test").searchParams;
}

const named = (api: Api, name: string) => api.calls.filter((call) => call.name === name);

test("saving the detail form never marks a refunded desk album paid again", async () => {
  // Registered from the desk: paid, no order. A refund sets REFUNDED and keeps
  // the status. 결과 준비, 결제완료 and 심의진행 all stored PAID, and with no
  // order the save wrote that onto the row: the refund vanished.
  for (const [status, stage] of [["RESULT_READY", "RESULT_NOTIFIED"], ["IN_PROGRESS", "REVIEW_IN_PROGRESS"], ["PRE_REVIEW", "PAYMENT_COMPLETE"]]) {
    const api = await fixture({ status, payment_status: "REFUNDED" });
    // The stage differs from the one the page showed (a select left on its
    // old option by the refund panel's refresh), or comes from a page drawn
    // before the shown stage was posted.
    for (const shown of ["APPLICATION_RECEIVED", ""]) {
      const saved = await save(api, { operationalStage: stage, renderedOperationalStage: shown, title: "Fixed title" });
      assert.equal(saved.get("saved"), "status", saved.get("savedError") ?? "");
      assert.deepEqual([api.state.submission.status, api.state.submission.payment_status], [status, "REFUNDED"], `${stage} on ${status}`);
      assert.equal(api.state.submission.title, "Fixed title");
    }
    assert.equal(named(api, "paid-notice").length, 0);
  }
});

test("a staff note on an order refunded mid-review neither resets its stage nor mails the customer", async () => {
  // The page shows a refunded row as 신청접수. Saved, that stored SUBMITTED and
  // mailed the refunded customer "운영 단계: 신청접수".
  const api = await fixture({ status: "IN_PROGRESS", payment_status: "REFUNDED", current_order_id: orderId }, refundedOrder);
  const saved = await save(api, { operationalStage: "APPLICATION_RECEIVED", adminMemo: "환불 안내함" });
  assert.equal(saved.get("saved"), "status", saved.get("savedError") ?? "");
  assert.deepEqual([api.state.submission.status, api.state.submission.payment_status], ["IN_PROGRESS", "REFUNDED"]);
  assert.equal(api.state.memo, "환불 안내함");
  assert.equal(named(api, "notice").length, 0);
  // The order trigger refuses every update of this row, so a save that
  // changes nothing on it leaves it alone.
  assert.equal(named(api, "write").length, 0);
});

test("a refunded order's result keeps its note editable and refuses a rename plainly", async () => {
  // 결과 준비 maps to PAID, which a refunded order cannot take: every save was
  // refused with "결제 완료로 처리할 수 없는 주문 상태입니다".
  const api = await fixture({ status: "RESULT_READY", payment_status: "REFUNDED", current_order_id: orderId }, refundedOrder);
  let saved = await save(api, { operationalStage: "RESULT_NOTIFIED", adminMemo: "환불 후 결과 보관" });
  assert.equal(saved.get("saved"), "status", saved.get("savedError") ?? "");
  assert.equal(api.state.memo, "환불 후 결과 보관");
  assert.deepEqual([api.state.submission.status, api.state.submission.payment_status], ["RESULT_READY", "REFUNDED"]);
  // The trigger also refuses a rename; say why instead of its code.
  saved = await save(api, { operationalStage: "RESULT_NOTIFIED", title: "Renamed" });
  assert.equal(saved.get("saved"), "error");
  assert.match(saved.get("savedError") ?? "", /^환불된 주문/);
  assert.equal(api.state.submission.title, "Original");
});

test("a memo saved on a broadcast MV with a 보완 요청 station keeps it in review", async () => {
  // save_station_review_result leaves the MV IN_PROGRESS with result_status
  // NEEDS_FIX. The page posted a hidden 결과 준비 for it, so any save moved it
  // to RESULT_READY and showed the customer 결과 통보 완료. Even a page that
  // shows 결과 준비 no longer moves it when the stage is left alone.
  const api = await fixture({ type: "MV_BROADCAST", status: "IN_PROGRESS", result_status: "NEEDS_FIX" });
  const saved = await save(api, { operationalStage: "RESULT_NOTIFIED", renderedOperationalStage: "RESULT_NOTIFIED", adminMemo: "KBS 보완 요청 안내함" });
  assert.equal(saved.get("saved"), "status", saved.get("savedError") ?? "");
  assert.equal(api.state.submission.status, "IN_PROGRESS");
  assert.equal(api.state.memo, "KBS 보완 요청 안내함");
});

test("a page drawn before the last station result cannot pull the album back into review", async () => {
  // Drawn at 심의진행; the bulk station save (or the desk, or another tab) then
  // decided the last station and moved the album to RESULT_READY. A memo save
  // posted the old 심의진행 and wrote IN_PROGRESS back without a word, and the
  // 7-day customer-file deletion never started.
  const api = await fixture({ status: "RESULT_READY", result_status: "APPROVED" });
  const saved = await save(api, { operationalStage: "REVIEW_IN_PROGRESS", renderedOperationalStage: "REVIEW_IN_PROGRESS", adminMemo: "결과 확인" });
  assert.equal(saved.get("saved"), "status", saved.get("savedError") ?? "");
  assert.equal(api.state.submission.status, "RESULT_READY");
  assert.equal(api.state.memo, "결과 확인");
  assert.equal(named(api, "write").length, 0);
  // A title fix from that page keeps the status too.
  await save(api, { operationalStage: "REVIEW_IN_PROGRESS", renderedOperationalStage: "REVIEW_IN_PROGRESS", title: "Fixed title" });
  assert.deepEqual([api.state.submission.status, api.state.submission.title], ["RESULT_READY", "Fixed title"]);
});

test("a stage the administrator picks is still saved", async () => {
  // Entering 결과 준비 voids an earlier notice (07378b68), and going back to
  // 심의진행 stays the administrator's choice.
  const api = await fixture({ status: "IN_PROGRESS", result_notified_at: "2026-11-20T00:00:00Z" });
  let saved = await save(api, { operationalStage: "RESULT_NOTIFIED", renderedOperationalStage: "REVIEW_IN_PROGRESS" });
  assert.equal(saved.get("saved"), "status", saved.get("savedError") ?? "");
  assert.deepEqual([api.state.submission.status, api.state.submission.result_notified_at], ["RESULT_READY", null]);
  saved = await save(api, { operationalStage: "REVIEW_IN_PROGRESS", renderedOperationalStage: "RESULT_NOTIFIED" });
  assert.equal(saved.get("saved"), "status", saved.get("savedError") ?? "");
  assert.equal(api.state.submission.status, "IN_PROGRESS");
});

test("the stage select is redrawn on the stored stage and the form posts the stage it showed", () => {
  // router.refresh() after a bulk station or refund save keeps an uncontrolled
  // select on its old option; keyed on the stage, it is redrawn on the new one.
  const page = readFileSync("src/app/admin/submissions/detail/page.tsx", "utf8");
  assert.match(page, /<select\s+key=\{currentOperationalStage\}\s+name="operationalStage"\s+defaultValue=\{currentOperationalStage\}/);
  assert.match(page, /<input type="hidden" name="renderedOperationalStage" value=\{currentOperationalStage\} \/>/);
  // A refunded application shows 환불 instead of stages it can no longer take.
  assert.match(page, /isRefunded \? "환불" : "결과 준비"/);
  const actions = readFileSync("src/features/admin/actions.ts", "utf8");
  assert.match(actions, /formData\.get\("renderedOperationalStage"\)/);
});
