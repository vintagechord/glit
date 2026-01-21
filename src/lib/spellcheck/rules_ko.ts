export type Rule = {
  pattern: RegExp;
  replace: string;
  reason: string;
  confidence?: number;
};

const r = (pattern: string | RegExp, replace: string, reason: string, confidence = 0.8): Rule => ({
  pattern:
    typeof pattern === "string"
      ? new RegExp(pattern, "g")
      : new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"),
  replace,
  reason,
  confidence,
});

const makePastTypos = (): Rule[] => {
  const pairs: Array<[string, string]> = [
    ["있엇", "있었"],
    ["없엇", "없었"],
    ["같앗", "같았"],
    ["싫엇", "싫었"],
    ["좋앗", "좋았"],
    ["많앗", "많았"],
    ["말햇", "말했"],
    ["생각햇", "생각했"],
    ["잊엇", "잊었"],
    ["겪엇", "겪었"],
    ["먹엇", "먹었"],
    ["마셧", "마셨"],
    ["보앗", "보았"],
    ["그랫", "그랬"],
    ["버렷", "버렸"],
    ["들어왓", "들어왔"],
    ["나왓", "나왔"],
    ["봣", "봤"],
  ];

  const endings = ["다", "어", "는데", "지만", "던", "을", "지", "고"];
  const rules: Rule[] = [];
  for (const [bad, good] of pairs) {
    for (const e of endings) {
      rules.push(r(`${bad}${e}`, `${good}${e}`, `과거형 표기: ${good}${e}`, 0.95));
    }
  }
  return rules;
};

const makeSpacingSet = (): Rule[] => {
  const rules: Rule[] = [];

  const su = ["할", "될", "볼", "갈", "울", "있을", "없을", "그럴", "이럴", "저럴"];
  for (const v of su) {
    rules.push(r(`${v}수`, `${v} 수`, "띄어쓰기: ‘수’", 0.98));
    rules.push(r(`${v}수있`, `${v} 수 있`, "띄어쓰기: ‘수’", 0.98));
    rules.push(r(`${v}수없`, `${v} 수 없`, "띄어쓰기: ‘수’", 0.98));
  }

  const geo = ["인", "하는", "되는", "있는", "없는", "같은", "할", "볼", "갈", "될"];
  for (const p of geo) {
    rules.push(r(`${p}거`, `${p} 거`, "띄어쓰기: ‘거’", 0.9));
  }

  const deut = ["할", "될", "볼", "갈", "끊길", "울", "죽을"];
  for (const p of deut) {
    rules.push(r(`${p}듯`, `${p} 듯`, "띄어쓰기: ‘듯’", 0.9));
  }

  const ttae = ["할", "될", "볼", "갈", "올", "쉴"];
  for (const p of ttae) {
    rules.push(r(`${p}때`, `${p} 때`, "띄어쓰기: ‘때’", 0.85));
  }

  rules.push(r("밖에없", "밖에 없", "띄어쓰기: ‘밖에 없다’", 0.8));
  return rules;
};

const makeFixedCommon = (): Rule[] => [
  r("됬", "됐", "‘됐’ 표기", 0.98),
  r("됫", "됐", "‘됐’ 표기", 0.98),
  r("할께", "할게", "표준어 ‘할게’", 0.97),
  r("갈께", "갈게", "표준어 ‘갈게’", 0.97),
  r("볼께", "볼게", "표준어 ‘볼게’", 0.97),
  r("줄께", "줄게", "표준어 ‘줄게’", 0.97),
  r("올께", "올게", "표준어 ‘올게’", 0.97),
  r("할려고", "하려고", "표준어 ‘하려고’", 0.9),
  r("갈려고", "가려고", "표준어 ‘가려고’", 0.9),
  r("볼려고", "보려고", "표준어 ‘보려고’", 0.9),
  r("줄려고", "주려고", "표준어 ‘주려고’", 0.9),
  r("되요", "돼요", "‘돼요’ 표기", 0.85),
  r("안되요", "안 돼요", "띄어쓰기+‘돼요’", 0.8),
  r("어쨋든", "어쨌든", "표준어", 0.85),
  r("오랫만", "오랜만", "표준어", 0.9),
  r("금새", "금세", "표준어", 0.9),
  r("헷깔", "헷갈", "표준어", 0.9),
  r("햇갈", "헷갈", "표준어", 0.9),
  r("왠일", "웬일", "표준어", 0.9),
  r("왠만", "웬만", "표준어", 0.9),
  r("어제밤", "어젯밤", "표준어 ‘어젯밤’", 0.9),
  r("앉아있", "앉아 있", "띄어쓰기(제안)", 0.7),
  r("있을까", "있을까?", "문장부호(제안)", 0.3),
  r("이어졌다", "이어 졌다", "띄어쓰기(제안)", 0.3),
  r("음악은", "음악 은", "띄어쓰기(제안)", 0.25),
  r("친구가", "친구 가", "띄어쓰기(제안)", 0.25),
  r("어떡해", "어떻게", "표준어(제안)", 0.55),
  r("안되", "안 돼", "표준어(제안)", 0.55),
];

export const KO_SPELLCHECK_RULES: Rule[] = [
  ...makeFixedCommon(),
  ...makePastTypos(),
  ...makeSpacingSet(),
  r(" {2,}", " ", "중복 공백 제거", 0.9),
  r(",{2,}", ",", "중복 쉼표 제거", 0.7),
  r("\\.{4,}", "...", "말줄임표 정리", 0.7),
  r("!{2,}", "!", "중복 느낌표 정리", 0.6),
  r("\\?{2,}", "?", "중복 물음표 정리", 0.6),
];

// 기존 코드 호환을 위해 Rule type 재노출
export default KO_SPELLCHECK_RULES;
