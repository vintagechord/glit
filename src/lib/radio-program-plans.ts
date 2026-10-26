import type { RadioGuideText, RadioProgramGuide } from "@/lib/radio-station-guide";

export type RadioParticipationRoute = {
  name: RadioGuideText;
  kind: "request" | "story";
  when: RadioGuideText;
  instructions: RadioGuideText;
  songPolicy: RadioGuideText;
  url: string;
  sourceUrl: string;
};

export type RadioProgramPlan = {
  channel: string;
  schedule?: { start: string; end: string; days: RadioGuideText; sourceUrl: string };
  verifiedAt: string;
  fit: RadioGuideText;
  routes: RadioParticipationRoute[];
};

const mbcHome = "https://m.imbc.com/radio/1000672100000100000";
const mbcBoard = (bid: string, menu: string) => `https://m.imbc.com/imbbs/imbbslist/1000672100000100000?bid=${bid}&menu=${menu}&pos=radio`;
const sbsHome = "https://programs.sbs.co.kr/radio/dindinmusichigh";
const cbsMorning = "https://www.cbs.co.kr/program/home/cbs_P000218";
const cbsNoon = "https://www.cbs.co.kr/program/home/cbs_P000004";
const kbsAlbum = "https://program.kbs.co.kr/2fm/radio/album";
const daily = { ko: "매일", en: "Daily" };
const noPromise = {
  ko: "사연과 함께 곡을 신청할 수 있습니다. 사연 소개와 곡 선곡은 각각 제작진이 결정합니다.",
  en: "You can request a song with your story. Reading the story and playing the song are separate editorial decisions.",
};

// Facts below are paraphrased from the linked official program pages, checked
// 2026-10-27. These are reference schedules, never a live/on-air assertion.
const plans: Record<string, RadioProgramPlan> = {
  [kbsAlbum]: {
    channel: "KBS CoolFM",
    schedule: { start: "09:00", end: "11:00", days: daily, sourceUrl: kbsAlbum },
    verifiedAt: "2026-10-27",
    fit: { ko: "아침의 일상에 어울리는 곡을 제안해보세요. 가요와 팝이 함께 담긴 최근 선곡에서 내 곡과 연결할 분위기를 찾아보세요.", en: "Suggest a song that fits an everyday morning. Look for a connection in recent playlists mixing Korean and international music." },
    routes: [{ name: { ko: "청취자 게시판", en: "Listener board" }, kind: "request", when: daily,
      instructions: { ko: "‘청취자 참여 → 청취자 게시판’에서 로그인 후 곡명·아티스트와 사연을 등록하세요. 별도 고민 코너와 구분하고, ‘선곡표&당첨자’에서 방송일의 곡을 확인하세요.", en: "Open Listener Participation → Listener Board, sign in, and post the artist, title and story. Keep it separate from advice segments and check Playlist & Winners afterward." },
      songPolicy: noPromise,
      url: `${kbsAlbum}/pc/board.html?smenu=322d71&bbs_loc=R2007-0069-03-848149,list,none,1,0`, sourceUrl: kbsAlbum }],
  },
  [mbcHome]: {
    channel: "MBC FM4U",
    schedule: { start: "20:00", end: "22:00", days: daily, sourceUrl: mbcHome },
    verifiedAt: "2026-10-27",
    fit: { ko: "하루의 경험과 곡의 가사를 연결해 소개하기 좋은 경로입니다. 최근 선곡과 내 곡의 분위기가 맞는지 먼저 들어보세요.", en: "Connect an experience from your day with the song’s lyrics. Listen to recent selections to assess the fit." },
    routes: [
      { name: { ko: "사연과 신청곡", en: "Stories and song requests" }, kind: "request", when: daily,
        instructions: { ko: "겪은 일 한 가지와 그 순간 이 곡이 떠오른 이유를 적고, 정확한 곡명과 아티스트명을 덧붙이세요.", en: "Describe one real moment and why it brought this song to mind, then add the exact title and artist." },
        songPolicy: noPromise, url: mbcBoard("pstarnight212", "mn-basic"), sourceUrl: mbcHome },
      { name: { ko: "노래에 기대는 밤", en: "A night leaning on music" }, kind: "story", when: { ko: "토요일 코너", en: "Saturday segment" },
        instructions: { ko: "위로가 필요한 일이나 기쁜 경험을 사연으로 보내는 코너입니다. 원하는 곡을 직접 신청하려면 위 ‘사연과 신청곡’을 이용하세요.", en: "Send an experience that calls for comfort or celebration. Use the general request board above when you want to request a particular song." },
        songPolicy: { ko: "제작진이 사연에 어울리는 음악을 추천하는 형식입니다. 사연이 채택되어도 내 곡이 함께 나오는 것은 아닙니다.", en: "The program recommends music for the story. A selected story does not mean your own song will play." },
        url: mbcBoard("pstarnight224", "mn-week"), sourceUrl: mbcBoard("pstarnight224", "mn-week") },
    ],
  },
  [sbsHome]: {
    channel: "SBS 파워FM",
    schedule: { start: "23:00", end: "01:00", days: daily, sourceUrl: `${sbsHome}/main` },
    verifiedAt: "2026-10-27",
    fit: { ko: "늦은 밤의 일상과 듣고 싶은 이유를 짧게 연결해보세요. 상담 코너보다 직접 곡 신청을 받는 게시판이 내 곡을 제안하기에 명확합니다.", en: "Connect a late-night experience with your reason for listening. The song-request board is the clearest route for proposing a particular track." },
    routes: [{ name: { ko: "사연과 신청곡", en: "Stories and song requests" }, kind: "request", when: daily,
      instructions: { ko: "매일코너의 신청 게시판에 곡명·아티스트와 사연을 등록하세요. 방송 중에는 고릴라의 현재 프로그램을 확인하고 참여할 수 있습니다.", en: "Use the daily request board with the artist, title and your story. For live participation, check the current program in Gorealra." },
      songPolicy: noPromise, url: `${sbsHome}/boards/66355`, sourceUrl: `${sbsHome}/main` }],
  },
  [cbsMorning]: {
    channel: "CBS 음악FM",
    schedule: { start: "07:00", end: "09:00", days: daily, sourceUrl: cbsMorning },
    verifiedAt: "2026-10-27",
    fit: { ko: "아침에 듣고 싶은 가요·팝을 제안할 수 있습니다. 주제 선곡 코너는 내 곡과 주제의 연결 이유가 분명할 때 활용하세요.", en: "Suggest Korean or international pop for the morning. Use themed segments when you can explain a clear connection to your song." },
    routes: [
      { name: { ko: "사연과 신청곡", en: "Stories and song requests" }, kind: "request", when: daily,
        instructions: { ko: "아침 일상과 함께 듣고 싶은 곡을 적으세요. 이 게시판의 글은 작성자 본인과 관리자에게만 보입니다.", en: "Write about your morning and the song you want to hear. Posts are visible only to the author and administrators." },
        songPolicy: noPromise, url: "https://www.cbs.co.kr/board/list/cbs_P000218_request", sourceUrl: "https://www.cbs.co.kr/board/list/cbs_P000218_request" },
      { name: { ko: "주디와 음악 코디", en: "Music pairing with Judy" }, kind: "request", when: { ko: "월~금 코너", en: "Monday–Friday segment" },
        instructions: { ko: "DJ가 고른 오늘의 노래를 먼저 듣고, 그 곡에 어울리는 내 곡과 연결 이유를 제안하세요. 당일 방송에서 안내하는 참여 경로를 확인하세요.", en: "Listen to the DJ’s chosen song, then suggest yours as a pairing and explain the connection. Follow that day’s participation instructions." },
        songPolicy: noPromise, url: cbsMorning, sourceUrl: cbsMorning },
      { name: { ko: "불금이라 설렘", en: "Friday excitement" }, kind: "request", when: { ko: "금요일 코너", en: "Friday segment" },
        instructions: { ko: "설레게 하는 가요·팝 세 곡과 각 곡의 이야기를 준비하세요. 내 곡을 포함하더라도 코너의 세 곡 구성과 주제에 맞춰 보내세요.", en: "Prepare three Korean or international pop songs and a story for each. If yours is included, keep the three-song format and the segment’s theme." },
        songPolicy: noPromise, url: cbsMorning, sourceUrl: cbsMorning },
    ],
  },
  [cbsNoon]: {
    channel: "CBS 음악FM",
    schedule: { start: "12:00", end: "14:00", days: daily, sourceUrl: cbsNoon },
    verifiedAt: "2026-10-27",
    fit: { ko: "일상에서 힘이 된 경험과 노래를 연결해보세요. 점심시간 청취자에게 전하고 싶은 한 장면을 중심으로 작성하면 좋습니다.", en: "Connect the song with an everyday experience that gave you strength. Focus on one moment to share with lunchtime listeners." },
    routes: [{ name: { ko: "사연과 신청곡", en: "Stories and song requests" }, kind: "request", when: daily,
      instructions: { ko: "프로그램의 사연과 신청곡 게시판에서 일상 이야기와 신청곡을 함께 등록하세요. 최근 공지에서 특집 주제가 있는지도 확인하세요.", en: "Post your everyday story and song on the request board. Check announcements for any special theme." },
      songPolicy: noPromise, url: "https://www.cbs.co.kr/board/list/cbs_P000004_request", sourceUrl: cbsNoon }],
  },
};

export function getRadioProgramPlan(program: RadioProgramGuide | undefined): RadioProgramPlan | null {
  return program ? plans[program.url] ?? null : null;
}

export type RadioTimeFilter = "all" | "morning" | "daytime" | "evening";
export type RadioRouteFilter = "all" | "request" | "story";

export function filterRadioPrograms(programs: RadioProgramGuide[], options: { query: string; time: RadioTimeFilter; route: RadioRouteFilter }) {
  const query = options.query.trim().toLocaleLowerCase();
  return programs.filter(program => {
    const plan = getRadioProgramPlan(program);
    const haystack = [program.name, program.description.ko, program.description.en, plan?.channel,
      ...(plan?.routes.flatMap(route => [route.name.ko, route.name.en, route.when.ko, route.when.en]) ?? [])].join(" ").toLocaleLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (options.route !== "all" && !plan?.routes.some(route => route.kind === options.route)) return false;
    if (options.time === "all") return true;
    if (!plan?.schedule) return false;
    const hour = Number(plan.schedule.start.split(":")[0]);
    return options.time === "morning" ? hour >= 5 && hour < 12
      : options.time === "daytime" ? hour >= 12 && hour < 18
        : hour >= 18 || hour < 5;
  });
}

export function formatRadioSchedule(plan: RadioProgramPlan | null, isEnglish = false) {
  if (!plan?.schedule) return isEnglish ? "Check the current time on the official program page" : "방송시간은 공식 프로그램에서 확인";
  const { start, end, days } = plan.schedule;
  const overnight = end <= start ? (isEnglish ? "next day " : "다음 날 ") : "";
  return `${days[isEnglish ? "en" : "ko"]} ${start}–${overnight}${end} · KST`;
}

/** Date-only fields must be real calendar dates, not Date.parse's rollover. */
export function isRadioCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
