import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { isSocialAuthorizeUrl, isSocialLinkAuthorizeUrl } from "../src/features/auth/social-contract";
import { getAuthReturnPath } from "../src/features/auth/navigation";

const appOrigin = "https://onside.example";
const authOrigin = "https://auth.example";
const providerUrl = (provider: string) => `${authOrigin}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&code_challenge_method=s256&code_challenge=${"a".repeat(43)}`;
const linkUrl = (provider = "naver") => `${provider === "naver" ? "https://nid.naver.com/oauth2/authorize" : "https://accounts.google.com/o/oauth2/v2/auth"}?state=fixture&redirect_uri=${encodeURIComponent(`${authOrigin}/auth/v1/callback`)}`;

type FixtureUser = { id: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown>; identities: {provider:string}[]; email?: string };
const user = (provider = "custom:naver", consent = false): FixtureUser => ({ id: "member-1", app_metadata: { provider, providers: [provider], ...(consent ? { signupConsent: { acceptedAt: "2026-10-29T00:00:00Z", age14OrOlder: true, terms: true, privacy: true, refund: true } } : {}) }, user_metadata: { name: "네이버 회원", role: "admin" }, identities: [{ provider }] });

type Fixture = {
  state: { availability: Record<string, boolean>; user: FixtureUser | null; refreshedSession?: string; exchangeUser: FixtureUser | null; exchangeError: unknown; profile: boolean; profileError: unknown; insertError: unknown; oauthUrl: string; linkUrl: string; linkError: unknown; limited: boolean };
  calls: { method: string; input?: unknown }[];
  jar: Map<string, {name:string;value:string}>;
  writes: {name:string;value:string;options?:unknown}[];
  start: (request: Request, context: {params:Promise<{provider:string}>}) => Promise<Response>;
  callback: (request: Request) => Promise<Response>;
  link: (request: Request, context: {params:Promise<{provider:string}>}) => Promise<Response>;
  head: () => Response;
};
async function fixture(): Promise<Fixture> {
  const result = await build({ stdin: { contents: `export {GET as start,HEAD as head} from './src/app/auth/social/[provider]/route'; export {GET as callback} from './src/app/auth/callback/route'; export {POST as link} from './src/app/auth/link/[provider]/route'; export {state,calls,jar,writes} from 'social-fixture';`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "social-test", setup(plugin) {
      plugin.onResolve({ filter: /^(server-only|social-fixture|@supabase\/ssr|@\/lib\/supabase\/(server|env)|@\/lib\/url|@\/lib\/request-rate-limit|@\/features\/auth\/social|next\/headers)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const files: Record<string, string> = {
          "server-only": "export {};",
          "social-fixture": `
            export const state={availability:{google:true,naver:true,kakao:true},user:null,exchangeUser:null,exchangeError:null,profile:true,profileError:null,insertError:null,oauthUrl:'',linkUrl:'',linkError:null,limited:false};
            export const calls=[], writes=[], jar=new Map();
            export function client(adapter){return {auth:{
              getUser:async()=>{calls.push({method:'getUser'});if(state.refreshedSession)adapter?.setAll([{name:'session',value:state.refreshedSession,options:{path:'/'}}]);return {data:{user:state.user},error:null};},
              signInWithOAuth:async input=>{calls.push({method:'oauth',input});return {data:{url:state.oauthUrl,flowId:'fixture-flow'},error:null};},
              linkIdentity:async input=>{calls.push({method:'link',input});return {data:{url:state.linkUrl,flowId:'fixture-flow'},error:state.linkError};},
              exchangeCodeForSession:async(code,options)=>{calls.push({method:'exchange',input:{code,options}});adapter?.setAll([{name:'session',value:'new-session',options:{path:'/'}}]);return {data:{user:state.exchangeUser,session:state.exchangeUser?{access_token:'fixture'}:null},error:state.exchangeError};},
              signOut:async input=>{calls.push({method:'signOut',input});adapter?.setAll([{name:'session',value:'',options:{path:'/'}}]);return {error:null};}
            },from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>{calls.push({method:'profile-read',input:table});return {data:state.profile?{user_id:'member-1'}:null,error:state.profileError};}})}),insert:async input=>{calls.push({method:'profile-insert',input});return {error:state.insertError};}})}}
          `,
          "@supabase/ssr": `import {client,calls} from 'social-fixture'; export function createServerClient(url,key,options){calls.push({method:'callback-client'});return client(options.cookies);}`,
          "@/lib/supabase/server": `import {client,calls} from 'social-fixture'; export async function createServerSupabase(input){calls.push({method:'server-client',input});return client();}`,
          "@/lib/supabase/env": `export const getSupabaseEnv=()=>({url:'${authOrigin}',anonKey:'fixture-public-key'}); export const getServiceRoleKey=()=> 'fixture-signing-key';`,
          "@/lib/url": `export const getBaseUrl=()=> '${appOrigin}';`,
          "@/lib/request-rate-limit": `import {state} from 'social-fixture'; export const consumeRateLimit=()=>({allowed:!state.limited});`,
          "@/features/auth/social": `import {state,calls} from 'social-fixture';export async function getSocialAvailability(){calls.push({method:'availability'});return state.availability;}`,
          "next/headers": `import {jar,writes} from 'social-fixture';export async function cookies(){return {get:name=>jar.get(name),getAll:()=>[...jar.values()],set:(name,value,options)=>{const entry=typeof name==='object'?name:{name,value,options};writes.push(entry);if(!entry.value)jar.delete(entry.name);else jar.set(entry.name,entry);}};}`,
        };
        return { loader: "js", contents: files[path] };
      });
    } }],
  });
  const bundled = { exports: {} as Fixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  return bundled.exports;
}
const context = (provider = "naver") => ({params:Promise.resolve({provider})});
const location = (response: Response) => new URL(response.headers.get("location")!);
const callbackRequest = (query = "flow=social&code=fixture-code&sb_flow_id=fixture-flow") => new Request(`${appOrigin}/auth/callback?${query}`);
const post = (origin = appOrigin, values = "locale=en&next=%2Fen%2Fmypage%2Fprofile") => new Request(`${appOrigin}/auth/link/naver`, {method:"POST",headers:{origin,"content-type":"application/x-www-form-urlencoded"},body:values});

test("OAuth redirects reject untrusted hosts, weak PKCE, wrong providers, and auth return loops", () => {
  assert.equal(isSocialAuthorizeUrl(providerUrl("custom:naver"), authOrigin, "custom:naver"), true);
  for (const value of [providerUrl("google"), providerUrl("custom:naver").replace("auth.example", "auth.example.evil"), providerUrl("custom:naver").replace("s256", "plain"), providerUrl("custom:naver").replace("a".repeat(43), "short")]) assert.equal(isSocialAuthorizeUrl(value, authOrigin, "custom:naver"), false);
  assert.equal(isSocialLinkAuthorizeUrl(linkUrl(), authOrigin, "naver"), true);
  assert.equal(isSocialLinkAuthorizeUrl(linkUrl("google").replace("/v2/auth", "/auth"), authOrigin, "google"), true);
  for (const value of [linkUrl().replace("nid.naver.com", "nid.naver.com.evil"), linkUrl().replace("https://nid", "http://nid"), linkUrl().replace("state=fixture", "other=fixture"), linkUrl().replace(encodeURIComponent(authOrigin), encodeURIComponent("https://evil.example"))]) assert.equal(isSocialLinkAuthorizeUrl(value, authOrigin, "naver"), false);
  for (const path of ["/auth/callback?code=secret", "/en/auth/social/naver", "/complete-signup", "/en/complete-signup?next=/mypage", "/%61uth/callback", "/en/%63omplete-signup", "/%2f%2fevil.example", "/%5cevil.example", "/%00mypage"]) assert.equal(getAuthReturnPath(path), null);
});

test("HEAD, prefetch, unavailable, and noncanonical launches never create PKCE cookies", async () => {
  const f = await fixture();
  assert.equal(f.head().status, 204);
  assert.equal((await f.start(new Request(`${appOrigin}/auth/social/naver`, {headers:{"sec-purpose":"prefetch"}}), context())).status, 204);
  assert.equal(f.calls.length, 0);
  const canonical = await f.start(new Request("https://alias.example/auth/social/naver?next=%2Fdashboard%2Fnew%3Fdraft%3D1&locale=en"), context());
  assert.equal(location(canonical).origin, appOrigin);
  assert.equal(location(canonical).searchParams.get("next"), "/en/dashboard/new?draft=1");
  assert.equal(f.calls.length, 0);
  f.state.availability.naver = false;
  const disabled = await f.start(new Request(`${appOrigin}/auth/social/naver`), context());
  assert.equal(location(disabled).searchParams.get("social_error"), "unavailable");
  assert.deepEqual(f.calls.map(call=>call.method), ["availability"]);
});

test("native social launch uses per-flow PKCE and minimal Kakao nickname consent", async () => {
  const f = await fixture(); f.state.oauthUrl = providerUrl("kakao");
  const response = await f.start(new Request(`${appOrigin}/auth/social/kakao?locale=en&next=%2Fdashboard%2Fnew%3Fdraft%3D1`), context("kakao"));
  assert.equal(location(response).origin, authOrigin);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(f.calls.find(c=>c.method==="server-client")?.input, {appendPkceFlowIdToRedirects:true,allowIncompleteSocialSignup:true});
  const input = f.calls.find(c=>c.method==="oauth")?.input as {provider:string;options:{redirectTo:string;queryParams:unknown;skipBrowserRedirect:boolean}};
  assert.equal(input.provider, "kakao"); assert.deepEqual(input.options.queryParams, {scope:"profile_nickname"});
  const callback = new URL(input.options.redirectTo);
  assert.equal(callback.origin, appOrigin); assert.equal(callback.searchParams.get("next"), "/en/dashboard/new?draft=1"); assert.equal(callback.searchParams.get("flow"), "social");
});

test("Render's internal HTTP origin starts OAuth once on the configured HTTPS host", async () => {
  for (const internalOrigin of ["http://onside.example", "http://localhost:10000", "http://10.0.0.9:10000"]) {
    const f = await fixture(); f.state.oauthUrl = providerUrl("google");
    const request = new Request(`${internalOrigin}/auth/social/google?next=%2Fen%2Fmypage&locale=en`, {
      headers: { host: "onside.example", "x-forwarded-proto": "https", "x-forwarded-host": "onside.example" },
    });
    const response = await f.start(request, context("google"));
    assert.equal(location(response).origin, authOrigin, "must leave the app instead of redirecting to its own launch URL");
    assert.equal(f.calls.filter(call => call.method === "oauth").length, 1);
    const input = f.calls.find(call => call.method === "oauth")?.input as { options: { redirectTo: string } };
    const callback = new URL(input.options.redirectTo);
    assert.equal(callback.origin, appOrigin);
    assert.equal(callback.searchParams.get("next"), "/en/mypage");
    assert.equal(callback.searchParams.get("locale"), "en");
  }
});

test("Host and forwarded-header injection cannot change OAuth origins or bypass canonical aliases", async () => {
  const rejectedHeaders: Record<string, string>[] = [
    { host: "alias.example", "x-forwarded-host": "onside.example", "x-forwarded-proto": "https" },
    { host: "onside.example.evil", "x-forwarded-host": "onside.example", "x-forwarded-proto": "https" },
    { host: "onside.example@evil.example", "x-forwarded-proto": "https" },
    { host: "onside.example,evil.example", "x-forwarded-proto": "https" },
    { host: "onside.example", "x-forwarded-proto": "https,http" },
    { host: "onside.example", "x-forwarded-proto": "http" },
    { "x-forwarded-host": "onside.example", "x-forwarded-proto": "https" },
  ];
  for (const headers of rejectedHeaders) {
    const f = await fixture(); f.state.oauthUrl = providerUrl("google");
    const response = await f.start(new Request("http://internal:10000/auth/social/google?next=https%3A%2F%2Fevil.example", { headers }), context("google"));
    assert.equal(location(response).origin, appOrigin);
    assert.equal(location(response).pathname, "/auth/social/google");
    assert.equal(location(response).searchParams.get("next"), "/mypage");
    assert.deepEqual(f.calls, [], "canonical redirect must happen before provider lookup or PKCE mutation");
  }
  const f = await fixture(); f.state.oauthUrl = providerUrl("google");
  const response = await f.start(new Request("http://internal:10000/auth/social/google", {
    headers: { host: "onside.example", "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" },
  }), context("google"));
  assert.equal(location(response).origin, authOrigin);
  const input = f.calls.find(call => call.method === "oauth")?.input as { options: { redirectTo: string } };
  assert.equal(new URL(input.options.redirectTo).origin, appOrigin, "untrusted forwarded host is ignored");
});

test("proxied identity linking still checks browser Origin independently of the internal request URL", async () => {
  const f = await fixture(); f.state.user = user("email"); f.state.linkUrl = linkUrl();
  const request = (origin: string) => new Request("http://localhost:10000/auth/link/naver", {
    method: "POST", headers: { origin, host: "onside.example", "x-forwarded-host": "onside.example", "x-forwarded-proto": "https", "content-type": "application/x-www-form-urlencoded" }, body: "locale=en",
  });
  assert.equal((await f.link(request("https://evil.example"), context())).status, 403);
  assert.equal(f.calls.length, 0);
  const response = await f.link(request(appOrigin), context());
  assert.equal(location(response).origin, "https://nid.naver.com");
  const input = f.calls.find(call => call.method === "link")?.input as { options: { redirectTo: string } };
  assert.equal(new URL(input.options.redirectTo).origin, appOrigin);
});

test("cancelled, absent, malformed and unknown callback flows preserve existing sessions", async () => {
  const f = await fixture(); f.jar.set("session", {name:"session",value:"existing-session"});
  for (const query of ["flow=social&error=access_denied&error_description=secret", "flow=social", "flow=social&code=bad%20code&sb_flow_id=good", "flow=social&code=good&sb_flow_id=bad%20id", "code=good&sb_flow_id=fixture-flow", "flow=social&code=good"]) {
    const response = await f.callback(callbackRequest(query));
    assert.equal(location(response).pathname, "/login");
    assert.doesNotMatch(response.headers.get("location")!, /secret|bad%20/);
  }
  assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []); assert.equal(f.jar.get("session")?.value, "existing-session");
});

test("a no-email identity gets a real session and consent gate without synthetic email or role writes", async () => {
  const f = await fixture(); f.state.exchangeUser = user(); f.state.profile = false;
  const response = await f.callback(callbackRequest("flow=social&code=fixture-code&sb_flow_id=fixture-flow&locale=en&next=%2Fdashboard%2Fnew%3Fdraft%3D1"));
  assert.equal(location(response).pathname, "/en/complete-signup"); assert.equal(location(response).searchParams.get("next"), "/en/dashboard/new?draft=1");
  assert.deepEqual(f.calls.find(c=>c.method==="exchange")?.input, {code:"fixture-code",options:{flowId:"fixture-flow"}});
  assert.deepEqual(f.calls.find(c=>c.method==="profile-insert")?.input, {user_id:"member-1",name:"네이버 회원"});
  assert.equal(f.jar.get("session")?.value, "new-session");
});

test("existing profiles remain untouched and legacy email users keep their destination", async () => {
  const f = await fixture(); f.state.exchangeUser = user("email");
  const response = await f.callback(callbackRequest("flow=social&code=fixture-code&sb_flow_id=fixture-flow&next=%2Fadmin"));
  assert.equal(location(response).pathname, "/admin"); assert.equal(f.calls.some(c=>c.method==="profile-insert"), false);
});

test("failed exchange or profile creation discards pending cookie writes and keeps old session", async () => {
  for (const failure of ["exchange", "profile"]) {
    const f = await fixture(); f.jar.set("session",{name:"session",value:"old-session"}); f.state.exchangeUser=user();
    if (failure === "exchange") f.state.exchangeError={code:"invalid_grant"};
    else {f.state.profile=false;f.state.insertError={code:"42501"};}
    const response = await f.callback(callbackRequest());
    assert.equal(location(response).pathname,"/login"); assert.equal(f.jar.get("session")?.value,"old-session"); assert.equal(f.writes.length,0);
    assert.equal(f.calls.some(c=>c.method==="signOut"),failure==="profile");
  }
});

test("manual linking requires same-origin POST, verified existing user, available provider, and allowed authorize URL", async () => {
  const f=await fixture(); f.state.user=user("email"); f.state.linkUrl=linkUrl();
  assert.equal((await f.link(post("https://evil.example"),context())).status,403); assert.equal(f.calls.length,0);
  f.state.user=null;
  assert.equal(location(await f.link(post(),context())).pathname,"/en/login"); assert.equal(f.calls.some(c=>c.method==="link"),false);
  f.state.user=user("email");f.state.linkUrl="https://evil.example/authorize";
  assert.equal(location(await f.link(post(),context())).searchParams.get("social_error"),"link-failed"); assert.equal(f.jar.has("onside_social_link"),false);
  f.state.linkUrl=linkUrl();f.state.linkError={code:"manual_linking_disabled"};
  assert.equal(location(await f.link(post(),context())).searchParams.get("social_error"),"link-unavailable");
});

test("signed linking intent and matching current user complete without changing the account", async () => {
  const f=await fixture();f.state.user=user("email");f.state.exchangeUser=user("email");f.state.linkUrl=linkUrl();
  const launch=await f.link(post(),context());assert.equal(location(launch).origin,"https://nid.naver.com");
  const input=f.calls.find(c=>c.method==="link")?.input as {options:{redirectTo:string}};
  const callback=new URL(input.options.redirectTo);callback.searchParams.set("code","fixture-code");callback.searchParams.set("sb_flow_id","fixture-flow");
  const response=await f.callback(new Request(callback));
  assert.equal(location(response).pathname,"/en/mypage/profile");assert.equal(location(response).searchParams.get("social_link"),"success");assert.equal(f.jar.has("onside_social_link"),false);
  const exchanges=f.calls.filter(c=>c.method==="exchange").length;
  assert.equal(location(await f.callback(new Request(callback))).searchParams.get("social_error"),"link-expired");
  assert.equal(f.calls.filter(c=>c.method==="exchange").length,exchanges,"intent is one-use");
});

test("tampered intent, account switch, and exchange mismatch cannot overwrite the existing session", async () => {
  for(const failure of ["tampered","switched","exchange-mismatch"]){
    const f=await fixture();f.state.user=user("email");f.state.exchangeUser=user("email");f.state.linkUrl=linkUrl();f.jar.set("session",{name:"session",value:"old-session"});
    await f.link(post(),context());
    const input=f.calls.find(c=>c.method==="link")?.input as {options:{redirectTo:string}};
    const callback=new URL(input.options.redirectTo);callback.searchParams.set("code","fixture-code");callback.searchParams.set("sb_flow_id","fixture-flow");
    if(failure==="tampered"){const cookie=f.jar.get("onside_social_link")!;cookie.value=cookie.value.slice(0,-1)+"!";}
    if(failure==="switched")f.state.user={...user("email"),id:"other-member"};
    if(failure==="exchange-mismatch")f.state.exchangeUser={...user("email"),id:"other-member"};
    f.writes.length=0;
    const response=await f.callback(new Request(callback));assert.match(location(response).searchParams.get("social_error")!,/^link-(expired|conflict)$/);
    assert.equal(f.jar.get("session")?.value,"old-session");assert.equal(f.writes.some(write=>write.name==="session"),false);
    assert.equal(f.calls.some(c=>c.method==="exchange"),failure==="exchange-mismatch");
  }
});

test("a legitimate old-session refresh survives a subsequent linking exchange mismatch", async () => {
  const f=await fixture();f.state.user=user("email");f.state.exchangeUser={...user("email"),id:"other-member"};f.state.linkUrl=linkUrl();
  f.jar.set("session",{name:"session",value:"old-session"});
  await f.link(post(),context());
  f.state.refreshedSession="refreshed-original-session";
  const input=f.calls.find(c=>c.method==="link")?.input as {options:{redirectTo:string}};
  const callback=new URL(input.options.redirectTo);callback.searchParams.set("code","fixture-code");callback.searchParams.set("sb_flow_id","fixture-flow");
  f.writes.length=0;
  assert.equal(location(await f.callback(new Request(callback))).searchParams.get("social_error"),"link-conflict");
  assert.equal(f.jar.get("session")?.value,"refreshed-original-session");
  assert.deepEqual(f.writes.filter(write=>write.name==="session").map(write=>write.value),["refreshed-original-session"]);
});

test("availability shares only boolean public settings for 60 seconds and never reads admin endpoints", async () => {
  const bundle=await build({stdin:{contents:`export * from './src/features/auth/social';`,resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"node",format:"cjs",packages:"external",write:false,plugins:[{name:"public-settings-only",setup(plugin){
    plugin.onResolve({filter:/^(server-only|@\/lib\/supabase\/env)$/},args=>({path:args.path,namespace:"fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fixture"},({path})=>({loader:"js",contents:path==="server-only"?"export {};":`export const getSupabaseEnv=()=>({url:'${authOrigin}',anonKey:'fixture-public'});`}));
  }}]});
  const availabilityBundle={exports:{} as {getSocialAvailability:()=>Promise<Record<string,boolean>>;parseSocialAvailability:(settings:unknown,naver:boolean)=>Record<string,boolean>;isNaverReviewPending:()=>boolean}};
  new Function("require","module","exports",bundle.outputFiles[0].text)(createRequire(import.meta.url),availabilityBundle,availabilityBundle.exports);
  const originalFetch=globalThis.fetch, originalNow=Date.now, previousFlag=process.env.ONSIDE_NAVER_LOGIN_ENABLED, previousReviewFlag=process.env.ONSIDE_NAVER_REVIEW_PENDING;
  let time=100_000; const requests:{url:string;init?:RequestInit}[]=[];
  let settings:unknown={external:{google:true,kakao:"true"},secrets:{client_secret:"must-not-return"}};
  try{
    Date.now=()=>time;delete process.env.ONSIDE_NAVER_LOGIN_ENABLED;delete process.env.ONSIDE_NAVER_REVIEW_PENDING;
    assert.equal(availabilityBundle.exports.isNaverReviewPending(),false);
    process.env.ONSIDE_NAVER_REVIEW_PENDING="true";
    assert.equal(availabilityBundle.exports.isNaverReviewPending(),false,"review notice cannot enable Naver");
    globalThis.fetch=async(input,init)=>{requests.push({url:String(input),init});return Response.json(settings);};
    const values=await Promise.all([availabilityBundle.exports.getSocialAvailability(),availabilityBundle.exports.getSocialAvailability(),availabilityBundle.exports.getSocialAvailability()]);
    assert.equal(requests.length,1);assert.deepEqual(values[0],{google:true,kakao:false,naver:false});
    values[0].google=false;
    assert.equal((await availabilityBundle.exports.getSocialAvailability()).google,true,"callers cannot mutate shared cache");
    time+=59_999;await availabilityBundle.exports.getSocialAvailability();assert.equal(requests.length,1);
    time+=2;settings={external:{google:false,kakao:true}};assert.equal((await availabilityBundle.exports.getSocialAvailability()).kakao,true);assert.equal(requests.length,2);
    process.env.ONSIDE_NAVER_LOGIN_ENABLED="true";assert.equal((await availabilityBundle.exports.getSocialAvailability()).naver,true);
    assert.equal(availabilityBundle.exports.isNaverReviewPending(),true);
    process.env.ONSIDE_NAVER_REVIEW_PENDING="false";
    assert.equal(availabilityBundle.exports.isNaverReviewPending(),false,"approval can remove only the review notice without disabling Naver");
    assert.ok(requests.every(request=>request.url===`${authOrigin}/auth/v1/settings`));
    assert.ok(requests.every(request=>!new Headers(request.init?.headers).has("authorization")));
    assert.ok(requests.every(request=>request.init?.cache==="no-store"));
    assert.deepEqual(availabilityBundle.exports.parseSocialAvailability(null,false),{google:false,kakao:false,naver:false});
  }finally{
    globalThis.fetch=originalFetch;Date.now=originalNow;
    if(previousFlag===undefined)delete process.env.ONSIDE_NAVER_LOGIN_ENABLED;else process.env.ONSIDE_NAVER_LOGIN_ENABLED=previousFlag;
    if(previousReviewFlag===undefined)delete process.env.ONSIDE_NAVER_REVIEW_PENDING;else process.env.ONSIDE_NAVER_REVIEW_PENDING=previousReviewFlag;
  }
});
