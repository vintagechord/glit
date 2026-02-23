export type RadioBoardLink = {
  name: string;
  url: string;
};

type RadioBoardLinkGroup = {
  keys: string[];
  links: RadioBoardLink[];
};

const buildGoogleSearchUrl = (query: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(query)}`;

const normalizeToken = (value?: string | null) =>
  (value ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "");

const dedupeLinks = (links: RadioBoardLink[]) => {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.name}::${link.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const stationRadioBoardLinks: RadioBoardLinkGroup[] = [
  {
    keys: ["KBS", "KBS1FM", "KBS2FM"],
    links: [
      { name: "KBS 라디오 메인", url: "https://radio.kbs.co.kr/index.html" },
      { name: "KBS 라디오 프로그램", url: "https://radio.kbs.co.kr/program.html" },
      { name: "KBS 프로그램 목록", url: "https://www.kbs.co.kr/programlist/" },
    ],
  },
  {
    keys: ["MBC", "MBCFM4U", "MBC표준FM"],
    links: [
      { name: "MBC 라디오 메인", url: "https://m.imbc.com/radio" },
      { name: "MBC 라디오 메뉴", url: "https://m.imbc.com/wiz/radio/" },
      { name: "MBC mini", url: "https://mini.imbc.com/" },
    ],
  },
  {
    keys: ["SBS", "SBS파워FM", "SBS러브FM"],
    links: [
      { name: "SBS 라디오 메인", url: "https://www.sbs.co.kr/radio" },
      { name: "SBS 파워FM", url: "https://programs.sbs.co.kr/powerfm" },
      { name: "SBS 러브FM", url: "https://programs.sbs.co.kr/lovefm" },
    ],
  },
  {
    keys: ["CBS"],
    links: [
      { name: "CBS 라디오 메인", url: "https://www.cbs.co.kr/radio" },
      {
        name: "CBS 표준FM 프로그램/게시판",
        url: "https://www.cbs.co.kr/radio/programList?media=radio001",
      },
      {
        name: "CBS 음악FM 프로그램/게시판",
        url: "https://www.cbs.co.kr/radio/programList?media=radio002",
      },
    ],
  },
  {
    keys: ["TBS", "TBSEFM"],
    links: [
      { name: "TBS 메인", url: "https://tbs.seoul.kr/" },
      {
        name: "TBS FM 편성표/프로그램",
        url: "https://tbs.seoul.kr/fmScheduleList.do?method=fmScheduleList",
      },
    ],
  },
  {
    keys: ["YTN"],
    links: [
      { name: "YTN 메인", url: "https://www.ytn.co.kr/" },
      {
        name: "YTN 라디오/프로그램 검색",
        url: "https://www.ytn.co.kr/search?query=%EB%9D%BC%EB%94%94%EC%98%A4",
      },
    ],
  },
  {
    keys: ["WBS", "WBSFM"],
    links: [
      { name: "WBS 라디오 메인", url: "https://wbsi.kr/index_radio.php" },
      { name: "WBS 라디오 편성표", url: "https://wbsi.kr/schedule_radio.php" },
      {
        name: "WBS 청취자 게시판",
        url: "https://wbsi.kr/bbs/board.php?bo_table=a001_01",
      },
    ],
  },
  {
    keys: ["PBC", "CPBC"],
    links: [
      { name: "cpbc 메인", url: "https://www.cpbc.co.kr/" },
      { name: "cpbc 라디오 온에어", url: "https://www.cpbc.co.kr/onair.html?channel=radio" },
      { name: "cpbc 라디오 편성표", url: "https://www.cpbc.co.kr/schedule.html?channel=radio" },
    ],
  },
  {
    keys: ["BBS"],
    links: [
      { name: "BBS 라디오 메인", url: "https://www.bbsi.co.kr/?ACT=RADIO" },
      {
        name: "BBS 라디오 프로그램 목록",
        url: "https://www.bbsi.co.kr/?ACT=RADIO_LIST",
      },
      {
        name: "BBS 라디오 프로그램 게시판",
        url: "https://www.bbsi.co.kr/?ACT=RADIO&MODE=HOME&ProgramCode=1371",
      },
    ],
  },
  {
    keys: ["ARIRANG"],
    links: [
      { name: "Arirang Radio 메인", url: "https://www.arirang.com/radio" },
      { name: "Arirang Radio 프로그램", url: "https://www.arirang.com/radio/program" },
      { name: "Arirang Radio 편성표", url: "https://www.arirang.com/radio/schedule" },
    ],
  },
  {
    keys: ["GYEONGINIFM", "IFM", "KFM"],
    links: [
      { name: "경인 iFM 라디오 메인", url: "https://www.ifm.kr/radio" },
      {
        name: "경인 iFM 청취자 게시판 1",
        url: "https://www.ifm.kr/program/board/corp_listener/128",
      },
      {
        name: "경인 iFM 청취자 게시판 2",
        url: "https://www.ifm.kr/program/board/corp_listener/129",
      },
    ],
  },
  {
    keys: ["FEBC"],
    links: [
      { name: "극동방송 서울 라디오", url: "https://seoul.febc.net/radio" },
      { name: "극동방송 라디오 프로그램", url: "https://seoul.febc.net/radio/program" },
      {
        name: "극동방송 프로그램 게시판",
        url: "https://seoul.febc.net/program/1644582/general",
      },
    ],
  },
  {
    keys: ["GUGAK"],
    links: [
      { name: "국악방송 메인", url: "https://www.igbf.kr/" },
      {
        name: "국악방송 라디오 메인",
        url: "https://www.igbf.kr/gugak_web/radio/radio_mainN.jsp?sub_num=744",
      },
      {
        name: "국악방송 프로그램/게시판",
        url: "https://www.igbf.kr/gugak_web/?sub_num=787",
      },
    ],
  },
  {
    keys: ["TBN"],
    links: [
      {
        name: "TBN 방송국별 신청곡 게시판 검색",
        url: buildGoogleSearchUrl("TBN 한국교통방송 신청곡 게시판"),
      },
    ],
  },
  {
    keys: ["KISS"],
    links: [
      {
        name: "KISS 디지털 라디오 신청곡 게시판 검색",
        url: buildGoogleSearchUrl("KISS 디지털 라디오 신청곡 게시판"),
      },
    ],
  },
];

const fallbackRadioBoardLinks: RadioBoardLink[] = [
  { name: "KBS 라디오", url: "https://radio.kbs.co.kr/index.html" },
  { name: "MBC 라디오", url: "https://m.imbc.com/radio" },
  { name: "SBS 라디오", url: "https://www.sbs.co.kr/radio" },
  { name: "CBS 라디오", url: "https://www.cbs.co.kr/radio" },
];

export function resolveRadioBoardLinks({
  stationCode,
  stationName,
}: {
  stationCode?: string | null;
  stationName?: string | null;
}): RadioBoardLink[] {
  const codeToken = normalizeToken(stationCode);
  const nameToken = normalizeToken(stationName);

  const byCode =
    codeToken.length > 0
      ? stationRadioBoardLinks.find((group) =>
          group.keys.some((key) => normalizeToken(key) === codeToken),
        )
      : null;
  if (byCode) {
    return dedupeLinks(byCode.links);
  }

  const byName =
    nameToken.length > 0
      ? stationRadioBoardLinks.find((group) =>
          group.keys.some((key) => {
            const target = normalizeToken(key);
            return nameToken.includes(target) || target.includes(nameToken);
          }),
        )
      : null;
  if (byName) {
    return dedupeLinks(byName.links);
  }

  return dedupeLinks(fallbackRadioBoardLinks);
}
