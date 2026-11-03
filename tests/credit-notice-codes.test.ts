import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

import { creditNoticeErrorMessage, studioRewardErrorCode } from "../src/features/credits/credit-notice-codes";

test("only known codes become a notice; crafted text is ignored", () => {
  assert.equal(creditNoticeErrorMessage("insufficient_credits"), "보유 크레딧이 부족합니다.");
  assert.equal(creditNoticeErrorMessage(["invalid_reservation", "x"]), "이용 희망일, 시간, 신청자명, 연락처를 확인해주세요.");
  assert.equal(creditNoticeErrorMessage("insufficient_credits", "/en"), "You do not have enough credits.");
  for (const value of [
    undefined, "", "입금 계좌가 변경되었습니다. 국민은행 000-000 으로 송금해주세요.",
    encodeURIComponent("공식 안내: 새 계좌로 입금"), "__proto__", "toString", "constructor", "INSUFFICIENT_CREDITS",
  ]) assert.equal(creditNoticeErrorMessage(value), null, String(value));
  assert.equal(studioRewardErrorCode("ERROR: INSUFFICIENT_CREDITS"), "insufficient_credits");
  assert.equal(studioRewardErrorCode("private database detail"), "reservation_failed");
});

test("both credit pages render the code map instead of decoding the query text", () => {
  for (const file of ["src/features/magazine/magazine-page-view.tsx", "src/features/credits/credits-page-view.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /decodeURIComponent\(rawError\)|text: rawError/, file);
    assert.match(source, /creditNoticeErrorMessage\(error, localePrefix\)/, file);
  }
  const actions = readFileSync("src/features/credits/actions.ts", "utf8");
  for (const match of actions.matchAll(/error: ([^,\n]+)/g)) {
    assert.doesNotMatch(match[1], /[가-힣]/, `redirect errors must be codes: ${match[1]}`);
  }
});

test("studio reservation redirects carry codes", async () => {
  const result = await build({
    stdin: { contents: "export {createStudioReservationFormAction,redeemCreditRewardFormAction} from './src/features/credits/actions'; export {state} from 'credits-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "credits-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(credits-fixture|@\/lib\/supabase\/(?:server|admin)|next\/(?:cache|navigation))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: ({
        "credits-fixture": "export const state={rpcError:{message:'INSUFFICIENT_CREDITS'}};",
        "@/lib/supabase/server": "import {state} from 'credits-fixture'; export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:{id:'member'}}})},from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'reward',title:'스튜디오',is_active:true},error:null})};return q;},rpc:async()=>({error:state.rpcError})});",
        "@/lib/supabase/admin": "export const createAdminClient=()=>{throw Error('unexpected admin client')};",
        "next/cache": "export const revalidatePath=()=>{};",
        "next/navigation": "export const redirect=url=>{throw Object.assign(Error('redirect'),{url});};",
      } as Record<string, string>)[path] }));
    } }],
  });
  const bundled = { exports: {} as { createStudioReservationFormAction: (form: FormData) => Promise<void>; redeemCreditRewardFormAction: (form: FormData) => Promise<void>; state: { rpcError: unknown } } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  const location = async (run: Promise<void>) => {
    try { await run; } catch (error) { return new URL((error as { url: string }).url, "https://onside.local"); }
    throw Error("expected a redirect");
  };
  const form = new FormData();
  for (const [key, value] of Object.entries({ rewardId: "11111111-1111-4111-8111-111111111111", preferredDate: "2099-01-01", preferredTime: "10:00", contactName: "회원", contactPhone: "010-0000-0000", redirectTo: "/magazine?tab=services" })) form.set(key, value);
  let url = await location(bundled.exports.createStudioReservationFormAction(form));
  assert.equal(url.pathname, "/magazine");
  assert.equal(url.searchParams.get("error"), "insufficient_credits");
  form.delete("contactName");
  url = await location(bundled.exports.createStudioReservationFormAction(form));
  assert.equal(url.searchParams.get("error"), "invalid_reservation");
  url = await location(bundled.exports.redeemCreditRewardFormAction(form));
  assert.equal(url.searchParams.get("error"), "reservation_required");
  for (const value of [...url.searchParams.values()]) assert.doesNotMatch(value, /[가-힣]/);
});
