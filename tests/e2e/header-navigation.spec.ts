import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

let html: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {SiteHeader} from './src/components/site/header';
      import {AccountPageLoading} from './src/components/dashboard/account-page-loading';
      import {changePath,usePathname} from 'next/navigation';
      window.__headerMetrics={sessions:0,subscriptions:0,unsubscribes:0};
      window.__changePath=changePath;
      const loading=location.search.includes('loading');
      const information=new Promise(resolve=>{window.__resolveInformation=()=>resolve('Information ready')});
      function Information(){return <p>{React.use(information)}</p>}
      function Fixture(){const path=usePathname();return <><SiteHeader/>{loading?<React.Suspense fallback={<AccountPageLoading english={path.startsWith('/en/')}/>}><Information/></React.Suspense>:null}</>}
      createRoot(document.getElementById('root')).render(<Fixture/>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": '{"NODE_ENV":"production"}' },
    plugins: [{ name: "header-fixture", setup(builder) {
      builder.onResolve({filter:/^(next\/(?:navigation|link)|@\/lib\/supabase\/client)$/}, args=>({path:args.path,namespace:"fixture"}));
      builder.onLoad({filter:/.*/,namespace:"fixture"},({path})=>({loader:"tsx",resolveDir:process.cwd(),contents:
        path==='next/navigation'?`import {useSyncExternalStore} from 'react';let path=location.pathname;const listeners=new Set();export function changePath(next){history.pushState(null,'',next);path=location.pathname;listeners.forEach(fn=>fn())}export const usePathname=()=>useSyncExternalStore(fn=>{listeners.add(fn);return ()=>listeners.delete(fn)},()=>path);`:
        path==='next/link'?`import {changePath} from 'next/navigation';export default function Link({prefetch,replace,scroll,onClick,children,...props}){return <a {...props} onClick={event=>{onClick?.(event);if(!event.defaultPrevented&&!event.metaKey&&!event.ctrlKey&&props.target!=='_blank'){event.preventDefault();changePath(props.href)}}}>{children}</a>}`:
        `let session=location.pathname.endsWith('/login')?null:{user:{id:'fixture-user-one'}};const listeners=new Set();window.__setCookieSession=id=>{session=id?{user:{id}}:null};window.__changeAuth=id=>{window.__setCookieSession(id);listeners.forEach(fn=>fn(id?'SIGNED_IN':'SIGNED_OUT',session))};const client={auth:{getSession:async()=>{window.__headerMetrics.sessions++;if(window.__headerFailSession)throw new Error('Fixture unavailable');return {data:{session},error:null}},onAuthStateChange(fn){window.__headerMetrics.subscriptions++;listeners.add(fn);return {data:{subscription:{unsubscribe(){window.__headerMetrics.unsubscribes++;listeners.delete(fn)}}}}}}};export const createClient=()=>client;`
      }));
    }}],
  });
  html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>${result.outputFiles[0].text.replace(/<\/script/gi,"<\\/script")}</script></body></html>`;
});

async function mount(page: Page, options: {holdRequest?: number;path?:string;guest?:boolean} = {}) {
  const requests: string[]=[];
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/*',async route=>{
    if(route.request().resourceType()==='document'){await route.fulfill({contentType:'text/html',body:html});return;}
    if(new URL(route.request().url()).pathname==='/api/cart/count'){
      requests.push(route.request().url());
      const count=requests.length+2;
      if(requests.length===options.holdRequest)await gate;
      // An account change intentionally aborts its previous badge request.
      await route.fulfill({json:{count}}).catch(()=>undefined);return;
    }
    await route.abort();
  });
  await page.goto(`http://header.fixture.invalid${options.path??'/dashboard'}`);
  if(options.guest){await expect(page.getByRole('link',{name:/^(로그인|Login)$/})).toBeVisible();return {requests,release};}
  const english=options.path?.startsWith('/en/');
  await expect(page.getByRole('link',{name:'로그아웃'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:english?'Logout':'로그아웃'})).toBeVisible();
  await expect(page.getByRole('link',{name:english?'Cart':'장바구니',exact:true})).toHaveText('3');
  return {requests,release};
}
const metrics=(page:Page)=>page.evaluate(()=>(window as unknown as {__headerMetrics:Record<string,number>}).__headerMetrics);
const changePath=(page:Page,path:string)=>page.evaluate(next=>(window as unknown as {__changePath:(path:string)=>void}).__changePath(next),path);

test('normal client navigation keeps one auth subscription and avoids repeated cart/auth requests',async({page},testInfo)=>{
  const {requests}=await mount(page);
  for(const path of ['/track','/dashboard/new','/mypage/music']){
    await changePath(page,path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    // Let effects and the mocked local responses finish before measuring.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  const observed={...await metrics(page),cartRequests:requests.length};
  await testInfo.attach('header-request-counts',{body:JSON.stringify(observed),contentType:'application/json'});
  console.info('header-navigation-counts',JSON.stringify(observed));
  expect(observed).toEqual({sessions:1,subscriptions:1,unsubscribes:0,cartRequests:1});
});

test('cart updates, cart entry, tab return and account changes still refresh the correct badge',async({page})=>{
  const {requests}=await mount(page);const cart=page.getByRole('link',{name:'장바구니',exact:true});
  await page.evaluate(()=>window.dispatchEvent(new Event('onside:cart-updated')));
  await expect(cart).toHaveText('4');
  await changePath(page,'/mypage/cart');await expect(cart).toHaveText('5');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect(cart).toHaveText('6');
  await page.evaluate(()=>(window as unknown as {__changeAuth:(id:string|null)=>void}).__changeAuth('fixture-user-two'));
  await expect(cart).toHaveText('7');
  const beforeSignout=requests.length;
  await page.evaluate(()=>(window as unknown as {__changeAuth:(id:string|null)=>void}).__changeAuth(null));
  await expect(page.getByRole('link',{name:'로그인',exact:true})).toBeVisible();await expect(cart).toHaveText('');
  await changePath(page,'/track');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  expect(requests).toHaveLength(beforeSignout);
});

test('a delayed previous-account response cannot replace the new account badge',async({page})=>{
  const fixture=await mount(page,{holdRequest:2});const cart=page.getByRole('link',{name:'장바구니',exact:true});
  await page.evaluate(()=>window.dispatchEvent(new Event('onside:cart-updated')));
  await expect.poll(()=>fixture.requests.length).toBe(2);
  await page.evaluate(()=>(window as unknown as {__changeAuth:(id:string)=>void}).__changeAuth('fixture-user-two'));
  await expect(cart).toHaveText('5');
  fixture.release();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(cart).toHaveText('5');
});

test('a burst of cart changes coalesces in-flight refreshes and still reads the latest result',async({page})=>{
  const fixture=await mount(page,{holdRequest:2});const cart=page.getByRole('link',{name:'장바구니',exact:true});
  await page.evaluate(()=>{for(let i=0;i<4;i++)window.dispatchEvent(new Event('onside:cart-updated'))});
  await expect.poll(()=>fixture.requests.length).toBe(2);
  fixture.release();await expect(cart).toHaveText('5');expect(fixture.requests).toHaveLength(3);
});

test('unexpected session read rejection is handled and the guest cart remains local',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const {requests}=await mount(page);
  await page.evaluate(()=>{
    localStorage.setItem('onside:guest-submission-cart:v1',JSON.stringify([{submissionId:'11111111-1111-4111-8111-111111111111',guestToken:'fixture-guest-proof'}]));
    (window as unknown as {__headerFailSession:boolean}).__headerFailSession=true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('link',{name:'로그인',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'장바구니',exact:true})).toHaveText('1');
  const count=requests.length;
  await changePath(page,'/track');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  expect(requests).toHaveLength(count);expect(errors).toEqual([]);
});

for(const prefix of ['', '/en']){
  test(`cookie-only server login refreshes the header after ${prefix||'Korean'} login redirect`,async({page})=>{
    const {requests}=await mount(page,{path:`${prefix}/login`,guest:true});
    await expect.poll(async()=> (await metrics(page)).sessions).toBe(1);
    await page.evaluate(()=>(window as unknown as {__setCookieSession:(id:string)=>void}).__setCookieSession('fixture-cookie-user'));
    await changePath(page,`${prefix}/mypage`);
    await expect(page.getByRole('button',{name:prefix?'Logout':'로그아웃',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:prefix?'Cart':'장바구니',exact:true})).toHaveText('3');
    await changePath(page,`${prefix}/track`);
    expect(await metrics(page)).toEqual({sessions:2,subscriptions:1,unsubscribes:0});expect(requests).toHaveLength(1);
  });

  test(`the ${prefix||'Korean'} loading fallback keeps header navigation interactive until information resolves`,async({page})=>{
    await mount(page,{path:`${prefix}/dashboard?loading`});
    const status=page.getByRole('status');await expect(status).toBeVisible();
    await expect(status).toHaveText(prefix?'Loading your information…':'정보를 불러오고 있습니다.');
    await page.getByRole('navigation',{name:prefix?'Primary navigation':'주요 메뉴',exact:true}).getByRole('link',{name:prefix?'Results':'결과 조회',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/track$`));await expect(status).toBeVisible();
    await page.evaluate(()=>(window as unknown as {__resolveInformation:()=>void}).__resolveInformation());
    await expect(page.getByText('Information ready',{exact:true})).toBeVisible();await expect(status).toHaveCount(0);
  });
}
