import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

type Fixture = {
  SubscriptionPage: () => Promise<ReactNode>;
  state: { email?: string; subscription: { status: string; amount_krw: number } | null };
  calls: { method: string; input?: Record<string, unknown> }[];
};

async function fixture(): Promise<Fixture> {
  const result = await build({
    stdin: { contents: `export {default as SubscriptionPage} from './src/app/subscription/page'; export {state,calls} from 'subscription-fixture';`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, platform: "node", format: "cjs", jsx: "automatic", packages: "external", write: false,
    plugins: [{ name: "subscription-contact-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(subscription-fixture|next\/(navigation|link)|@\/lib\/supabase\/server|@\/lib\/inicis\/(stdpay|config)|@\/lib\/url|@\/lib\/subscriptions\/service|@\/features\/subscriptions\/subscription-pay)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "jsx", resolveDir: process.cwd(), contents: {
        "subscription-fixture": `export const state={email:undefined,subscription:null};export const calls=[];`,
        "next/navigation": `export const redirect=()=>{throw Error('Unexpected redirect')};`,
        "next/link": `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
        "@/lib/supabase/server": `import {state} from 'subscription-fixture';export async function createServerSupabase(){return {auth:{getUser:async()=>({data:{user:{id:'verified-member',email:state.email}},error:null})}};}`,
        "@/lib/inicis/stdpay": `import {calls} from 'subscription-fixture';export const resolveSubscriptionPrice=()=>1000;export const buildStdPayRequest=input=>{calls.push({method:'pc-request',input});return input};export const buildMobileBillingRequest=input=>{calls.push({method:'mobile-request',input});return input};`,
        "@/lib/inicis/config": `export const getStdPayConfig=()=>({mid:'fixture-mid',stdJsUrl:'https://example.invalid/sdk'});export const getBillingConfig=()=>({mid:'fixture-mid'});`,
        "@/lib/url": `export const getBaseUrl=()=> 'https://onside.example';export const buildUrl=(path,base)=>new URL(path,base).toString();`,
        "@/lib/subscriptions/service": `import {state,calls} from 'subscription-fixture';export const getActiveSubscription=async()=>({subscription:state.subscription});export const createHistoryAttempt=async input=>{calls.push({method:'create-order',input});return {orderId:'order-1',callbackState:'fixture-state'}};`,
        "@/features/subscriptions/subscription-pay": `export const SubscriptionPayButtons=()=>null;`,
      }[path]! }));
    } }],
  });
  const bundled = { exports: {} as Fixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  return bundled.exports;
}

test("a member without an email sees recovery guidance before any subscription order or gateway request", async () => {
  const f = await fixture();
  for (const email of [undefined, "", "   "]) {
    f.state.email = email;
    const html = renderToStaticMarkup(await f.SubscriptionPage());
    assert.match(html, /정기결제 안내를 받을 이메일이 필요합니다/);
    assert.match(html, /href="\/support"/);
    assert.match(html, /href="\/login\?next=%2Fsubscription"/);
  }
  assert.deepEqual(f.calls, []);
});

test("an email member creates the same owned order and passes a nonempty Auth address to both gateways", async () => {
  const f = await fixture();
  f.state.email = " member@example.com ";
  await f.SubscriptionPage();
  assert.deepEqual(f.calls.map(call => call.method), ["create-order", "pc-request", "mobile-request"]);
  assert.equal(f.calls[0]?.input?.userId, "verified-member");
  for (const call of f.calls.slice(1)) assert.equal(call.input?.buyerEmail, "member@example.com");
});

test("an active subscription remains viewable without creating another order when email is absent", async () => {
  const f = await fixture();
  f.state.subscription = { status: "ACTIVE", amount_krw: 1000 };
  const html = renderToStaticMarkup(await f.SubscriptionPage());
  assert.match(html, /활성화된 구독이 있습니다/);
  assert.doesNotMatch(html, /정기결제 안내를 받을 이메일이 필요합니다/);
  assert.deepEqual(f.calls, []);
});
