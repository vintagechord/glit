import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let source: string;
test.beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SubmissionFilesPanel} from './src/features/submissions/submission-files-panel';
    window.open=()=>null;
    createRoot(document.getElementById('root')).render(<SubmissionFilesPanel submissionId="fixture" files={[{id:'file',kind:'VIDEO',file_path:'private/video.mp4',original_name:'가사 다운로드 심의.mp4',mime:'video/mp4',size:120,created_at:null}]} />);
  ` }, bundle: true, platform: "browser", format: "iife", write: false, plugins: [{name:'file-fixture',setup(p){
    p.onResolve({filter:/^@\/features\/submissions\/actions$/},()=>({path:'actions',namespace:'fixture'}));
    p.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`export async function getSubmissionFileUrlAction(){ if(window.location.search.includes('timeout'))return new Promise(()=>{}); await new Promise(r=>setTimeout(r,20)); if(window.location.search.includes('failure'))throw Error('network'); return {url:'https://files.example.invalid/video.mp4'}; }`}));
  }}] });
  source=result.outputFiles[0].text;
});

test.beforeEach(async ({page})=>{
  await page.route('**/*', route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script>${source}</script></body></html>`}));
});
test('a blocked popup leaves an explicit file link and preserves its original name',async({page})=>{
  await page.goto('/__file_fixture');
  await page.getByRole('button',{name:'다운로드',exact:true}).click();
  await expect(page.getByRole('link',{name:'파일 열기',exact:true})).toHaveAttribute('href','https://files.example.invalid/video.mp4');
  await expect(page.getByRole('button',{name:'다운로드',exact:true})).toBeEnabled();
  await expect(page.locator('[data-no-translate]')).toHaveText('가사 다운로드 심의.mp4');
});
test('a rejected file lookup clears busy state and shows an actionable retry error',async({page})=>{
  await page.goto('/__file_fixture?failure');
  await page.getByRole('button',{name:'다운로드',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('파일을 불러오지 못했습니다. 다시 시도해주세요.');
  await expect(page.getByRole('button',{name:'다운로드',exact:true})).toBeEnabled();
  await expect(page.getByRole('link',{name:'파일 열기',exact:true})).toHaveCount(0);
});

test('a stalled file lookup times out without leaving the download button disabled',async({page})=>{
  await page.goto('/__file_fixture?timeout');
  await page.clock.install();
  await page.getByRole('button',{name:'다운로드',exact:true}).click();
  await expect(page.getByRole('button',{name:'다운로드 중',exact:true})).toBeDisabled();
  await page.clock.fastForward(21_000);
  await expect(page.getByRole('alert')).toHaveText('파일 조회 응답이 지연되고 있습니다. 다시 시도해주세요.');
  await expect(page.getByRole('button',{name:'다운로드',exact:true})).toBeEnabled();
});
