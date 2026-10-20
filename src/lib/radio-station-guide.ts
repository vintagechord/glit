import { resolveRadioBoardLinks } from "@/lib/radio-board-links";

export type RadioGuideText = { ko: string; en: string };
export type RadioProgramGuide = {
  name: string;
  description: RadioGuideText;
  url: string;
  messageUrl: string;
  playlistUrl: string;
};

export type RadioStationGuide = {
  name: string;
  directoryUrl: string;
  language: "ko" | "en";
  introduction: RadioGuideText;
  route: RadioGuideText;
  followUp: RadioGuideText;
  programs: RadioProgramGuide[];
  participationLink?: { name: string; url: string; description: RadioGuideText };
  verifiedAt: string;
};

const arirangPrograms: RadioProgramGuide[] = [
  {
    name: "K-POPPIN’",
    description: {
      ko: "K-pop과 아티스트, K-content를 소개하는 프로그램. 곡의 분위기와 함께 듣고 싶은 이유를 짧게 담아보세요.",
      en: "A program featuring K-pop, artists and K-content. Add a short note about the song and why you want to hear it.",
    },
    url: "https://www.arirang.com/radio/125",
    messageUrl: "https://www.arirang.com/radio/125/board/674",
    playlistUrl: "https://www.arirang.com/radio/125/tracklist/671",
  },
  {
    name: "Radio’n Us",
    description: {
      ko: "다양한 장르의 K-pop과 K-culture, 일상 이야기를 나누는 프로그램. 곡과 연결되는 자신의 이야기를 담아보세요.",
      en: "A program sharing K-pop across genres, K-culture and everyday stories. Try sharing a personal story connected to your song.",
    },
    url: "https://www.arirang.com/radio/127",
    messageUrl: "https://www.arirang.com/radio/127/board/771",
    playlistUrl: "https://www.arirang.com/radio/127/tracklist/770",
  },
];

// Program, request-board and playlist links verified on the official MBC site.
const mbcPrograms: RadioProgramGuide[] = [
  {
    name: "김이나의 별이 빛나는 밤에",
    description: {
      ko: "‘사연과 신청곡’에서 음악과 이야기를 나눕니다. 최근 선곡표를 보고 내 곡과 연결되는 사연을 준비해보세요.",
      en: "A listener-story and song-request program. Check the recent playlist and prepare a story connected to your music.",
    },
    url: "https://m.imbc.com/radio/1000672100000100000",
    messageUrl: "https://m.imbc.com/imbbs/imbbslist/1000672100000100000?bid=pstarnight212&menu=mn-basic&pos=radio",
    playlistUrl: "https://m.imbc.com/Radio/Music/1000672100000100000?objid=RASFM210",
  },
];

const participationLinks: Record<string, NonNullable<RadioStationGuide["participationLink"]>> = {
  "https://radio.kbs.co.kr/": {
    name: "KBS 콩",
    url: "https://radio.kbs.co.kr/kong.html",
    description: { ko: "콩의 채팅으로 실시간 사연을 보내거나 즐겨찾기에서 프로그램 게시판을 찾을 수 있습니다. 콩 참여는 무료이며, 선곡표에서 현재·지난 곡을 확인할 수 있습니다.", en: "Use KONG chat for live stories or find program boards through favorites. KONG participation is free, and playlists show current and previous tracks." },
  },
  "https://m.imbc.com/RadioMain": {
    name: "MBC mini",
    url: "https://miniwebapp.imbc.com/",
    description: { ko: "방송 중에는 mini 메시지로 DJ와 소통할 수 있습니다. 메시지 입력은 로그인이 필요하며, 프로그램과 채널을 먼저 확인하세요.", en: "During the show, you can join through mini messages. Sign-in is required to send a message; check the program and channel first." },
  },
  "https://radio.sbs.co.kr/": {
    name: "SBS 고릴라",
    url: "https://www.sbs.co.kr/m/radio/gorealra.html",
    description: { ko: "고릴라의 공감로그로 무료 참여하고 선곡표를 확인할 수 있습니다. 링크에서 공식 이용 방법을 확인하세요.", en: "Gorealra offers free listener participation through its message log and provides playlists. See the official usage guide." },
  },
  "https://www.cbs.co.kr/radio": {
    name: "CBS 레인보우",
    url: "https://www.cbs.co.kr/event/view/cbsApp",
    description: { ko: "레인보우에서 실시간 댓글, 사연·음악 신청과 선곡 서비스를 이용할 수 있습니다. 채널과 프로그램의 참여 안내를 확인하세요.", en: "Rainbow supports live comments, stories, music requests and playlist information. Check the channel and program’s participation instructions." },
  },
};

export function getRadioStationGuide(input: {
  stationCode?: string | null;
  stationName?: string | null;
}): RadioStationGuide | null {
  const [directory] = resolveRadioBoardLinks(input);
  if (!directory) return null;
  const name = directory.name.replace(/ 프로그램 · 게시판 찾기$/, "");
  if (directory.url === "https://www.arirang.com/radio") {
    return {
      name,
      directoryUrl: directory.url,
      language: "en",
      introduction: {
        ko: "영어로 소통하는 Arirang Radio에서는 영문 곡명·아티스트명과 짧은 신청 이유를 준비하면 좋습니다. 먼저 최근 선곡표를 보고 내 곡과 어울리는 프로그램을 골라보세요.",
        en: "For English-language Arirang Radio, prepare the artist and track names plus a short reason for your request. Check recent tracklists to find a program that fits your music.",
      },
      route: {
        ko: "프로그램의 Send Message에서 로그인하고 게시판 공지를 확인한 뒤 직접 등록하세요. 아래 링크는 공식 메시지 게시판이며, 온사이드가 대신 전송하지 않습니다.",
        en: "Open the program’s Send Message board, sign in, check its posting rules, then submit your message there. Onside does not send it for you.",
      },
      followUp: {
        ko: "등록한 글을 확인하고 해당 프로그램의 Tracklist에서 방송 날짜별 선곡을 찾아보세요. 게시글 답변과 실제 방송 여부는 별개입니다.",
        en: "Check your post, then look up the broadcast date in the program’s Tracklist. A reply to your post is separate from airplay.",
      },
      programs: arirangPrograms,
      verifiedAt: "2026-10-17",
    };
  }
  return {
    name,
    directoryUrl: directory.url,
    language: "ko",
    introduction: {
      ko: "프로그램 소개와 최근 선곡을 먼저 살펴보세요. 내 곡의 장르·분위기와 연결되는 프로그램에, 함께 듣고 싶은 이유를 담아 신청하는 것을 권합니다.",
      en: "Read the program introduction and recent playlists first. Choose a program that fits your song’s genre and mood, and explain why you want to hear it.",
    },
    route: {
      ko: "공식 프로그램 목록 → 프로그램 홈 → ‘사연과 신청곡’ 또는 청취자 참여 메뉴 순서로 이동하세요. 프로그램별 공지에서 로그인·글쓰기 조건을 확인하세요.",
      en: "Open the official program directory, choose a program, then find its song-request or listener participation menu. Check its notices for sign-in and posting requirements.",
    },
    followUp: {
      ko: "등록 후에는 자신의 게시글과 프로그램의 선곡표를 확인하세요. 선곡표 공개 여부와 반영 시점은 프로그램마다 다릅니다.",
      en: "After posting, check your message and the program’s playlist. Playlist availability and update times vary by program.",
    },
    programs: directory.url === "https://m.imbc.com/RadioMain" ? mbcPrograms : [],
    participationLink: participationLinks[directory.url],
    verifiedAt: directory.url === "https://m.imbc.com/RadioMain" ? "2026-10-20" : participationLinks[directory.url] ? "2026-10-17" : "2026-10-16",
  };
}
