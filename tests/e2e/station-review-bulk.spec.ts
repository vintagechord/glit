import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
let html: string;
test.beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `import React from 'react';import{createRoot}from'react-dom/client';import{StationReviewBulkForm}from'./src/components/admin/station-review-bulk-form';window.calls=[];createRoot(document.getElementById('root')).render(<StationReviewBulkForm submissionId="11111111-1111-4111-8111-111111111111" broadcast={false} stations={[{stationId:'22222222-2222-4222-8222-222222222222',name:'KBS',expectedUpdatedAt:'2026-10-25T00:00:00Z'},{stationId:'33333333-3333-4333-8333-333333333333',name:'MBC',expectedUpdatedAt:null}]}/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "fixture", setup(plugin) {
    plugin.onResolve({filter:/^(next\/navigation|@\/features\/admin\/actions)$/},args=>({path:args.path,namespace:'fixture'}));
    plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='next/navigation'?`export const useRouter=()=>({refresh(){window.refreshed=true;}});`:`export const updateStationReviewsBulkAction=async(input)=>{window.calls.push(input);return window.fail?{error:'다른 화면에서 변경되어 일괄 저장하지 않았습니다.'}:{message:'2개 방송사를 저장했습니다. 이메일은 별도로 발송해주세요.'}};`}));
  } }] });
  html=`<!doctype html><html lang="ko"><body><div id="root"></div><script>${result.outputFiles[0].text.replace(/<\/script/gi,"<\\/script")}</script></body></html>`;
});
async function mount(page:Page) {await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://bulk-review.test/');}
test('five stages and checked broadcasters save in one explicit operation with each revision',async({page})=>{
  await mount(page);await expect(page.getByRole('button',{name:'선택한 0개 방송사 저장'})).toBeDisabled();
  expect(await page.getByLabel('일괄 적용할 방송사 상태').locator('option').allTextContents()).toEqual(['접수예정','접수완료','적격','부적격','보완 요청']);
  await page.getByLabel('전체 선택',{exact:true}).check();await page.getByLabel('일괄 적용할 방송사 상태').selectOption('APPROVED');
  await page.getByRole('button',{name:'선택한 2개 방송사 저장'}).click();await expect(page.getByRole('status')).toContainText('이메일은 별도로');
  const calls=await page.evaluate(()=>Reflect.get(window,'calls'));expect(calls).toHaveLength(1);expect(calls[0].status).toBe('APPROVED');expect(calls[0].stations).toEqual([{stationId:'22222222-2222-4222-8222-222222222222',expectedUpdatedAt:'2026-10-25T00:00:00Z'},{stationId:'33333333-3333-4333-8333-333333333333',expectedUpdatedAt:null}]);
  await expect(page.getByLabel('전체 선택',{exact:true})).not.toBeChecked();expect(await page.evaluate(()=>Reflect.get(window,'refreshed'))).toBe(true);
});
test('failed bulk save retains the administrator selection for review',async({page})=>{
  await mount(page);await page.evaluate(()=>Reflect.set(window,'fail',true));await page.getByLabel('KBS',{exact:true}).check();await page.getByRole('button',{name:'선택한 1개 방송사 저장'}).click();
  await expect(page.getByRole('alert')).toContainText('일괄 저장하지 않았습니다');await expect(page.getByLabel('KBS',{exact:true})).toBeChecked();expect(await page.evaluate(()=>Reflect.get(window,'calls').length)).toBe(1);
});
