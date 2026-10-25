import {expect,test,type Page} from '@playwright/test';
import {build} from 'esbuild';

const conversation={id:'11111111-1111-4111-8111-111111111111',accessToken:'fixture-chat-access-token-11111111',userId:null,guestName:null,guestEmail:null,guestPhone:null,status:'WAITING_ADMIN',lastMessagePreview:'앨범',lastMessageAt:'2026-10-25T05:00:00Z',unreadAdminCount:0,unreadVisitorCount:0,visitorLeftAt:null,createdAt:'2026-10-25T04:00:00Z',updatedAt:'2026-10-25T05:00:00Z'};
const messages=[{id:'22222222-2222-4222-8222-222222222222',conversationId:conversation.id,senderType:'VISITOR',senderUserId:null,senderName:null,body:'앨범 가사',createdAt:'2026-10-25T05:00:00Z'},{id:'33333333-3333-4333-8333-333333333333',conversationId:conversation.id,senderType:'ADMIN',senderUserId:null,senderName:null,body:'음원 아티스트',createdAt:'2026-10-25T05:01:00Z'}];
let html:string;
test.beforeAll(async()=>{
 const result=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ChatbotWidget}from'./src/components/chatbot-widget';import{EnglishLanguagePack}from'./src/components/i18n/english-language-pack';createRoot(document.getElementById('root')).render(<><EnglishLanguagePack/><ChatbotWidget/></>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"test"','process.env':'{}'},plugins:[{name:'isolated-chat',setup(p){p.onResolve({filter:/^(?:next\/navigation|@\/lib\/supabase\/client)$/},args=>({path:args.path,namespace:'fixture'}));p.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:path==='next/navigation'?`export const usePathname=()=>'/en/guide';`:`export const createClient=()=>({channel(){return{on(){return this},subscribe(){return this},async send(){return'ok'}}},removeChannel(){}});`}))}}]});
 html=`<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="root"></div><script>${result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
});
async function englishLabels(page:Page){await expect.poll(()=>page.getByRole('dialog').evaluate(root=>{
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const remaining:string[]=[];let n:Node|null;
 while((n=walker.nextNode())){const p=n.parentElement;if(!p||p.closest('[data-no-translate],textarea')||!p.getClientRects().length)continue;const v=n.textContent?.trim()??'';if(/[가-힣]/.test(v))remaining.push(v)}
 for(const el of root.querySelectorAll('[aria-label],[placeholder]')){for(const attr of ['aria-label','placeholder']){const v=el.getAttribute(attr)??'';if(/[가-힣]/.test(v))remaining.push(v)}}return remaining;
})).toEqual([])}
test('English support chat localizes late-loaded controls, hours and failures without rewriting messages or previews',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const sent:string[]=[];
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/isolated-english-chat')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
  if(u.pathname==='/api/chat'){
   if(route.request().method()==='POST'){sent.push(route.request().postDataJSON().body);return route.fulfill({status:503,json:{error:'메시지를 보내지 못했습니다.'}})}
   if(u.searchParams.has('list'))return route.fulfill({json:{conversations:[conversation,{...conversation,id:'44444444-4444-4444-8444-444444444444',accessToken:'fixture-chat-access-token-44444444',lastMessagePreview:null,lastMessageAt:'2026-10-24T04:00:00Z'}]}});
   return route.fulfill({json:{conversation,messages}});
  }
  return route.fulfill({status:404,body:'No external service access'});
 });
 await page.goto('/isolated-english-chat');await page.getByRole('button',{name:'Open live chat',exact:true}).click();
 await page.getByRole('button',{name:'View support hours',exact:true}).click();await englishLabels(page);
 await expect(page.getByRole('dialog')).toContainText('10:00 ~ 18:00');await expect(page.getByRole('dialog')).not.toContainText('20:00');
 await expect(page.getByText('앨범',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Conversation list',exact:true}).click();await englishLabels(page);
 await expect(page.getByText('A new conversation has started.',{exact:true})).toBeVisible();
 await page.getByText('앨범',{exact:true}).click();await englishLabels(page);
 await expect(page.getByText('앨범 가사',{exact:true})).toBeVisible();await expect(page.getByText('음원 아티스트',{exact:true})).toBeVisible();
 const composer=page.getByPlaceholder('Type your message.');await composer.fill('가사 원문');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByText('We could not send your message.',{exact:true})).toBeVisible();await expect(composer).toHaveValue('가사 원문');expect(sent).toEqual(['가사 원문']);
 await page.getByRole('button',{name:'Chat settings',exact:true}).click();await expect(page.getByRole('menuitem',{name:'Leave conversation',exact:true})).toBeVisible();await englishLabels(page);expect(errors).toEqual([]);
});
