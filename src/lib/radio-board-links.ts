export type RadioBoardLink = { name: string; url: string };

type RadioDirectory = { keys: string[]; name: string; url: string };

// Link to official current program directories rather than a particular show's
// board, which can disappear when a program ends. Reviewed 2026-10-16.
const directories: RadioDirectory[] = [
  { keys: ["KBS", "KBS1FM", "KBS2FM"], name: "KBS 라디오", url: "https://radio.kbs.co.kr/" },
  { keys: ["MBC", "MBCFM4U", "MBC표준FM"], name: "MBC 라디오", url: "https://m.imbc.com/RadioMain" },
  { keys: ["SBS", "SBS파워FM", "SBS러브FM"], name: "SBS 라디오", url: "https://radio.sbs.co.kr/" },
  { keys: ["CBS"], name: "CBS 라디오", url: "https://www.cbs.co.kr/radio" },
  { keys: ["TBS", "TBSEFM"], name: "TBS 라디오", url: "https://tbs.seoul.kr/fm/programsDay.do" },
  { keys: ["YTN"], name: "YTN 라디오", url: "https://radio.ytn.co.kr/" },
  { keys: ["WBS", "WBSFM"], name: "WBS 원음방송", url: "https://wbsi.kr/index_radio.php" },
  { keys: ["PBC", "CPBC"], name: "cpbc 가톨릭평화방송", url: "https://www.cpbc.co.kr/" },
  { keys: ["BBS"], name: "BBS 라디오", url: "https://www.bbs.or.kr/HOME2/?ACT=RADIO" },
  { keys: ["ARIRANG"], name: "Arirang Radio", url: "https://www.arirang.com/radio" },
  { keys: ["GYEONGINIFM", "IFM", "KFM"], name: "경인방송 iFM", url: "https://www.ifm.kr/" },
  { keys: ["TBN"], name: "TBN 한국교통방송", url: "https://www.tbn.or.kr/" },
  { keys: ["FEBC"], name: "극동방송", url: "https://seoul.febc.net/" },
  { keys: ["GUGAK"], name: "국악방송", url: "https://new.igbf.kr/" },
];

const normalizeToken = (value?: string | null) => (value ?? "").toUpperCase().replace(/[\s_-]/g, "");

export function resolveRadioBoardLinks({ stationCode, stationName }: {
  stationCode?: string | null;
  stationName?: string | null;
}): RadioBoardLink[] {
  const code = normalizeToken(stationCode);
  const name = normalizeToken(stationName);
  // A known but unsupported code (e.g. KISS) must not inherit another station's
  // links by fuzzy name matching: approval is broadcaster-specific.
  const match = code
    ? directories.find(item => item.keys.some(key => normalizeToken(key) === code))
    : directories.find(item => name && (normalizeToken(item.name) === name || item.keys.some(key => normalizeToken(key) === name)));
  return match ? [{ name: `${match.name} 프로그램 · 게시판 찾기`, url: match.url }] : [];
}
