import { expect, test, type Page } from "@playwright/test";
import { applyArchiveCommand, createArchiveData, type ArchiveCommand } from "../../src/lib/music-archive/model";
import { memberArchiveResponse } from "../../src/lib/music-archive/member-view";
import { agencyGuides } from "../../src/lib/music-archive/guides";
import { type Library, type SyncJob, type Submission } from "../../src/features/music-archive/types";
import { archiveClientDocument } from "./support/music-archive-mount";

const artistOne = "11111111-1111-4111-8111-111111111111";
const candidateOne = "123456";
const candidateTwo = "123457";
const providers = [
  { id: "apple", name: "Apple Music 한국 카탈로그", status: "available", automaticImplemented: true, message: "테스트의 모의 제공처 응답입니다.", url: "https://music.apple.com/kr", checkedAt: "2026-09-08" },
  { id: "melon", name: "멜론", status: "available", automaticImplemented: true, message: "공개 페이지 조회", url: "https://www.melon.com/", checkedAt: "2026-10-27" },
  { id: "genie", name: "지니뮤직", status: "available", automaticImplemented: true, message: "공개 페이지 조회", url: "https://www.genie.co.kr/", checkedAt: "2026-10-27" },
  { id: "spotify", name: "Spotify", status: "configuration_required", automaticImplemented: true, message: "Spotify 검색은 서버 API 연결이 필요합니다.", url: "https://developer.spotify.com/", checkedAt: "2026-10-27" },
  { id: "youtube", name: "YouTube", status: "configuration_required", automaticImplemented: false, message: "YouTube 채널 검색은 서버 API 연결이 필요합니다.", url: "https://www.youtube.com/", checkedAt: "2026-10-27" },
];
test.use({actionTimeout:5000});
test.setTimeout(25000);
let html: string;
test.beforeAll(async () => { html = await archiveClientDocument("./src/features/music-archive/music-archive-client", "MusicArchiveClient"); });

test("English music navigation and login return paths stay in the English site", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.context().route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/en/mypage/music" && request.resourceType() === "document") {
      await route.fulfill({ contentType: "text/html", body: html }); return;
    }
    if (url.pathname === "/api/music-archive") {
      await route.fulfill({ status: 401, json: { error: "로그인이 필요합니다." } }); return;
    }
    await route.fulfill({ status: 404, body: "Unexpected request blocked by the UI test." });
  });
  await page.goto("/en/mypage/music");
  await expect(page.getByRole("link", { name: "로그인하고 내 음악 관리 시작", exact: true })).toHaveAttribute("href", "/en/login?next=%2Fen%2Fmypage%2Fmusic");
  await expect(page.getByRole("link", { name: "Orders", exact: true })).toHaveAttribute("href", "/en/mypage/orders");
  await expect(page.getByRole("link", { name: "My Music", exact: true })).toHaveAttribute("href", "/en/mypage/music");
  expect(errors).toEqual([]);
});

type Harness = { onsideReviews: { submissionId: string; releaseId: string; trackIds: string[]; status: string }[]; libraries: Library[]; jobs: SyncJob[]; reviews: Submission[]; writes: Record<string, unknown>[]; errors: string[]; searches: string[]; searchResponse?: Record<string, unknown>; searchDelay?: number; connectFailures: number; archiveFailures?: number; archiveResponseLost?: boolean; jobStatus: string; jobsArrayResponse: boolean };
async function mount(page: Page, initial: Library[] = []): Promise<Harness> {
  const harness: Harness = { onsideReviews: [], libraries: structuredClone(initial), jobs: [], reviews: [], writes: [], errors: [], searches: [], connectFailures: 0, jobStatus: "partial", jobsArrayResponse: false };
  page.on("pageerror", (error) => harness.errors.push(error.message));
  await page.context().route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/mypage/music" && request.resourceType() === "document") { await route.fulfill({ contentType: "text/html", body: html }); return; }
    if (url.pathname === "/api/music-archive") {
      if (request.method() === "GET") {
        if (url.searchParams.get("action") === "search") {
          harness.searches.push(request.url());
          const response = harness.searchResponse ?? { items: [candidateOne,candidateTwo].map((id,i) => ({ provider:"apple",externalId:id,name:"동명 아티스트",sortName:"Same Name",disambiguation:i ? "서울 인디 밴드" : "부산 재즈 연주자",country:"KR",type:"Group",url:`https://music.apple.com/kr/artist/${id}`,imageUrl:null,representativeRelease:null })), total:2,nextOffset:null,queryStatus:"success" };
          if (harness.searchDelay) await new Promise(resolve => setTimeout(resolve, harness.searchDelay));
          await route.fulfill({ json: response }); return;
        }
        if (url.searchParams.get("action") === "submissions") { await route.fulfill({ json:{submissions:[],nextPage:null} }); return; }
        const id = url.searchParams.get("libraryId");
        await route.fulfill({ json: memberArchiveResponse(id ? { library:harness.libraries.find((item) => item.id === id),jobs:harness.jobs,reviews:harness.reviews,onsideReviews:harness.onsideReviews,evidence:[],events:[{action:"admin audit secret"}] } : { libraries:harness.libraries,jobs:harness.jobs,providers,guides:agencyGuides,total:harness.libraries.length,nextPage:null }) }); return;
      }
      const body = request.postDataJSON() as Record<string, unknown>; harness.writes.push(body);
      if (body.action === "create") { const library: Library = {id:artistOne,version:1,data:createArchiveData(String(body.name)),updated_at:"2026-09-08T00:00:00Z"}; harness.libraries.push(library); await route.fulfill({json:memberArchiveResponse({library})}); return; }
      const index = harness.libraries.findIndex((item) => item.id === body.libraryId); const library = harness.libraries[index];
      if (body.action === "sync") { harness.jobs = library.data.connections.filter((item) => item.provider === body.provider).map((connection, index) => ({id:`sync-${connection.externalArtistId}`,library_id:artistOne,provider:connection.provider,external_artist_id:connection.externalArtistId,status:harness.jobStatus,counts:{releases:index + 1,tracks:(index + 1) * 3},updated_at:"2026-09-08T00:02:00Z"})); await route.fulfill({json:{jobs:harness.jobs,...(!harness.jobsArrayResponse ? {job:harness.jobs[0]} : {})}}); return; }
      if (body.action === "resume") { harness.jobs = [{id:"sync-one",library_id:artistOne,provider:"apple",status:"partial",counts:{releases:23,tracks:126},cursor:{providerCursor:{phase:"artist",offset:25,total:68,pending:["next-release"]}},checked_at:"2026-09-08T00:00:00Z",error_message:"일부 페이지를 처리했습니다. 다음 위치에서 계속 수집할 수 있습니다."}]; await route.fulfill({json:{job:harness.jobs[0]}}); return; }
      if (!library) { await route.fulfill({status:404,json:{error:"라이브러리 없음"}}); return; }
      if (body.version !== library.version) { await route.fulfill({status:409,json:{error:"동시에 변경된 자료입니다."}}); return; }
      if (body.action === "archive" && harness.archiveFailures) { harness.archiveFailures -= 1; await route.fulfill({status:503,json:{error:"삭제하지 못했습니다. 잠시 후 다시 시도해 주세요."}}); return; }
      let data = library.data;
      if (body.action === "command") data = applyArchiveCommand(data,body.command);
      if (body.action === "commands") for (const command of body.commands as ArchiveCommand[]) data = applyArchiveCommand(data,command);
      if (body.action === "refresh-metadata") {
        data = structuredClone(data);
        data.releases[0].imageUrl = "https://is1-ssl.mzstatic.com/image/thumb/test/100x100bb.jpg";
        data.works = [{id:"work-credit",title:"같은 제목",contributors:[{name:"확인된 작곡가",role:"composition"},{name:"확인된 편곡가",role:"arrangement"}],institutionNumbers:[]}];
        data.recordings[0].workIds = ["work-credit"];
      }
      if (body.action === "connect") {
        if (harness.connectFailures > 0) { harness.connectFailures -= 1; await route.fulfill({status:503,json:{error:"일시적으로 연결하지 못했습니다. 다시 시도해 주세요."}}); return; }
        data = applyArchiveCommand(data,{type:"set_connection",connection:{provider:body.provider,url:body.url,externalArtistId:body.externalId,confirmed:true}});
        if (body.provider === "apple") harness.jobs = [{id:`sync-${body.externalId}`,library_id:artistOne,provider:"apple",external_artist_id:String(body.externalId),status:harness.jobStatus,counts:{releases:23,tracks:126},cursor:{providerCursor:{offset:25,total:68,pending:["next"]}},updated_at:"2026-09-08T00:00:00Z",error_code:"PERMISSION_REQUIRED",error_message:"서버 이용 허가 확인 필요"},...harness.jobs.filter((job) => job.external_artist_id !== body.externalId)];
      }
      const next = {...library,data,version:library.version+1,...(body.action === "archive" ? {archived_at:"2026-09-08T00:00:00Z"} : body.action === "restore" ? {archived_at:null} : {})}; harness.libraries[index] = next;
      if (body.action === "archive" && harness.archiveResponseLost) { harness.archiveResponseLost = false; await route.fulfill({status:503,json:{error:"응답을 받지 못했습니다."}}); return; }
      await route.fulfill({json:memberArchiveResponse({library:next,...(body.action === "connect" && body.provider === "apple" && harness.jobs.length ? {...(harness.jobsArrayResponse ? {jobs:[harness.jobs[0]]} : {job:harness.jobs[0]}),runLibraryId:next.id} : {})})}); return;
    }
    if (url.pathname.startsWith("/mypage/music/results/")) { await route.fulfill({contentType:"text/html",body:"<!doctype html><h1>온사이드 심의 결과</h1><p>KBS 적격</p>"}); return; }
    if (url.hostname === "is1-ssl.mzstatic.com") { if (url.pathname.includes("/missing/")) { await route.fulfill({status:404,body:"missing image"}); return; } await route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBl8AAAAASUVORK5CYII=","base64")}); return; }
    if (url.protocol === "https:") { await route.fulfill({contentType:"text/html",body:"<!doctype html><title>공식 링크 모의 페이지</title>"}); return; }
    await route.fulfill({status:404,body:"Unexpected request blocked by the UI test."});
  });
  await page.goto("/mypage/music"); await expect.poll(() => harness.errors).toEqual([]); await expect(page.getByTestId("music-archive")).toBeVisible();
  return harness;
}

function fixture() {
  let data = createArchiveData("테스트 뮤지션");
  for (const command of [
    { type: "add_release", release: { id: "album", title: "발매 후 첫 앨범", type: "album", participation: "primary", releaseDate: "2026-09-01", links: [{provider:"apple",url:"https://music.apple.com/kr/album/123456",externalId:"123456"}] } },
    { type: "save_recording", recording: { id: "recording-a", title: "같은 제목", version: "Original", workIds: [] } },
    { type: "save_recording", recording: { id: "recording-b", title: "같은 제목", version: "Clean", workIds: [] } },
    { type: "add_track", track: { id: "original", releaseId: "album", title: "같은 제목", version: "Original", discNumber: 1, trackNumber: 1, recordingId: "recording-a", managed: true, links: [] } },
    { type: "add_track", track: { id: "clean", releaseId: "album", title: "같은 제목", version: "Clean", discNumber: 1, trackNumber: 2, recordingId: "recording-b", managed: true, links: [] } },
  ]) data = applyArchiveCommand(data, command);
  data.releases[0].source = {provider:"apple",externalId:"private-provider-id",checkedAt:"2026-09-09T00:00:00Z"};
  return { id: artistOne, version: 1, data };
}
async function openAlbum(page: Page) {
  await page.getByRole("button", {name:/테스트 뮤지션/}).click();
  await page.getByRole("button", {name:/발매 후 첫 앨범/}).click();
}
async function tab(page: Page, name: string) {
  const selected = page.getByRole("navigation", { name: "음악 관리 탭" }).getByRole("button", { name, exact: true });
  await selected.click();
  await expect(selected).toHaveAttribute("aria-current", "page");
  await expect(selected).toHaveCSS("border-bottom-color", "rgb(17, 17, 17)");
}
const forbiddenMemberCopy = /메타데이터 출처|업무 기록|업무 이력|변경 이력|이용 허가|아티스트 ID|공식 조회 미확인|사용자 입력|공식 출처 확인일/;

test("artist deletion confirmation uses the full album count and cancelling leaves the library intact", async ({ page }) => {
  const original: Library = { ...fixture(), summary: { releaseCount: 14, trackCount: 55, needsCheck: 0, inProgress: 0, needsChanges: 0, awaitingResult: 0 } };
  const harness = await mount(page, [original]);
  await page.getByRole("article", { name: "테스트 뮤지션", exact: true }).getByRole("button", { name: "아티스트 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "아티스트 삭제", exact: true });
  await expect(dialog).toContainText("테스트 뮤지션");
  await expect(dialog).toContainText("앨범 14개");
  await expect(dialog).toContainText("심의 신청·결과는 삭제되지 않습니다.");
  expect(harness.writes).toEqual([]);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("article", { name: "테스트 뮤지션", exact: true })).toBeVisible();
  expect(harness.libraries).toEqual([original]); expect(harness.writes).toEqual([]); expect(harness.errors).toEqual([]);
});

test("artist deletion hides only the confirmed artist and preserves its music and review records after reload", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const original = fixture();
  original.data = applyArchiveCommand(original.data, { type: "link_review", link: { id: "review-link", submissionId: "30000000-0000-4000-8000-000000000001", releaseId: "album" } });
  const other = fixture(); other.id = "11111111-1111-4111-8111-111111111112"; other.data.artist.name = "남겨둘 아티스트";
  const harness = await mount(page, [original, other]);
  await page.getByRole("article", { name: "테스트 뮤지션", exact: true }).getByRole("button", { name: "아티스트 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "아티스트 삭제", exact: true });
  await page.screenshot({ path: testInfo.outputPath("artist-deletion-mobile.png"), fullPage: true });
  await dialog.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("article", { name: "테스트 뮤지션", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "남겨둘 아티스트", exact: true })).toBeVisible();
  expect(harness.writes).toEqual([{ action: "archive", libraryId: artistOne, version: 1 }]);
  expect(harness.libraries[0].archived_at).toBeTruthy();
  expect(harness.libraries[0].data).toEqual(original.data);
  expect(harness.libraries[1]).toEqual(other);
  await page.reload();
  await expect(page.getByRole("article", { name: "테스트 뮤지션", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "남겨둘 아티스트", exact: true })).toBeVisible();
  expect(harness.errors).toEqual([]);
});

test("artist deletion failure keeps the artist visible and supports an explicit retry", async ({ page }) => {
  const original = fixture(); const harness = await mount(page, [original]); harness.archiveFailures = 1;
  await page.getByRole("button", { name: "아티스트 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "아티스트 삭제", exact: true });
  await dialog.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("삭제하지 못했습니다");
  await expect(page.getByRole("article", { name: "테스트 뮤지션", exact: true })).toBeVisible();
  expect(harness.libraries[0]).toEqual(original);
  await dialog.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("article", { name: "테스트 뮤지션", exact: true })).toHaveCount(0);
  expect(harness.writes.map(item => item.action)).toEqual(["archive", "archive"]); expect(harness.errors).toEqual([]);
});

test("artist deletion refreshes a changed album count and requires confirmation again after a version conflict", async ({ page }) => {
  const harness = await mount(page, [fixture()]);
  await page.getByRole("button", { name: "아티스트 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "아티스트 삭제", exact: true });
  harness.libraries[0].data = applyArchiveCommand(harness.libraries[0].data, { type: "add_release", release: { id: "new-album", title: "동기화된 앨범", links: [] } });
  harness.libraries[0].version = 2;
  await dialog.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("동시에 변경된 자료");
  await expect(dialog).toContainText("앨범 2개");
  expect(harness.libraries[0].archived_at).toBeUndefined(); expect(harness.writes).toHaveLength(1);
  await dialog.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(harness.writes.map(item => item.version)).toEqual([1, 2]);
  expect(harness.libraries[0].data.releases).toHaveLength(2); expect(harness.errors).toEqual([]);
});

test("artist deletion reconciles a saved archive when its response fails without deleting twice", async ({ page }) => {
  const harness = await mount(page, [fixture()]); harness.archiveResponseLost = true;
  await page.getByRole("button", { name: "아티스트 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "아티스트 삭제", exact: true });
  await dialog.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("article", { name: "테스트 뮤지션", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("내 목록에서 삭제했습니다.");
  expect(harness.writes).toHaveLength(1); expect(harness.libraries[0].data.releases).toHaveLength(1); expect(harness.errors).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`member keeps four simple tabs and per-recording registration at ${width}px`, async ({page}, testInfo) => {
    await page.setViewportSize({width,height:900});
    const harness = await mount(page, [fixture()]); await openAlbum(page);
    await expect(page.getByRole("navigation", {name:"음악 관리 탭"}).getByRole("button")).toHaveCount(4);
    await expect(page.locator("body")).not.toContainText(forbiddenMemberCopy);
    const apply = page.getByRole("link", {name:"온사이드에 심의 신청",exact:true});
    await expect(apply).toHaveAttribute("href", new RegExp(`archiveLibrary=${artistOne}.*archiveRelease=album`));
    await tab(page,"노래방");
    await expect(page.getByRole("region", {name:"노래방 정보"})).toContainText("등록 정보 없음");
    await page.getByRole("button", {name:"수록 정보 입력",exact:true}).click();
    await page.getByLabel("음원", {exact:true}).selectOption("original");
    await expect(page.getByLabel("수록 상태", {exact:true})).toHaveCount(0);
    await page.getByLabel("곡번호", {exact:true}).fill("12345");
    await page.getByRole("button", {name:"저장",exact:true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("region", {name:"노래방 정보"})).toContainText("TJ · 수록됨");
    expect(harness.libraries[0].data.tasks).toHaveLength(1); expect(harness.libraries[0].data.tasks[0].trackId).toBe("original");
    await page.getByLabel("관리할 음악", {exact:true}).selectOption("clean");
    await expect(page.getByRole("region", {name:"노래방 정보"})).not.toContainText("12345");
    await expect(page.getByRole("region", {name:"노래방 정보"})).toContainText("등록 정보 없음");
    for (const name of ["저작권 등록", "실연자 등록"]) { await tab(page,name); await expect(page.locator("body")).not.toContainText(forbiddenMemberCopy); }
    await page.getByRole("button", {name:"등록 방법",exact:true}).click();
    await expect(page.getByRole("dialog")).toContainText("실연 정보 등록");
    await expect(page.getByRole("dialog")).not.toContainText(forbiddenMemberCopy);
    await page.getByRole("button", {name:"닫기",exact:true}).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({path:testInfo.outputPath(`simple-member-${width}.png`),fullPage:true});
    expect(harness.errors).toEqual([]); expect(harness.writes.every((item) => item.action === "commands")).toBe(true);
  });
}

test("copyright and performer entries save and edit without exposing audit details",async ({page}) => {
  const harness = await mount(page,[fixture()]); await openAlbum(page);
  await page.getByLabel("관리할 음악",{exact:true}).selectOption("original");
  for (const [name, participantLabel, participant, role] of [["저작권 등록","저작자","작곡자 이름","작곡"],["실연자 등록","실연자","연주자 이름","기타"]]) {
    await tab(page,name);
    await page.getByRole("button",{name:"등록 정보 입력",exact:true}).click();
    await expect(page.getByLabel("등록 상태",{exact:true})).toHaveCount(0);
    await page.getByLabel(`${participantLabel} 1`,{exact:true}).fill(participant);
    if (name === "저작권 등록") await page.getByLabel("역할 1",{exact:true}).selectOption(role);
    else await page.getByLabel("악기 / 역할 1",{exact:true}).fill(role);
    await page.getByLabel("등록번호 (선택)",{exact:true}).fill("TEST-01");
    await page.getByRole("button",{name:"저장",exact:true}).click();
    const region = page.getByRole("region",{name:`${name} 정보`});
    await expect(region).toContainText(participant); await expect(region).toContainText("등록됨");
    await region.getByRole("button",{name:"수정",exact:true}).click();
    await page.getByLabel("등록번호 (선택)",{exact:true}).fill("TEST-02");
    await page.getByRole("button",{name:"저장",exact:true}).click();
    await expect(region).toContainText("TEST-02"); await expect(region).not.toContainText("TEST-01");
  }
  expect(harness.libraries[0].data.tasks).toHaveLength(2);
  await page.reload();
  await expect(page.getByRole("region",{name:"실연자 등록 정보"})).toContainText("연주자 이름");
  await expect(page.locator("body")).not.toContainText(forbiddenMemberCopy); expect(harness.errors).toEqual([]);
});

test("Onside review tab opens the live result popup and respects selected track scope",async ({page}) => {
  const harness=await mount(page,[fixture()]);
  const submissionId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  harness.onsideReviews=[{submissionId,releaseId:"album",trackIds:["original"],status:"COMPLETED"}];
  await openAlbum(page);
  await expect(page.getByRole("region",{name:"심의 정보"})).toContainText("일부 심의 완료");
  await expect(page.getByRole("button",{name:"심의 내역 직접 입력",exact:true})).toHaveCount(0);
  await tab(page,"심의");
  await expect(page.getByRole("dialog",{name:"심의 결과",exact:true})).toBeVisible();
  await expect(page.locator('iframe[title="심의 결과 상세"]')).toHaveAttribute("src",`/mypage/music/results/${submissionId}`);
  await expect(page.frameLocator('iframe[title="심의 결과 상세"]').getByRole("heading",{name:"온사이드 심의 결과"})).toBeVisible();
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await page.getByLabel("관리할 음악",{exact:true}).selectOption("clean");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region",{name:"심의 정보"})).toContainText("심의 정보 없음");
  await expect(page.getByRole("link",{name:"온사이드에 심의 신청",exact:true})).toHaveAttribute("href",/archiveTrack=clean/);
  await page.getByRole("button",{name:"심의 내역 직접 입력",exact:true}).click();
  await page.getByLabel("심의 결과",{exact:true}).selectOption("eligible");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  expect(harness.libraries[0].data.tasks[0].trackId).toBe("clean");
  await expect(page.getByRole("region",{name:"심의 정보"})).toContainText("KBS · 적격");
  expect(harness.errors).toEqual([]);
});

test("artist autocomplete confirms source identity while keeping private job details hidden",async ({page}) => {
  const harness=await mount(page); harness.jobsArrayResponse=true;
  await page.getByRole("button",{name:"아티스트 추가",exact:true}).click();
  const input=page.getByRole("combobox",{name:"아티스트 이름",exact:true}); await input.fill("ㄷㅁ");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2); expect(harness.writes).toHaveLength(0);
  await expect(page.getByRole("dialog")).not.toContainText(forbiddenMemberCopy);
  await input.press("ArrowDown"); await input.press("ArrowDown"); await input.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("서울 인디 밴드");
  await page.getByRole("button",{name:"이 아티스트의 앨범 불러오기",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(harness.libraries[0].data.connections[0].externalArtistId).toBe(candidateTwo);
  await expect(page.getByRole("button",{name:"다시 불러오기",exact:true})).toBeVisible();
  await expect(page.locator("body")).not.toContainText(forbiddenMemberCopy);
  expect(harness.writes.map(item=>item.action)).toEqual(["create","connect"]); expect(harness.errors).toEqual([]);
});

for (const stage of ["albums", "credits"] as const) for (const status of ["partial", "completed"] as const) test(`queued ${stage} import progress follows background ${status} status without a stale banner`, async ({ page }) => {
  const harness = await mount(page); harness.jobStatus = "queued"; harness.jobsArrayResponse = true;
  await page.getByRole("button", { name: "아티스트 추가", exact: true }).click();
  const input = page.getByRole("combobox", { name: "아티스트 이름", exact: true });
  await input.fill("동명 아티스트");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2);
  await input.press("ArrowDown"); await input.press("Enter");
  await page.getByRole("button", { name: "이 아티스트의 앨범 불러오기", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("앨범을 불러오고 있습니다.", { exact: true })).toHaveCount(1);

  if (stage === "credits" || status === "completed") {
    const library = harness.libraries[0];
    library.data = applyArchiveCommand(library.data, { type: "add_release", release: { id: "imported-album", title: "불러온 앨범", links: [] } });
    library.version += 1;
  }
  if (stage === "credits") {
    harness.jobs = harness.jobs.map(job => ({ ...job, status: "running", cursor: { providerCursor: { phase: "credits" } } }));
    await expect(page.getByText("곡별 저작자 정보를 불러오고 있습니다.", { exact: true })).toHaveCount(1);
    await expect(page.getByText("앨범을 불러오고 있습니다.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /불러온 앨범/ })).toBeVisible();
  }
  harness.jobs = harness.jobs.map(job => ({ ...job, status }));
  // The real member client's periodic GET observes the changed worker status.
  await expect(page.getByText(/^(앨범을|곡별 저작자 정보를) 불러오고 있습니다\.$/)).toHaveCount(0, { timeout: 7000 });
  if (status === "partial") {
    await expect(page.getByRole("button", { name: "다시 불러오기", exact: true })).toBeVisible();
    await expect(page.getByText(stage === "credits" ? "앨범은 저장했습니다. 아직 불러오지 못한 저작자 정보가 있습니다." : "아직 불러오지 못한 앨범이 있습니다.", { exact: true })).toBeVisible();
  }
  else {
    await expect(page.getByRole("button", { name: "다시 불러오기", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /불러온 앨범/ })).toBeVisible();
    await expect(page.getByText(/아직 불러오지 못한/)).toHaveCount(0);
  }
  if (stage === "credits") await expect(page.getByRole("button", { name: /불러온 앨범/ })).toBeVisible();
  expect(harness.writes.map(item => item.action)).toEqual(["create", "connect"]);
  expect(harness.errors).toEqual([]);
});

test("manual album and track creation preserves distinct recordings with concise editors",async ({page}) => {
  const harness=await mount(page);
  await page.getByRole("button",{name:"아티스트 추가",exact:true}).click(); await page.getByRole("button",{name:"직접 추가",exact:true}).click();
  await page.getByLabel("아티스트 활동명",{exact:true}).fill("테스트 뮤지션"); await page.getByRole("button",{name:"아티스트 직접 추가",exact:true}).click();
  await page.getByRole("button",{name:"앨범 추가",exact:true}).click(); await page.getByLabel("앨범 제목",{exact:true}).fill("첫 앨범"); await page.getByRole("button",{name:"저장",exact:true}).click();
  await page.getByRole("button",{name:/첫 앨범/}).click();
  for (const version of ["Original","Clean"]) { await page.getByRole("button",{name:"트랙 추가",exact:true}).click(); await page.getByLabel("트랙 제목",{exact:true}).fill("동명곡"); await page.getByLabel("버전",{exact:true}).fill(version); await page.getByRole("button",{name:"저장",exact:true}).click(); await expect(page.getByRole("dialog")).toHaveCount(0); }
  expect(harness.libraries[0].data.recordings).toHaveLength(2); expect(harness.libraries[0].data.tracks).toHaveLength(2);
  await expect(page.getByLabel("관리할 음악",{exact:true})).toContainText("Original"); await expect(page.getByLabel("관리할 음악",{exact:true})).toContainText("Clean");
  expect(harness.errors).toEqual([]);
});

test("album cards share review status including partial and payment pending without declaring unknown unreviewed",async ({page},testInfo) => {
  const initial=fixture();
  const harness=await mount(page,[initial]);
  harness.onsideReviews=[{submissionId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",releaseId:"album",trackIds:["original"],status:"COMPLETED"}];
  await page.getByRole("button",{name:/테스트 뮤지션/}).click();
  await expect(page.getByRole("button",{name:/발매 후 첫 앨범/})).toContainText("일부 심의 완료");
  const badge=page.getByRole("button",{name:/발매 후 첫 앨범/}).locator("[data-status-tone]");
  await expect(badge).toHaveAttribute("data-status-tone","warning");
  const partialColor=await badge.evaluate(element=>getComputedStyle(element).color);
  harness.onsideReviews=[{...harness.onsideReviews[0],trackIds:[],status:"WAITING_PAYMENT"}]; await page.reload();
  await expect(page.getByRole("button",{name:/발매 후 첫 앨범/})).toContainText("접수·결제 진행 중");
  await expect(badge).toHaveAttribute("data-status-tone","progress");
  expect(await badge.evaluate(element=>getComputedStyle(element).color)).not.toBe(partialColor);
  harness.onsideReviews=[{...harness.onsideReviews[0],status:"COMPLETED"}]; await page.reload();
  await expect(badge).toHaveText("심의 완료");
  await expect(badge).toHaveAttribute("data-status-tone","success");
  harness.onsideReviews=[]; await page.reload();
  await expect(page.getByRole("button",{name:/발매 후 첫 앨범/})).toContainText("심의 정보 없음");
  await expect(badge).toHaveAttribute("data-status-tone","neutral");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({path:testInfo.outputPath("simple-albums-dark.png"),fullPage:true,animations:"disabled"});
  expect(harness.errors).toEqual([]);
});

test("review results refresh on focus and periodically after import jobs have finished", async ({ page }) => {
  await page.clock.install();
  const harness = await mount(page, [fixture()]);
  await page.getByRole("button", { name: /테스트 뮤지션/ }).click();
  const card = page.getByRole("button", { name: /발매 후 첫 앨범/ });
  await expect(card).toContainText("심의 정보 없음");
  harness.onsideReviews = [{ submissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", releaseId: "album", trackIds: [], status: "IN_PROGRESS" }];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card).toContainText("심의 진행 중");
  harness.onsideReviews[0].status = "COMPLETED";
  await page.clock.runFor(30001);
  await expect(card).toContainText("심의 완료");
  expect(harness.writes).toEqual([]);
  expect(harness.errors).toEqual([]);
});

for (const width of [320,1280]) test(`artist artwork falls back to a linked album and recovers after metadata refresh at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});
  const initial=fixture();
  initial.data.artist.imageUrl="https://is1-ssl.mzstatic.com/missing/artist.jpg";
  initial.data.releases[0].imageUrl="https://is1-ssl.mzstatic.com/image/thumb/test/album.jpg";
  const harness=await mount(page,[initial]);
  const portrait=page.getByRole("button",{name:/테스트 뮤지션/}).getByRole("img");
  await expect(portrait).toHaveAttribute("src",initial.data.releases[0].imageUrl);
  await page.getByRole("button",{name:/테스트 뮤지션/}).click();
  await expect(page.getByRole("img",{name:"테스트 뮤지션 아티스트 이미지"})).toHaveAttribute("src",initial.data.releases[0].imageUrl);
  harness.libraries[0].data.releases[0].imageUrl="https://is1-ssl.mzstatic.com/missing/album.jpg";
  await page.reload();
  const album=page.getByRole("button",{name:/발매 후 첫 앨범/});
  await expect(album.getByLabel("기본 앨범 이미지")).toBeVisible();
  await album.click();
  await page.getByRole("button",{name:"앨범 정보 다시 가져오기",exact:true}).click();
  await expect(page.getByRole("img",{name:"발매 후 첫 앨범 앨범 커버"})).toHaveAttribute("src","https://is1-ssl.mzstatic.com/image/thumb/test/100x100bb.jpg");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:testInfo.outputPath(`music-artwork-${width}.png`),fullPage:true});
  expect(harness.errors).toEqual([]);
});

test("Apple Music artist links connect using the exact selected identity",async({page})=>{
  const harness=await mount(page);
  await page.getByRole("button",{name:"아티스트 추가",exact:true}).click();
  await page.getByRole("button",{name:"아티스트 링크",exact:true}).click();
  await page.getByLabel("아티스트 링크",{exact:true}).fill(`https://music.apple.com/kr/artist/same-name/${candidateTwo}`);
  await page.getByLabel("관리할 아티스트 이름",{exact:true}).fill("동명 아티스트");
  await page.getByRole("button",{name:"아티스트 링크 추가",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(harness.libraries[0].data.connections[0].externalArtistId).toBe(candidateTwo);
  expect(harness.writes.map(item=>item.action)).toEqual(["create","connect"]);
  expect(harness.errors).toEqual([]);
});


test("manual reviews save selected broadcasters atomically and show ineligibility reasons", async ({page}, testInfo) => {
  await page.setViewportSize({width:390,height:844});
  const harness = await mount(page, [fixture()]); await openAlbum(page);
  await page.getByRole("button", {name:"심의 내역 직접 입력",exact:true}).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("확인번호 (선택)",{exact:true})).toHaveCount(0);
  await expect(dialog.getByLabel("심의 결과",{exact:true}).locator("option")).toHaveText(["적격", "부적격"]);
  await dialog.getByRole("checkbox", {name:/방송사 전체 선택/}).check();
  const stationCount = await dialog.getByRole("checkbox").count() - 1;
  expect(stationCount).toBeGreaterThan(15);
  await dialog.getByLabel("심의 결과",{exact:true}).selectOption("ineligible");
  await dialog.getByLabel("부적격 사유",{exact:true}).fill("특정 상품명 포함");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:testInfo.outputPath("review-broadcasters-mobile.png"),fullPage:true});
  await dialog.getByRole("button", {name:"저장",exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(harness.writes).toHaveLength(1);
  expect(harness.writes[0].action).toBe("commands");
  expect(harness.libraries[0].data.tasks).toHaveLength(stationCount * 2);
  expect(harness.libraries[0].data.tasks.every(task => task.result === "ineligible" && task.status === "completed" && task.memo === "특정 상품명 포함")).toBe(true);
  await expect(page.getByRole("region",{name:"심의 정보"})).toContainText("부적격 사유: 특정 상품명 포함");
  await page.reload();
  await expect(page.getByRole("region",{name:"심의 정보"})).toContainText("KBS · 부적격");
  expect(harness.errors).toEqual([]);
});

test("multiple writers and instrumental performers retain individual roles after reload", async ({page}, testInfo) => {
  const harness = await mount(page, [fixture()]); await openAlbum(page);
  await page.getByLabel("관리할 음악",{exact:true}).selectOption("original");
  await tab(page,"저작권 등록");
  await page.getByRole("button",{name:"등록 정보 입력",exact:true}).click();
  for (const [index, name] of [[1,"작사가"],[2,"작곡가"],[3,"편곡가"]] as const) await page.getByLabel(`저작자 ${index}`,{exact:true}).fill(name);
  await page.getByRole("button",{name:"저작자 추가",exact:true}).click();
  await page.getByLabel("저작자 4",{exact:true}).fill("공동 작곡가");
  await page.screenshot({path:testInfo.outputPath("multiple-writers.png"),fullPage:true});
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(harness.libraries[0].data.tasks.map(task => [task.participant, task.role])).toEqual([["작사가","작사"],["작곡가","작곡"],["편곡가","편곡"],["공동 작곡가","작곡"]]);
  await tab(page,"실연자 등록");
  await page.getByRole("button",{name:"등록 정보 입력",exact:true}).click();
  await page.getByLabel("실연자 1",{exact:true}).fill("기타 연주자");
  await page.getByLabel("악기 / 역할 1",{exact:true}).fill("기타");
  await page.getByRole("button",{name:"실연자 추가",exact:true}).click();
  await page.getByLabel("실연자 2",{exact:true}).fill("드럼 연주자");
  await page.getByLabel("악기 / 역할 2",{exact:true}).fill("드럼");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(harness.libraries[0].data.tasks).toHaveLength(6);
  expect(harness.libraries[0].data.tasks.every(task => task.trackId === "original" && task.status === "completed" && task.result === "approved")).toBe(true);
  await page.reload();
  await expect(page.getByRole("region",{name:"실연자 등록 정보"})).toContainText("드럼 연주자 · 드럼");
  expect(harness.errors).toEqual([]);
});


test("refresh applies album artwork and pre-fills confirmed writers for the correct recording", async ({page}) => {
  const harness = await mount(page, [fixture()]); await openAlbum(page);
  await tab(page,"저작권 등록");
  await page.getByRole("button",{name:"저작자 정보 다시 가져오기",exact:true}).click();
  await expect(page.getByRole("img",{name:"발매 후 첫 앨범 앨범 커버",exact:true})).toHaveAttribute("src",/mzstatic/);
  await expect(page.getByRole("region",{name:"저작권 등록 정보"})).toContainText("확인된 작곡가");
  expect(harness.writes[0]).toMatchObject({action:"refresh-metadata",libraryId:artistOne,releaseId:"album",version:1});
  await page.getByRole("button",{name:"등록 정보 입력",exact:true}).click();
  await page.getByLabel("음원",{exact:true}).selectOption("original");
  await expect(page.getByLabel("저작자 1",{exact:true})).toHaveValue("확인된 작곡가");
  await expect(page.getByLabel("역할 1",{exact:true})).toHaveValue("작곡");
  await page.getByLabel("음원",{exact:true}).selectOption("clean");
  await expect(page.getByLabel("저작자 1",{exact:true})).toHaveValue("");
  await page.getByRole("button",{name:"취소",exact:true}).click();
  await page.reload();
  await expect(page.getByRole("img",{name:"발매 후 첫 앨범 앨범 커버",exact:true})).toBeVisible();
  expect(harness.errors).toEqual([]);
});

test("imported credits shared across works save each writer role once", async ({page}) => {
  const initial = fixture();
  initial.data.works = [
    { id: "work-first", title: "첫 작품", contributors: [{ name: "공동 저작자", role: "lyrics" }, { name: "공동 저작자", role: "composition" }], institutionNumbers: [] },
    { id: "work-second", title: "두 번째 작품", contributors: [{ name: "공동 저작자", role: "composition" }, { name: "편곡 참여자", role: "arrangement" }], institutionNumbers: [] },
  ];
  initial.data.recordings[0].workIds = initial.data.works.map(work => work.id);
  const harness = await mount(page, [initial]); await openAlbum(page);
  await page.getByLabel("관리할 음악", {exact:true}).selectOption("original");
  await tab(page, "저작권 등록");
  await page.getByRole("button", {name:"등록 정보 입력",exact:true}).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/^저작자 \d+$/, {exact:true})).toHaveCount(3);
  await dialog.getByRole("button", {name:"저장",exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(harness.libraries[0].data.tasks.map(task => [task.participant, task.role])).toEqual([
    ["공동 저작자", "작사"], ["공동 저작자", "작곡"], ["편곡 참여자", "편곡"],
  ]);
  expect(harness.errors).toEqual([]);
});

test("linked work credits display once per role within the exact track recording", async ({page}) => {
  const initial = fixture();
  initial.data.works = [
    { id: "work-first", title: "같은 제목", contributors: [{ name: "겹친 저작자", role: "lyrics" }, { name: "겹친 저작자", role: "composition" }], institutionNumbers: [{ agency: "KOMCA", number: "REG-1" }] },
    { id: "work-second", title: "같은 제목", contributors: [{ name: "겹친 저작자", role: "composition" }, { name: "공동작곡자", role: "composition" }, { name: "편곡 참여자", role: "arrangement" }], institutionNumbers: [{ agency: "KOMCA", number: "REG-1" }, { agency: "KOSCAP", number: "REG-2" }] },
    { id: "work-legacy", title: "같은 제목", writers: "역할 미분류 저작자 원문", institutionNumbers: [] },
    { id: "work-clean", title: "같은 제목", contributors: [{ name: "다른 버전 저작자", role: "composition" }], institutionNumbers: [] },
  ];
  initial.data.recordings[0].workIds = ["work-first", "work-second", "work-legacy"];
  initial.data.recordings[1].workIds = ["work-clean"];
  const harness = await mount(page, [initial]); await openAlbum(page); await tab(page, "저작권 등록");
  const original = page.getByRole("article", { name: "같은 제목 (Original) 저작자 정보", exact: true });
  const clean = page.getByRole("article", { name: "같은 제목 (Clean) 저작자 정보", exact: true });
  await expect(original).toBeVisible();
  expect((await original.textContent())?.match(/겹친 저작자/g)).toHaveLength(2);
  await expect(original).toContainText("공동작곡자");
  await expect(original).toContainText("편곡 참여자");
  await expect(original).toContainText("역할 미분류 저작자 원문");
  await expect(original.getByText("KOMCA · REG-1", { exact: true })).toHaveCount(1);
  await expect(original.getByText("KOSCAP · REG-2", { exact: true })).toHaveCount(1);
  await expect(original).not.toContainText("다른 버전 저작자");
  await expect(clean).toContainText("다른 버전 저작자");
  await expect(clean).not.toContainText("겹친 저작자");
  await page.getByLabel("관리할 음악", { exact: true }).selectOption("clean");
  await expect(original).toHaveCount(0);
  await expect(clean).toBeVisible();
  expect(harness.errors).toEqual([]);
});

test("album editing connects a domestic album URL while preserving its imported identity", async ({page}) => {
  const harness = await mount(page, [fixture()]); await openAlbum(page);
  await page.getByRole("button",{name:"수정",exact:true}).click();
  await page.getByLabel("음원 사이트 앨범 URL (선택)",{exact:true}).fill("https://www.genie.co.kr/detail/albumInfo?axnm=12345678");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(harness.libraries[0].data.releases[0].links.map(link => link.provider)).toEqual(["apple", "genie"]);
  expect(harness.libraries[0].data.releases[0].source?.externalId).toBe("private-provider-id");
  await page.getByRole("button",{name:"수정",exact:true}).click();
  await expect(page.getByLabel("음원 사이트 앨범 URL (선택)",{exact:true})).toHaveValue("https://www.genie.co.kr/detail/albumInfo?axnm=12345678");
  await page.getByLabel("음원 사이트 앨범 URL (선택)",{exact:true}).fill("https://www.melon.com/album/detail.htm?albumId=23456789");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(harness.libraries[0].data.releases[0].links.map(link => link.provider)).toEqual(["apple", "melon"]);
  await page.getByRole("button",{name:"수정",exact:true}).click();
  await expect(page.getByLabel("음원 사이트 앨범 URL (선택)",{exact:true})).toHaveValue("https://www.melon.com/album/detail.htm?albumId=23456789");
  expect(harness.errors).toEqual([]);
});


test("artist name automatically searches catalogs without asking members to select a service", async ({page}) => {
  const harness = await mount(page);
  await page.getByRole("button", {name:"아티스트 추가", exact:true}).click();
  await expect(page.getByLabel("검색할 음악 서비스")).toHaveCount(0);
  await page.getByRole("combobox", {name:"아티스트 이름", exact:true}).fill("이름 검색");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2);
  expect(new URL(harness.searches.at(-1)!).searchParams.has("provider")).toBe(false);
  await page.getByText("검색 서비스 안내 · 공식 사이트에서 찾기", {exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("YouTube 채널 검색은 서버 API 연결이 필요합니다.");
  await expect(page.getByRole("button", {name:"아티스트 검색", exact:true})).toBeEnabled();
  await expect(page.getByRole("link", {name:"YouTube에서 검색 ↗"})).toHaveAttribute("href", /youtube\.com\/results\?search_query=/);
  await expect(page.getByRole("link", {name:"Spotify에서 검색 ↗"})).toHaveAttribute("href", /open\.spotify\.com\/search\//);
  expect(harness.writes).toHaveLength(0);
});

for (const width of [360, 1280]) test(`multi-service results preserve selected identity and partial search at ${width}px`, async ({page}, testInfo) => {
  await page.setViewportSize({width,height:900});
  const harness = await mount(page);
  harness.searchResponse = { items: [
    {provider:"melon",externalId:"882441",name:"빈티지코드",sortName:"빈티지코드",disambiguation:"인디 밴드",country:"KR",type:"Group",url:"https://www.melon.com/artist/timeline.htm?artistId=882441",imageUrl:null,representativeRelease:null},
    {provider:"genie",externalId:"90001",name:"빈티지코드",sortName:"빈티지코드",disambiguation:"인디 밴드",country:"KR",type:"Group",url:"https://www.genie.co.kr/detail/artistInfo?xxnm=90001",imageUrl:null,representativeRelease:null},
  ], total:2,nextOffset:null,queryStatus:"partial",message:"Apple Music 검색이 지연되어 확인된 결과를 먼저 표시합니다." };
  await page.getByRole("button", {name:"아티스트 추가", exact:true}).click();
  await page.getByRole("combobox", {name:"아티스트 이름", exact:true}).fill("빈티지코드");
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("dialog")).toContainText("확인된 결과를 먼저 표시합니다.");
  await expect(page.getByRole("option").first()).toContainText("멜론");
  await expect(page.getByRole("option").last()).toContainText("지니뮤직");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:testInfo.outputPath(`automatic-artist-search-${width}.png`),fullPage:true});
  await page.getByRole("option").first().click();
  await expect(page.getByRole("dialog")).toContainText("멜론에서 확인한 아티스트");
  await page.getByRole("button", {name:"이 아티스트의 앨범 불러오기", exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(harness.libraries[0].data.connections.map(item => [item.provider,item.externalArtistId])).toEqual([["melon","882441"]]);
  expect(harness.errors).toEqual([]);
});

test("automatic search respects Korean composition and discards an obsolete response", async ({page}) => {
  const harness = await mount(page);
  await page.getByRole("button", {name:"아티스트 추가", exact:true}).click();
  const input = page.getByRole("combobox", {name:"아티스트 이름", exact:true});
  await input.dispatchEvent("compositionstart");
  await input.fill("비");
  await page.waitForTimeout(750);
  expect(harness.searches).toHaveLength(0);
  harness.searchDelay = 1000;
  await input.dispatchEvent("compositionend");
  await expect.poll(() => harness.searches.length).toBe(1);
  await input.fill("");
  await page.waitForTimeout(1100);
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("검색 결과가 없습니다.", {exact:false})).toHaveCount(0);
  expect(harness.writes).toHaveLength(0);
  expect(harness.errors).toEqual([]);
});

test("more automatic results retain the search snapshot and reset it for a new name", async ({page}) => {
  const harness = await mount(page);
  const item = (id: string) => ({provider:"melon",externalId:id,name:"이름 검색",sortName:"이름 검색",disambiguation:"",country:"",type:"",url:`https://www.melon.com/artist/timeline.htm?artistId=${id}`,imageUrl:null,representativeRelease:null});
  harness.searchResponse = {items:[item("101")],nextOffset:20,searchId:"snapshot-one",queryStatus:"success"};
  await page.getByRole("button", {name:"아티스트 추가", exact:true}).click();
  const input = page.getByRole("combobox", {name:"아티스트 이름", exact:true});
  await input.fill("이름 검색");
  await expect(page.getByRole("option")).toHaveCount(1);
  harness.searchResponse = {items:[item("101"),item("102")],nextOffset:null,searchId:"snapshot-one",queryStatus:"success"};
  await page.getByRole("button", {name:"검색 결과 더 보기", exact:true}).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  const more = new URL(harness.searches.at(-1)!);
  expect(more.searchParams.get("searchId")).toBe("snapshot-one");
  expect(more.searchParams.get("offset")).toBe("20");
  await input.fill("새 이름");
  await expect.poll(() => new URL(harness.searches.at(-1)!).searchParams.get("q")).toBe("새 이름");
  expect(new URL(harness.searches.at(-1)!).searchParams.has("searchId")).toBe(false);
  expect(harness.writes).toHaveLength(0);
});

test("partial empty search does not claim every service had no matching artist", async ({page}) => {
  const harness = await mount(page);
  harness.searchResponse = {items:[],nextOffset:null,queryStatus:"no_results",message:"멜론·지니 검색이 지연되어 확인한 서비스의 결과를 먼저 표시합니다."};
  await page.getByRole("button", {name:"아티스트 추가", exact:true}).click();
  await page.getByRole("combobox", {name:"아티스트 이름", exact:true}).fill("활동명");
  await expect(page.getByRole("dialog")).toContainText("조회가 완료된 음악 서비스에서 결과를 찾지 못했습니다.");
  await expect(page.getByRole("dialog")).toContainText("멜론·지니 검색이 지연");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByRole("button", {name:"아티스트 검색", exact:true})).toBeEnabled();
  expect(harness.writes).toHaveLength(0);
});

test("partial album review keeps a request link only for the uncovered track", async ({page}) => {
  const harness = await mount(page, [fixture()]);
  harness.onsideReviews = [{submissionId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", releaseId:"album", trackIds:["original"], status:"COMPLETED"}];
  await openAlbum(page);
  await expect(page.getByRole("link", {name:"이 곡 심의 신청", exact:true})).toHaveCount(1);
  await expect(page.getByRole("link", {name:"이 곡 심의 신청", exact:true})).toHaveAttribute("href", /archiveTrack=clean/);
  await page.getByText("다른 방송사 심의가 필요한가요?", {exact:true}).click();
  await expect(page.getByRole("link", {name:"다른 방송사 심의 신청", exact:true})).toHaveAttribute("href", /archiveTrack=original/);
  await expect(page.getByRole("link", {name:"심의 결과와 방송사별 처리 내역"})).toHaveAttribute("href", /dashboard\/submissions\/aaaaaaaa-/);
});
