import {expect,test,type Page} from '@playwright/test';
const id='11111111-1111-4111-8111-111111111111', token='22222222-2222-4222-8222-222222222222';
async function fixture(page:Page){
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  if(u.pathname==='/api/submissions/drafts')return route.fulfill({json:{drafts:[]}});
  if(u.pathname==='/api/submissions/draft')return route.fulfill({json:{submissionId:id,guestToken:token}});
  if(r.headers()['next-action'])return route.fulfill({contentType:'text/x-component',body:`0:${JSON.stringify({a:{submissionId:id,guestToken:token},f:''})}\n`});
  if(u.pathname.startsWith('/api/'))return route.fulfill({json:{}});
  if(!['GET','HEAD','OPTIONS'].includes(r.method()))return route.fulfill({status:409,body:'No live writes in this fixture'});
  if(!['localhost','127.0.0.1'].includes(u.hostname))return route.fulfill({status:404,body:'No external services'});
  return route.continue();
 });return errors;
}
async function expectEnglishUi(page:Page){
 await expect.poll(()=>page.locator('main').first().evaluate(root=>{
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),remaining:string[]=[];
  let n:Node|null;while((n=walker.nextNode())){const p=n.parentElement;if(!p||p.closest('script,style,textarea,pre,code,[data-no-translate],[translate="no"]')||!p.getClientRects().length)continue;const text=n.textContent?.trim()??'';if(/[가-힣]/.test(text))remaining.push(text)}
  return [...new Set(remaining)];
 }),{timeout:12000}).toEqual([]);
}
test('English album application translates changing steps and preserves entered Korean lyrics',async({page})=>{
 const errors=await fixture(page);await page.goto('/en/dashboard/new/album');
 await page.getByRole('button',{name:/Not Released Yet/}).click();await expectEnglishUi(page);
 await page.getByRole('button',{name:'Continue to Application',exact:true}).click();
 await page.getByRole('radio',{name:/Complete Online/}).click();
 await page.getByRole('button',{name:'Continue with Selection',exact:true}).click();await expectEnglishUi(page);
 for(const [field,value] of Object.entries({title:'앨범 가사',artistName:'음원 아티스트',artistNameKr:'음원 아티스트',artistNameEn:'Fixture',releaseDate:'2026-10-24',distributor:'Fixture',productionCompany:'Fixture',previousRelease:'Debut',applicantName:'Fixture',applicantEmail:'fixture@example.invalid',applicantPhone:'01012345678'}))await page.locator(`[data-preflight-field="${field}"]`).fill(value);
 await page.locator('[data-preflight-field="genre"]').selectOption({index:1});await page.locator('[data-preflight-field="artistType"]').selectOption('SOLO');await page.locator('[data-preflight-field="artistGender"]').selectOption({index:1});await page.locator('[data-preflight-field="aiUsed"]').getByRole('button').first().click();
 await page.getByRole('button',{name:'Save and Continue',exact:true}).click();
 await page.locator('[data-preflight-field="lyrics"]').fill('앨범 가사 음원은 원문으로 보존됩니다.');
 await expectEnglishUi(page);await expect(page.locator('[data-preflight-field="lyrics"]')).toHaveValue('앨범 가사 음원은 원문으로 보존됩니다.');expect(errors).toEqual([]);
});
for(const mode of ['distribution','broadcast'])test(`English ${mode} MV form translates required fields, validation, and upload step`,async({page})=>{
 const errors=await fixture(page);await page.goto(`/en/dashboard/new/mv?type=${mode}`);
 if(mode==='broadcast')await page.locator('[data-preflight-field="reviewOptions"]').getByRole('button',{name:/MBC/}).click();
 await expectEnglishUi(page);await page.getByRole('button',{name:'Next Step',exact:true}).click();
 await page.getByRole('radio',{name:/Complete Online/}).click();await page.getByRole('button',{name:'Continue with Selection',exact:true}).click();
 await expectEnglishUi(page);
 const values={title:'앨범 가사',artistName:'음원 아티스트',artistNameOfficial:'Fixture',releaseDate:'2026-10-24',director:'Director',leadActor:'Lead',agency:'Agency',albumTitle:'Album',distributionCompany:'Distributor',usage:'Online',songTitleKr:'앨범 가사',songTitleEn:'Song',songTitleOfficial:'Song',composer:'Composer',storyline:'주인공이 마지막에 집으로 돌아옵니다.',lyrics:'우리가 함께 걷는 길',guestName:'Fixture',guestEmail:'fixture@example.invalid',guestPhone:'01012345678'};
 for(const [field,value]of Object.entries(values))await page.locator(`[data-mv-field="${field}"]`).fill(value);
 await page.getByRole('button',{name:'Not used',exact:true}).click();await page.getByRole('button',{name:'Next Step',exact:true}).click();await expectEnglishUi(page);
 expect(errors).toEqual([]);
});
