import { expect, test, type Page } from "@playwright/test";
import { applyArchiveCommand, createArchiveData, type ArchiveCommand } from "../../src/lib/music-archive/model";
import { agencyGuides } from "../../src/lib/music-archive/guides";
import { type Library, type SyncJob, type Submission } from "../../src/features/music-archive/types";
import { archiveClientDocument } from "./support/music-archive-mount";

const artistOne = "11111111-1111-4111-8111-111111111111";
const candidateOne = "123456";
const candidateTwo = "123457";
const providers = [
  { id: "apple", name: "Apple Music 한국 카탈로그", status: "available", automaticImplemented: true, message: "테스트의 모의 제공처 응답입니다.", url: "https://music.apple.com/kr", checkedAt: "2026-09-08" },
  { id: "spotify", name: "Spotify", status: "permission_required", automaticImplemented: false, message: "이용 허가 확인 필요", url: "https://developer.spotify.com/policy", checkedAt: "2026-09-08" },
];
test.use({actionTimeout:5000});
test.setTimeout(25000);
let html: string;
test.beforeAll(async () => { html = await archiveClientDocument("./src/features/music-archive/music-archive-client", "MusicArchiveClient"); });

type Harness = { libraries: Library[]; jobs: SyncJob[]; reviews: Submission[]; writes: Record<string, unknown>[]; errors: string[]; searches: string[]; connectFailures: number; jobStatus: string };
async function mount(page: Page, initial: Library[] = []): Promise<Harness> {
  const harness: Harness = { libraries: structuredClone(initial), jobs: [], reviews: [], writes: [], errors: [], searches: [], connectFailures: 0, jobStatus: "partial" };
  page.on("pageerror", (error) => harness.errors.push(error.message));
  await page.context().route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/mypage/music" && request.resourceType() === "document") { await route.fulfill({ contentType: "text/html", body: html }); return; }
    if (url.pathname === "/api/music-archive") {
      if (request.method() === "GET") {
        if (url.searchParams.get("action") === "search") { harness.searches.push(request.url()); await route.fulfill({ json: { items: [candidateOne,candidateTwo].map((id,i) => ({ provider:"apple",externalId:id,name:"동명 아티스트",sortName:"Same Name",disambiguation:i ? "서울 인디 밴드" : "부산 재즈 연주자",country:"KR",type:"Group",url:`https://music.apple.com/kr/artist/${id}`,imageUrl:null,representativeRelease:null })), total:2,nextOffset:null,queryStatus:"success" } }); return; }
        if (url.searchParams.get("action") === "submissions") { await route.fulfill({ json:{submissions:[],nextPage:null} }); return; }
        const id = url.searchParams.get("libraryId");
        await route.fulfill({ json: id ? { library:harness.libraries.find((item) => item.id === id),jobs:harness.jobs,reviews:harness.reviews,evidence:[],events:[] } : { libraries:harness.libraries,jobs:harness.jobs,providers,guides:agencyGuides,total:harness.libraries.length,nextPage:null } }); return;
      }
      const body = request.postDataJSON() as Record<string, unknown>; harness.writes.push(body);
      if (body.action === "create") { const library: Library = {id:artistOne,version:1,data:createArchiveData(String(body.name)),updated_at:"2026-09-08T00:00:00Z"}; harness.libraries.push(library); await route.fulfill({json:{library}}); return; }
      const index = harness.libraries.findIndex((item) => item.id === body.libraryId); const library = harness.libraries[index];
      if (body.action === "sync" || body.action === "resume") { harness.jobs = [{id:"sync-one",library_id:artistOne,provider:"apple",status:"partial",counts:{releases:23,tracks:126},cursor:{providerCursor:{phase:"artist",offset:25,total:68,pending:["next-release"]}},checked_at:"2026-09-08T00:00:00Z",error_message:"일부 페이지를 처리했습니다. 다음 위치에서 계속 수집할 수 있습니다."}]; await route.fulfill({json:{job:harness.jobs[0]}}); return; }
      if (!library) { await route.fulfill({status:404,json:{error:"라이브러리 없음"}}); return; }
      if (body.version !== library.version) { await route.fulfill({status:409,json:{error:"동시에 변경된 자료입니다."}}); return; }
      let data = library.data;
      if (body.action === "command") data = applyArchiveCommand(data,body.command);
      if (body.action === "commands") for (const command of body.commands as ArchiveCommand[]) data = applyArchiveCommand(data,command);
      if (body.action === "connect") {
        if (harness.connectFailures > 0) { harness.connectFailures -= 1; await route.fulfill({status:503,json:{error:"일시적으로 연결하지 못했습니다. 다시 시도해 주세요."}}); return; }
        data = applyArchiveCommand(data,{type:"set_connection",connection:{provider:body.provider,url:body.url,externalArtistId:body.externalId,confirmed:true}});
        if (body.provider === "apple") harness.jobs = [{id:"sync-one",library_id:artistOne,provider:"apple",status:harness.jobStatus,counts:{releases:23,tracks:126},cursor:{providerCursor:{offset:25,total:68,pending:["next"]}},updated_at:"2026-09-08T00:00:00Z",error_code:"PERMISSION_REQUIRED",error_message:"서버 이용 허가 확인 필요"}];
      }
      const next = {...library,data,version:library.version+1,...(body.action === "archive" ? {archived_at:"2026-09-08T00:00:00Z"} : body.action === "restore" ? {archived_at:null} : {})}; harness.libraries[index] = next;
      await route.fulfill({json:{library:next,...(body.action === "connect" && harness.jobs.length ? {job:harness.jobs[0],runLibraryId:next.id} : {})}}); return;
    }
    if (url.protocol === "https:") { await route.fulfill({contentType:"text/html",body:"<!doctype html><title>공식 링크 모의 페이지</title>"}); return; }
    await route.fulfill({status:404,body:"Unexpected request blocked by the UI test."});
  });
  await page.goto("/mypage/music"); await expect.poll(() => harness.errors).toEqual([]); await expect(page.getByTestId("music-archive")).toBeVisible();
  return harness;
}

async function addManualArtist(page: Page) {
  await page.getByRole("button",{name:"아티스트 추가",exact:true}).first().click();
  await page.getByRole("button",{name:"직접 추가",exact:true}).click();
  await page.getByLabel("아티스트 활동명",{exact:true}).fill("테스트 뮤지션");
  await page.getByRole("button",{name:"아티스트 직접 추가",exact:true}).click();
  await expect(page.getByRole("heading",{name:"테스트 뮤지션",exact:true})).toBeVisible();
}
async function addRelease(page: Page, title="발매 후 첫 앨범") {
  await page.getByRole("button",{name:"발매작 직접 추가",exact:true}).click();
  await page.getByLabel("앨범 / 발매작 제목",{exact:true}).fill(title);
  await page.getByLabel("발매일",{exact:true}).fill("2026-09-01");
  await page.getByRole("button",{name:"정보 저장",exact:true}).click();
  await page.getByRole("button",{name:new RegExp(title)}).click();
  await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
}
async function addTrack(page: Page,title:string,version:string) {
  await page.getByRole("button",{name:"트랙 직접 추가",exact:true}).click();
  await page.getByLabel("트랙 제목",{exact:true}).fill(title);
  await page.getByLabel("버전",{exact:true}).fill(version);
  await page.getByRole("button",{name:"정보 저장",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

for (const width of [390,1440]) {
  test(`manual archive → tracks → scoped karaoke records fits ${width}px without external orders`,async ({page},testInfo) => {
    await page.setViewportSize({width,height:900}); const harness=await mount(page);
    await addManualArtist(page); await addRelease(page); await addTrack(page,"같은 제목","Original"); await addTrack(page,"같은 제목","Clean");
    expect(harness.libraries[0].data.recordings).toHaveLength(2);
    await page.getByRole("navigation",{name:"발매 후 업무 탭"}).getByRole("button",{name:"노래방 등록",exact:true}).click();
    await page.getByRole("button",{name:"이미 진행한 내역 입력 / 상태 기록",exact:true}).click();
    await page.getByLabel("업무 진행 상태",{exact:true}).selectOption("submitted");
    await page.getByLabel("접수 / 등록 / 작품 확인번호",{exact:true}).fill("TJ-TEST-1");
    const scope=page.getByRole("group",{name:/적용 트랙 선택/}); await scope.getByRole("checkbox").nth(1).uncheck();
    await page.getByRole("button",{name:"선택한 트랙에 적용할 내용 확인",exact:true}).click();
    await expect(page.getByRole("region",{name:"선택 트랙 적용 미리보기"})).toContainText("선택한 1개 트랙");
    await page.getByRole("button",{name:"확인한 범위에 저장",exact:true}).click();
    const taskRegion=page.getByRole("region",{name:"사용자 업무 이력"});
    await expect(taskRegion).toContainText("신청 완료"); await expect(taskRegion).toContainText("결과 미확인"); await expect(taskRegion).toContainText("사용자 입력"); await expect(taskRegion).toContainText("공식 조회 미확인");
    expect(harness.libraries[0].data.tasks).toHaveLength(1); expect(harness.libraries[0].data.tasks[0].agency).toBe("TJ"); expect(harness.libraries[0].data.tasks[0].result).toBe("unknown");
    const beforeWrites=harness.writes.length;
    await page.getByText("TJ · 일반 반주곡 신청·추천 · 등록 방법 보기",{exact:true}).click();
    const guide=page.locator("details").filter({has:page.getByText("TJ · 일반 반주곡 신청·추천 · 등록 방법 보기",{exact:true})});
    const popup=page.waitForEvent("popup"); await guide.getByRole("link",{name:"공식 사이트에서 신청",exact:true}).click(); await (await popup).close();
    expect(harness.writes).toHaveLength(beforeWrites);
    await page.getByRole("button",{name:"새로고침",exact:true}).click(); await expect(taskRegion).toContainText("TJ-TEST-1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({path:testInfo.outputPath(`music-archive-${width}.png`),fullPage:true});
    expect(harness.errors).toEqual([]); expect(harness.writes.every((item) => ["create","commands","command"].includes(String(item.action)))).toBe(true);
  });
}

test("artist autocomplete keeps same-name confirmation and truthful import progress without provider setup cards",async ({page}, testInfo) => {
  await page.setViewportSize({width:390,height:844});
  const harness=await mount(page); await page.getByRole("button",{name:"아티스트 추가",exact:true}).first().click();
  const input=page.getByRole("combobox",{name:"아티스트 이름",exact:true});
  await input.fill("ㄷㅁ");
  await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(2); expect(harness.writes).toHaveLength(0);
  await page.screenshot({path:testInfo.outputPath("artist-search-390.png"),fullPage:true});
  expect(harness.searches).toHaveLength(1); expect(new URL(harness.searches[0]).searchParams.get("q")).toBe("ㄷㅁ"); expect(new URL(harness.searches[0]).searchParams.has("provider")).toBe(false);
  await input.press("ArrowDown"); await input.press("ArrowDown"); await input.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("서울 인디 밴드"); expect(harness.writes).toHaveLength(0);
  await page.getByRole("button",{name:"이 아티스트의 앨범 불러오기",exact:true}).click();
  await expect.poll(() => harness.libraries[0]?.data.connections[0]?.externalArtistId).toBe(candidateTwo);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const status=page.getByLabel("앨범 불러오기 현황"); await expect(status).toContainText("일부 불러옴"); await expect(status).toContainText("발매작 23개 · 트랙 126개");
  await expect(status).not.toContainText("PERMISSION_REQUIRED"); await expect(page.locator("body")).not.toContainText("이용 허가 확인 필요"); await expect(page.locator("body")).not.toContainText("Spotify");
  await expect(page.getByRole("button",{name:"이어서 불러오기",exact:true})).toBeVisible(); expect(harness.writes.map((item) => item.action)).toEqual(["create","connect"]); expect(harness.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); await page.screenshot({path:testInfo.outputPath("artist-import-390.png"),fullPage:true});
});


test("merge preview preserves distinct recordings and tasks and can be undone",async ({page}) => {
  let data=createArchiveData("복구 검증");
  for (const command of [
    {type:"add_release",release:{id:"release-a",title:"같은 제목 앨범",type:"album",participation:"primary",links:[]}},
    {type:"save_recording",recording:{id:"rec-a",title:"동명곡",version:"Original",workIds:[]}},
    {type:"save_recording",recording:{id:"rec-b",title:"동명곡",version:"Live",workIds:[]}},
    {type:"add_track",track:{id:"track-a",releaseId:"release-a",title:"동명곡",version:"Original",discNumber:1,trackNumber:1,recordingId:"rec-a",managed:true,links:[]}},
    {type:"add_track",track:{id:"track-b",releaseId:"release-a",title:"동명곡",version:"Live",discNumber:1,trackNumber:2,recordingId:"rec-b",managed:true,links:[]}},
    {type:"save_tasks",id:"task-a",trackIds:["track-a"],task:{kind:"review",agency:"KBS",status:"completed",result:"eligible",attachmentIds:[]}},
  ]) data=applyArchiveCommand(data,command);
  const harness=await mount(page,[{id:artistOne,version:1,data}]);
  await page.getByRole("button",{name:/복구 검증/}).first().click(); await page.getByRole("button",{name:/같은 제목 앨범/}).click();
  await page.getByRole("button",{name:"중복 트랙 비교",exact:true}).click(); await page.getByLabel("묶을 중복 후보",{exact:true}).selectOption("track-a"); await page.getByLabel("유지할 대표 항목",{exact:true}).selectOption("track-b");
  await expect(page.getByRole("dialog")).toContainText("보존할 업무 기록 1건");
  await page.getByRole("checkbox",{name:/제목뿐 아니라/}).check(); await page.getByRole("button",{name:"확인한 중복 후보 병합",exact:true}).click();
  await expect.poll(() => harness.libraries[0].data.tracks[0].mergedInto).toBe("track-b"); expect(harness.libraries[0].data.tasks[0].trackId).toBe("track-a");
  await page.getByRole("button",{name:"병합 복구",exact:true}).click(); await expect.poll(() => harness.libraries[0].data.tracks[0].mergedInto).toBeUndefined(); expect(harness.libraries[0].data.tasks[0].result).toBe("eligible"); expect(harness.errors).toEqual([]);
});


test("exact mapped review results remain distinct from another version in track comparison",async ({page}) => {
  const submissionId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const originalId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const cleanId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  let data=createArchiveData("버전별 결과 검증");
  for (const command of [
    {type:"add_release",release:{id:"release-one",title:"심의 연결 앨범",type:"album",participation:"primary",links:[]}},
    {type:"add_track",track:{id:"original",releaseId:"release-one",title:"동명 트랙",version:"Original",discNumber:1,trackNumber:1,managed:true,links:[]}},
    {type:"add_track",track:{id:"clean",releaseId:"release-one",title:"동명 트랙",version:"Clean",discNumber:1,trackNumber:2,managed:true,links:[]}},
    {type:"link_review",link:{id:"link-one",submissionId,releaseId:"release-one",trackId:"original",submissionTrackId:originalId}},
    {type:"link_review",link:{id:"link-two",submissionId,releaseId:"release-one",trackId:"clean",submissionTrackId:cleanId}},
  ]) data=applyArchiveCommand(data,command);
  const harness=await mount(page,[{id:artistOne,version:1,data}]);
  harness.reviews=[{id:submissionId,title:"원본 접수",artist_name:"버전별 결과 검증",status:"COMPLETED",album_tracks:[{id:originalId,track_no:1,track_title:"동명 트랙"},{id:cleanId,track_no:2,track_title:"동명 트랙"}],station_reviews:[{id:"kbs",status:"APPROVED",station:{name:"KBS"},track_results_json:[{track_id:originalId,track_no:1,status:"APPROVED"},{track_id:"different-recording",track_no:2,status:"APPROVED"}]}]}];
  await page.getByRole("button",{name:/버전별 결과 검증/}).first().click(); await page.getByRole("button",{name:/심의 연결 앨범/}).click();
  const original=page.locator("article").filter({has:page.getByRole("button",{name:/^1-1\. 동명 트랙/})}); const clean=page.locator("article").filter({has:page.getByRole("button",{name:/^1-2\. 동명 트랙/})});
  await expect(original).toContainText("온사이드 원본: 1개 방송사 결과 확인 / 0개 확인 필요"); await expect(clean).toContainText("온사이드 원본: 0개 방송사 결과 확인 / 1개 확인 필요");
  await page.getByRole("button",{name:"새로고침",exact:true}).click(); await expect(original).toContainText("KBS · 적격"); await expect(clean).toContainText("KBS · 개별 결과 미확인"); expect(harness.errors).toEqual([]);
});

test("copyright legal registration and performer records retain participant scope after refresh",async ({page}) => {
  const harness=await mount(page); await addManualArtist(page); await addRelease(page); await addTrack(page,"업무 검증곡","Original");
  for (const [tab,kind,agency] of [["저작권 등록","copyright_legal","한국저작권위원회"],["실연자 등록","performer","한국음악실연자연합회"]] as const) {
    await page.getByRole("navigation",{name:"발매 후 업무 탭"}).getByRole("button",{name:tab,exact:true}).click();
    await expect(page.getByRole("region",{name:"공식 등록 방법 안내"})).toBeVisible();
    await page.getByRole("button",{name:"이미 진행한 내역 입력 / 상태 기록",exact:true}).click();
    await page.getByLabel("업무 종류",{exact:true}).selectOption(kind); await page.getByLabel("업무 진행 상태",{exact:true}).selectOption("completed"); await page.getByLabel("업무 결과",{exact:true}).selectOption("approved");
    await page.getByLabel("저작자 / 실연 참여자명",{exact:true}).fill("관리 참여자"); await page.getByLabel("역할 / 참여 부문",{exact:true}).fill(kind === "performer" ? "보컬" : "작곡");
    await page.getByRole("button",{name:"선택한 트랙에 적용할 내용 확인",exact:true}).click(); await page.getByRole("button",{name:"확인한 범위에 저장",exact:true}).click();
    await page.getByRole("button",{name:"새로고침",exact:true}).click(); const history=page.getByRole("region",{name:"사용자 업무 이력"}); await expect(history).toContainText(agency); await expect(history).toContainText("관리 참여자"); await expect(history).toContainText("사용자 입력"); await expect(history).toContainText("등록 승인");
  }
  expect(harness.libraries[0].data.tasks.map((task) => task.kind).sort()).toEqual(["copyright_legal","performer"]); expect(harness.errors).toEqual([]);
});

test("artist search ignores late responses and recovers from a query failure without exposing setup messages", async ({page}) => {
  const harness = await mount(page);
  let oldFinished = false;
  await page.route("**/api/music-archive?action=search**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q === "이전") { await new Promise(resolve => setTimeout(resolve, 800)); oldFinished = true; }
    if (q === "실패") { await route.fulfill({json:{items:[],queryStatus:"forbidden",message:"서버 이용 허가 확인 필요"}}); return; }
    await route.fulfill({json:{items:[{provider:"apple",externalId:q === "이전" ? candidateOne : candidateTwo,name:q,sortName:q,disambiguation:"국내 아티스트",country:"KR",type:"",url:`https://music.apple.com/kr/artist/${candidateTwo}`,imageUrl:null,representativeRelease:null}],nextOffset:null,queryStatus:"success"}}).catch(() => {});
  });
  await page.getByRole("button",{name:"아티스트 추가",exact:true}).first().click();
  const input = page.getByRole("combobox",{name:"아티스트 이름",exact:true});
  const oldRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get("q") === "이전");
  await input.fill("이전"); await oldRequest;
  await input.fill("최신"); await expect(page.getByRole("dialog").getByRole("option")).toContainText("최신");
  await expect.poll(() => oldFinished).toBe(true); await expect(page.getByRole("dialog").getByRole("option")).toContainText("최신"); await expect(page.getByRole("dialog").getByRole("option")).not.toContainText("이전");
  await input.fill("실패"); await expect(page.getByRole("dialog")).toContainText("검색 결과를 불러오지 못했습니다"); await expect(page.getByRole("dialog")).not.toContainText("이용 허가"); await expect(page.getByRole("dialog")).not.toContainText("검색 결과가 없습니다");
  await input.fill("복구"); await expect(page.getByRole("dialog").getByRole("option")).toContainText("복구"); expect(harness.writes).toHaveLength(0); expect(harness.errors).toEqual([]);
});

test("retrying a failed artist connection reuses the saved artist and starts only one import", async ({page}) => {
  const harness = await mount(page); harness.connectFailures = 1;
  await page.getByRole("button",{name:"아티스트 추가",exact:true}).first().click();
  await page.getByRole("combobox",{name:"아티스트 이름",exact:true}).fill("동명 아티스트");
  await page.getByRole("dialog").getByRole("option",{name:/서울 인디 밴드/}).click();
  await page.getByRole("button",{name:"이 아티스트의 앨범 불러오기",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("일시적으로 연결하지 못했습니다");
  expect(harness.libraries).toHaveLength(1);
  await page.getByRole("button",{name:"이 아티스트의 앨범 불러오기",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(harness.libraries).toHaveLength(1); expect(harness.writes.map(item => item.action)).toEqual(["create","connect","connect"]); expect(harness.errors).toEqual([]);
});

test("a domestic artist link is saved honestly and a catalog candidate requires confirmation before import", async ({page}) => {
  const harness = await mount(page);
  await page.getByRole("button",{name:"아티스트 추가",exact:true}).first().click();
  await page.getByRole("button",{name:"아티스트 링크",exact:true}).click();
  await page.getByLabel("아티스트 링크",{exact:true}).fill("https://www.melon.com/artist/timeline.htm?artistId=1234");
  await page.getByLabel("관리할 아티스트 이름",{exact:true}).fill("동명 아티스트");
  await page.getByRole("button",{name:"아티스트 링크 추가",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByRole("status")).toContainText("아티스트 링크를 저장했습니다"); await expect(page.getByLabel("앨범 불러오기 현황")).toHaveCount(0);
  const before = harness.writes.length;
  await page.getByRole("button",{name:"앨범 찾아보기",exact:true}).first().click();
  await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(2); expect(harness.writes).toHaveLength(before);
  await page.getByRole("dialog").getByRole("option",{name:/서울 인디 밴드/}).click(); await page.getByRole("button",{name:"이 아티스트의 앨범 불러오기",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); expect(harness.libraries).toHaveLength(1); expect(harness.libraries[0].data.connections.map(item => item.provider)).toEqual(["melon","apple"]); expect(harness.writes.filter(item => item.action === "sync")).toHaveLength(0); expect(harness.errors).toEqual([]);
});

test("background import refresh adds albums without overwriting an open artist draft", async ({page}) => {
  const harness = await mount(page); harness.jobStatus = "running";
  await page.getByRole("button",{name:"아티스트 추가",exact:true}).first().click();
  await page.getByRole("combobox",{name:"아티스트 이름",exact:true}).fill("동명 아티스트");
  await page.getByRole("dialog").getByRole("option",{name:/서울 인디 밴드/}).click(); await page.getByRole("button",{name:"이 아티스트의 앨범 불러오기",exact:true}).click();
  await expect(page.getByLabel("앨범 불러오기 현황")).toContainText("앨범·트랙 불러오는 중");
  await page.getByRole("button",{name:"아티스트 정보 수정",exact:true}).click();
  await page.getByLabel("아티스트 활동명",{exact:true}).fill("저장하지 않은 이름");
  harness.libraries[0] = {...harness.libraries[0],version:harness.libraries[0].version+1,data:applyArchiveCommand(harness.libraries[0].data,{type:"add_release",release:{id:"loaded-release",title:"불러온 앨범",type:"album",participation:"primary",links:[]}})};
  harness.jobs[0] = {...harness.jobs[0],status:"completed",counts:{releases:1,tracks:0},updated_at:"2026-09-08T00:01:00Z"};
  await expect(page.locator('[aria-label="앨범 불러오기 현황"]')).toContainText("불러오기 완료");
  await expect(page.getByLabel("아티스트 활동명",{exact:true})).toHaveValue("저장하지 않은 이름");
  await page.getByRole("button",{name:"닫기",exact:true}).click(); await expect(page.getByRole("button",{name:/불러온 앨범/})).toBeVisible(); expect(harness.errors).toEqual([]);
});

test("copyright lookup uses the entered writer and opening the official search never completes a task", async ({page}) => {
  const harness = await mount(page); await addManualArtist(page); await addRelease(page); await addTrack(page,"저작물 확인곡","Original");
  await page.getByRole("navigation",{name:"발매 후 업무 탭"}).getByRole("button",{name:"저작권 등록",exact:true}).click();
  const lookup = page.getByRole("region",{name:"음악저작물 공식 검색"});
  await expect(lookup.getByLabel("검색할 저작자명",{exact:true})).toHaveValue("");
  await lookup.getByLabel("검색할 저작자명",{exact:true}).fill("실제 작곡자");
  await lookup.getByLabel("검색할 관리기관",{exact:true}).selectOption("koscap");
  const href = await lookup.getByRole("link",{name:"KOSCAP에서 작품 검색",exact:true}).getAttribute("href");
  expect(new URL(href!).searchParams.get("f_song_name")).toBe("저작물 확인곡"); expect(new URL(href!).searchParams.get("f_artist")).toBe("실제 작곡자");
  const before = harness.writes.length; const popup = page.waitForEvent("popup"); await lookup.getByRole("link",{name:"KOSCAP에서 작품 검색",exact:true}).click(); await (await popup).close();
  expect(harness.writes).toHaveLength(before); expect(harness.libraries[0].data.tasks).toHaveLength(0);
  await lookup.getByRole("button",{name:"확인한 내역 기록",exact:true}).click();
  await expect(page.getByLabel("기관 / 방송사 / 업체",{exact:true})).toHaveValue("KOSCAP"); await expect(page.getByLabel("저작자 / 실연 참여자명",{exact:true})).toHaveValue("실제 작곡자");
  await expect(page.getByLabel("업무 결과",{exact:true})).toHaveValue("unknown"); expect(harness.errors).toEqual([]);
});

test("a catalog boundary explains the imported scope without offering an endless resume", async ({page}) => {
  const harness = await mount(page,[{id:artistOne,version:1,data:createArchiveData("범위 확인 아티스트")}]);
  harness.jobs = [{id:"limited",library_id:artistOne,provider:"apple",status:"partial",counts:{releases:200,tracks:1900},cursor:{providerCursor:{phase:"limited",offset:200,total:200}},error_code:"PROVIDER_LIMIT"}];
  await page.getByRole("button",{name:/범위 확인 아티스트/}).first().click();
  const status = page.getByLabel("앨범 불러오기 현황");
  await expect(status).toContainText("제공 목록에서 확인한 음악을 불러왔습니다"); await expect(status).toContainText("빠진 앨범은 직접 추가해 주세요"); await expect(status.getByRole("button",{name:"이어서 불러오기",exact:true})).toHaveCount(0); await expect(status).not.toContainText("PROVIDER_LIMIT"); expect(harness.writes).toHaveLength(0); expect(harness.errors).toEqual([]);
});

test("an unmatched initials query suggests the full artist name", async ({page}) => {
  await mount(page);
  await page.route("**/api/music-archive?action=search**", route => route.fulfill({json:{items:[],nextOffset:null,queryStatus:"no_results",scopeNote:"초성 제안은 이전 검색에서 확인한 아티스트를 기준으로 합니다."}}));
  await page.getByRole("button",{name:"아티스트 추가",exact:true}).first().click();
  await page.getByRole("combobox",{name:"아티스트 이름",exact:true}).fill("ㅂㅌㅈㅋㄷ");
  await expect(page.getByRole("dialog")).toContainText("아티스트의 전체 이름으로 검색해 주세요"); await expect(page.getByRole("dialog")).toContainText("이전 검색에서 확인한 아티스트");
});
