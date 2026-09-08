import { expect, test, type Page } from "@playwright/test";
import { applyArchiveCommand, createArchiveData, type ArchiveCommand } from "../../src/lib/music-archive/model";
import { agencyGuides } from "../../src/lib/music-archive/guides";
import { type Library, type SyncJob, type Submission } from "../../src/features/music-archive/types";
import { archiveClientDocument } from "./support/music-archive-mount";

const artistOne = "11111111-1111-4111-8111-111111111111";
const candidateOne = "22222222-2222-4222-8222-222222222222";
const candidateTwo = "33333333-3333-4333-8333-333333333333";
const providers = [
  { id: "musicbrainz", name: "MusicBrainz", status: "available", automaticImplemented: true, message: "테스트의 모의 제공처 응답입니다.", url: "https://musicbrainz.org/doc/MusicBrainz_API", checkedAt: "2026-09-08" },
  { id: "spotify", name: "Spotify", status: "permission_required", automaticImplemented: false, message: "이용 허가 확인 필요", url: "https://developer.spotify.com/policy", checkedAt: "2026-09-08" },
];
test.use({actionTimeout:5000});
test.setTimeout(25000);
let html: string;
test.beforeAll(async () => { html = await archiveClientDocument("./src/features/music-archive/music-archive-client", "MusicArchiveClient"); });

type Harness = { libraries: Library[]; jobs: SyncJob[]; reviews: Submission[]; writes: Record<string, unknown>[]; errors: string[] };
async function mount(page: Page, initial: Library[] = []): Promise<Harness> {
  const harness: Harness = { libraries: structuredClone(initial), jobs: [], reviews: [], writes: [], errors: [] };
  page.on("pageerror", (error) => harness.errors.push(error.message));
  await page.context().route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/mypage/music" && request.resourceType() === "document") { await route.fulfill({ contentType: "text/html", body: html }); return; }
    if (url.pathname === "/api/music-archive") {
      if (request.method() === "GET") {
        if (url.searchParams.get("action") === "search") { await route.fulfill({ json: { items: [candidateOne,candidateTwo].map((id,i) => ({ provider:"musicbrainz",externalId:id,name:"동명 아티스트",sortName:"Same Name",disambiguation:i ? "서울 인디 밴드" : "부산 재즈 연주자",country:"KR",type:"Group",url:`https://musicbrainz.org/artist/${id}`,imageUrl:null,representativeRelease:null })), total:2,nextOffset:null,queryStatus:"success" } }); return; }
        if (url.searchParams.get("action") === "submissions") { await route.fulfill({ json:{submissions:[],nextPage:null} }); return; }
        const id = url.searchParams.get("libraryId");
        await route.fulfill({ json: id ? { library:harness.libraries.find((item) => item.id === id),jobs:harness.jobs,reviews:harness.reviews,evidence:[],events:[] } : { libraries:harness.libraries,jobs:harness.jobs,providers,guides:agencyGuides,total:harness.libraries.length,nextPage:null } }); return;
      }
      const body = request.postDataJSON() as Record<string, unknown>; harness.writes.push(body);
      if (body.action === "create") { const library: Library = {id:artistOne,version:1,data:createArchiveData(String(body.name)),updated_at:"2026-09-08T00:00:00Z"}; harness.libraries.push(library); await route.fulfill({json:{library}}); return; }
      const index = harness.libraries.findIndex((item) => item.id === body.libraryId); const library = harness.libraries[index];
      if (body.action === "sync" || body.action === "resume") { harness.jobs = [{id:"sync-one",library_id:artistOne,provider:"musicbrainz",status:"partial",counts:{releases:23,tracks:126},cursor:{providerCursor:{phase:"artist",offset:25,total:68,pending:["next-release"]}},checked_at:"2026-09-08T00:00:00Z",error_message:"일부 페이지를 처리했습니다. 다음 위치에서 계속 수집할 수 있습니다."}]; await route.fulfill({json:{job:harness.jobs[0]}}); return; }
      if (!library) { await route.fulfill({status:404,json:{error:"라이브러리 없음"}}); return; }
      if (body.version !== library.version) { await route.fulfill({status:409,json:{error:"동시에 변경된 자료입니다."}}); return; }
      let data = library.data;
      if (body.action === "command") data = applyArchiveCommand(data,body.command);
      if (body.action === "commands") for (const command of body.commands as ArchiveCommand[]) data = applyArchiveCommand(data,command);
      if (body.action === "connect") data = applyArchiveCommand(data,{type:"set_connection",connection:{provider:body.provider,url:body.url,externalArtistId:body.externalId,confirmed:true}});
      const next = {...library,data,version:library.version+1,...(body.action === "archive" ? {archived_at:"2026-09-08T00:00:00Z"} : body.action === "restore" ? {archived_at:null} : {})}; harness.libraries[index] = next;
      await route.fulfill({json:{library:next}}); return;
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
    await expect(taskRegion).toContainText("신청 완료"); await expect(taskRegion).toContainText("결과 미확인"); await expect(taskRegion).toContainText("사용자 입력"); await expect(taskRegion).toContainText("자동 연동 미지원");
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

test("same-name artist candidates require explicit confirmation and incomplete sync reports counts/range",async ({page}) => {
  const harness=await mount(page); await page.getByRole("button",{name:"아티스트 추가",exact:true}).first().click();
  await page.getByLabel("아티스트 이름",{exact:true}).fill("동명 아티스트"); await page.getByRole("button",{name:"검색",exact:true}).click();
  await expect(page.getByRole("radio")).toHaveCount(2); expect(harness.writes).toHaveLength(0);
  await page.getByRole("radio",{name:/서울 인디 밴드/}).check(); await page.getByRole("button",{name:"선택한 아티스트 확인하고 연결",exact:true}).click();
  await expect.poll(() => harness.libraries[0]?.data.connections[0]?.externalArtistId).toBe(candidateTwo);
  await page.getByText("제공처별 지원 상태와 수집 현황",{exact:true}).click();
  const status=page.getByLabel("제공처 수집 작업"); await expect(status).toContainText("일부 수집"); await expect(status).toContainText("앨범 23개 · 트랙 126개"); await expect(status).toContainText("다음 위치 25 / 제공처 응답 총 68");
  await expect(page.getByRole("button",{name:"중단 지점부터 계속 수집",exact:true})).toBeVisible(); expect(harness.errors).toEqual([]);
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
