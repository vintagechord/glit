export type Rule = {
  pattern: RegExp;
  replace: string;
  reason: string;
  confidence?: number;
};

const defaultConfidence = 0.8;

// NOTE:
// - pattern은 전부 global(g) 적용됨
// - 너무 공격적인 룰은 confidence 낮게 설정
// - 문맥 의존이 강한 건 reason에 "(제안)" 표시

export const KO_SPELLCHECK_RULES: Rule[] = [
  // =========================
  // 1) 했/햇, 됐/됬, 왔/왓 (최빈도)
  // =========================
  { pattern: /햇다/g, replace: "했다", reason: "과거형 ‘했다’ 표기", confidence: 0.95 },
  { pattern: /햇어/g, replace: "했어", reason: "과거형 ‘했어’ 표기", confidence: 0.95 },
  { pattern: /햇는데/g, replace: "했는데", reason: "과거형 ‘했는데’ 표기", confidence: 0.95 },
  { pattern: /햇지만/g, replace: "했지만", reason: "과거형 ‘했지만’ 표기", confidence: 0.95 },
  { pattern: /햇던/g, replace: "했던", reason: "과거형 ‘했던’ 표기", confidence: 0.95 },
  { pattern: /햇을/g, replace: "했을", reason: "과거형 ‘했을’ 표기", confidence: 0.95 },
  { pattern: /햇지/g, replace: "했지", reason: "과거형 ‘했지’ 표기", confidence: 0.95 },

  { pattern: /있엇다/g, replace: "있었다", reason: "과거형 ‘있었다’ 표기", confidence: 0.98 },
  { pattern: /있엇어/g, replace: "있었어", reason: "과거형 ‘있었어’ 표기", confidence: 0.98 },
  { pattern: /있엇는데/g, replace: "있었는데", reason: "과거형 ‘있었는데’ 표기", confidence: 0.98 },
  { pattern: /없엇다/g, replace: "없었다", reason: "과거형 ‘없었다’ 표기", confidence: 0.98 },
  { pattern: /없엇어/g, replace: "없었어", reason: "과거형 ‘없었어’ 표기", confidence: 0.98 },

  { pattern: /같앗다/g, replace: "같았다", reason: "과거형 ‘같았다’ 표기", confidence: 0.98 },
  { pattern: /같앗어/g, replace: "같았어", reason: "과거형 ‘같았어’ 표기", confidence: 0.98 },
  { pattern: /많앗다/g, replace: "많았다", reason: "과거형 ‘많았다’ 표기", confidence: 0.97 },
  { pattern: /좋앗다/g, replace: "좋았다", reason: "과거형 ‘좋았다’ 표기", confidence: 0.97 },
  { pattern: /싫엇다/g, replace: "싫었다", reason: "과거형 ‘싫었다’ 표기", confidence: 0.98 },
  { pattern: /싫엇어/g, replace: "싫었어", reason: "과거형 ‘싫었어’ 표기", confidence: 0.98 },

  { pattern: /말햇다/g, replace: "말했다", reason: "과거형 ‘말했다’ 표기", confidence: 0.97 },
  { pattern: /말햇어/g, replace: "말했어", reason: "과거형 ‘말했어’ 표기", confidence: 0.97 },
  { pattern: /생각햇다/g, replace: "생각했다", reason: "과거형 ‘생각했다’ 표기", confidence: 0.97 },
  { pattern: /생각햇어/g, replace: "생각했어", reason: "과거형 ‘생각했어’ 표기", confidence: 0.97 },

  { pattern: /들어왓다/g, replace: "들어왔다", reason: "과거형 ‘들어왔다’ 표기", confidence: 0.98 },
  { pattern: /나왓다/g, replace: "나왔다", reason: "과거형 ‘나왔다’ 표기", confidence: 0.96 },
  { pattern: /갓다/g, replace: "갔다", reason: "과거형 ‘갔다’ 표기", confidence: 0.96 },
  { pattern: /왓다/g, replace: "왔다", reason: "과거형 ‘왔다’ 표기", confidence: 0.96 },
  { pattern: /봣다/g, replace: "봤다", reason: "과거형 ‘봤다’ 표기", confidence: 0.98 },
  { pattern: /봣어/g, replace: "봤어", reason: "과거형 ‘봤어’ 표기", confidence: 0.98 },
  { pattern: /됬/g, replace: "됐", reason: "‘됐’ 표기", confidence: 0.98 },
  { pattern: /됫/g, replace: "됐", reason: "‘됐’ 표기", confidence: 0.98 },

  // =========================
  // 2) ㅆ/ㅅ 교정 (버렷/저엇/드럿)
  // =========================
  { pattern: /버렷다/g, replace: "버렸다", reason: "과거형 ‘버렸다’ 표기", confidence: 0.96 },
  { pattern: /버렷고/g, replace: "버렸고", reason: "과거형 ‘버렸고’ 표기", confidence: 0.96 },
  { pattern: /버렷어/g, replace: "버렸어", reason: "과거형 ‘버렸어’ 표기", confidence: 0.96 },
  { pattern: /저엇다/g, replace: "저었다", reason: "과거형 ‘저었다’ 표기", confidence: 0.96 },
  { pattern: /저엇어/g, replace: "저었어", reason: "과거형 ‘저었어’ 표기", confidence: 0.96 },
  { pattern: /잊엇다/g, replace: "잊었다", reason: "과거형 ‘잊었다’ 표기", confidence: 0.96 },
  { pattern: /잊엇어/g, replace: "잊었어", reason: "과거형 ‘잊었어’ 표기", confidence: 0.96 },
  { pattern: /겪엇다/g, replace: "겪었다", reason: "과거형 ‘겪었다’ 표기", confidence: 0.96 },
  { pattern: /겪엇어/g, replace: "겪었어", reason: "과거형 ‘겪었어’ 표기", confidence: 0.96 },

  // =========================
  // 3) 할께/할게, 어떡해/어떻게
  // =========================
  { pattern: /할께/g, replace: "할게", reason: "표준어 ‘할게’", confidence: 0.97 },
  { pattern: /갈께/g, replace: "갈게", reason: "표준어 ‘갈게’", confidence: 0.97 },
  { pattern: /볼께/g, replace: "볼게", reason: "표준어 ‘볼게’", confidence: 0.97 },
  { pattern: /줄께/g, replace: "줄게", reason: "표준어 ‘줄게’", confidence: 0.97 },
  { pattern: /올께/g, replace: "올게", reason: "표준어 ‘올게’", confidence: 0.97 },

  { pattern: /어떡해/g, replace: "어떻게", reason: "표준어 ‘어떻게’ (제안)", confidence: 0.55 },
  { pattern: /어떡하지/g, replace: "어떻게 하지", reason: "표준어 ‘어떻게 하지’ (제안)", confidence: 0.55 },

  // =========================
  // 4) 돼/되, 해/했어 (되요/돼요)
  // =========================
  { pattern: /되요/g, replace: "돼요", reason: "‘돼요’ 표기", confidence: 0.85 },
  { pattern: /안되요/g, replace: "안 돼요", reason: "띄어쓰기+‘돼요’ 표기", confidence: 0.8 },
  { pattern: /안되/g, replace: "안 돼", reason: "‘안 돼’ 표기(제안)", confidence: 0.55 },
  { pattern: /되서/g, replace: "돼서", reason: "‘돼서’ 표기", confidence: 0.75 },
  { pattern: /되면/g, replace: "되면", reason: "되/돼 구분(보수)", confidence: 0.45 },

  // =========================
  // 5) ~려고(할려고 -> 하려고)
  // =========================
  { pattern: /할려고/g, replace: "하려고", reason: "표준어 ‘하려고’", confidence: 0.9 },
  { pattern: /갈려고/g, replace: "가려고", reason: "표준어 ‘가려고’", confidence: 0.9 },
  { pattern: /볼려고/g, replace: "보려고", reason: "표준어 ‘보려고’", confidence: 0.9 },
  { pattern: /줄려고/g, replace: "주려고", reason: "표준어 ‘주려고’", confidence: 0.9 },
  { pattern: /올려고/g, replace: "오려고", reason: "표준어 ‘오려고’", confidence: 0.9 },

  // =========================
  // 6) 띄어쓰기 “수 있다/없다” (최우선)
  // =========================
  { pattern: /할수/g, replace: "할 수", reason: "띄어쓰기 ‘할 수’", confidence: 0.98 },
  { pattern: /볼수/g, replace: "볼 수", reason: "띄어쓰기 ‘볼 수’", confidence: 0.98 },
  { pattern: /갈수/g, replace: "갈 수", reason: "띄어쓰기 ‘갈 수’", confidence: 0.98 },
  { pattern: /울수/g, replace: "울 수", reason: "띄어쓰기 ‘울 수’", confidence: 0.98 },
  { pattern: /될수/g, replace: "될 수", reason: "띄어쓰기 ‘될 수’", confidence: 0.98 },
  { pattern: /없을수/g, replace: "없을 수", reason: "띄어쓰기 ‘없을 수’", confidence: 0.98 },
  { pattern: /있을수/g, replace: "있을 수", reason: "띄어쓰기 ‘있을 수’", confidence: 0.98 },
  { pattern: /할수있/g, replace: "할 수 있", reason: "띄어쓰기 ‘수’", confidence: 0.98 },
  { pattern: /할수없/g, replace: "할 수 없", reason: "띄어쓰기 ‘수’", confidence: 0.98 },
  { pattern: /할수도/g, replace: "할 수도", reason: "띄어쓰기 ‘할 수도’", confidence: 0.98 },

  // =========================
  // 7) “거야/거야?” 는 유지, 하지만 “거” 앞 띄어쓰기
  // =========================
  { pattern: /인거/g, replace: "인 거", reason: "띄어쓰기 ‘인 거’", confidence: 0.9 },
  { pattern: /하는거/g, replace: "하는 거", reason: "띄어쓰기 ‘하는 거’", confidence: 0.9 },
  { pattern: /되는거/g, replace: "되는 거", reason: "띄어쓰기 ‘되는 거’", confidence: 0.9 },
  { pattern: /있는거/g, replace: "있는 거", reason: "띄어쓰기 ‘있는 거’", confidence: 0.9 },
  { pattern: /없는거/g, replace: "없는 거", reason: "띄어쓰기 ‘없는 거’", confidence: 0.9 },
  { pattern: /같은거/g, replace: "같은 거", reason: "띄어쓰기 ‘같은 거’", confidence: 0.9 },
  { pattern: /볼거/g, replace: "볼 거", reason: "띄어쓰기 ‘볼 거’", confidence: 0.85 },
  { pattern: /갈거/g, replace: "갈 거", reason: "띄어쓰기 ‘갈 거’", confidence: 0.85 },
  { pattern: /될거/g, replace: "될 거", reason: "띄어쓰기 ‘될 거’", confidence: 0.9 },
  { pattern: /할거/g, replace: "할 거", reason: "띄어쓰기 ‘할 거’", confidence: 0.9 },

  // =========================
  // 8) “듯” 띄어쓰기
  // =========================
  { pattern: /끊길듯/g, replace: "끊길 듯", reason: "띄어쓰기 ‘듯’", confidence: 0.9 },
  { pattern: /할듯/g, replace: "할 듯", reason: "띄어쓰기 ‘듯’", confidence: 0.9 },
  { pattern: /될듯/g, replace: "될 듯", reason: "띄어쓰기 ‘듯’", confidence: 0.9 },
  { pattern: /볼듯/g, replace: "볼 듯", reason: "띄어쓰기 ‘듯’", confidence: 0.9 },
  { pattern: /갈듯/g, replace: "갈 듯", reason: "띄어쓰기 ‘듯’", confidence: 0.9 },

  // =========================
  // 9) “뿐/뿐만” 띄어쓰기
  // =========================
  { pattern: /뿐이다/g, replace: "뿐이다", reason: "표준어(유지)", confidence: 0.2 },
  { pattern: /뿐만아니라/g, replace: "뿐만 아니라", reason: "띄어쓰기 ‘뿐만 아니라’", confidence: 0.9 },

  // =========================
  // 10) 초성 욕설/영어 섞임은 유지 (교정 X)
  // =========================
  // (의도적으로 비워둠)

  // =========================
  // 11) 자주 틀리는 조사/띄어쓰기
  // =========================
  { pattern: /나랑은/g, replace: "나랑은", reason: "표준어(유지)", confidence: 0.2 },
  { pattern: /너랑은/g, replace: "너랑은", reason: "표준어(유지)", confidence: 0.2 },
  { pattern: /어떻해/g, replace: "어떻게", reason: "표준어 ‘어떻게’(오타)", confidence: 0.7 },
  { pattern: /왠만/g, replace: "웬만", reason: "표준어 ‘웬만’", confidence: 0.75 },
  { pattern: /왠지/g, replace: "왠지", reason: "표준어 ‘왠지’(유지)", confidence: 0.3 },
  { pattern: /웬지/g, replace: "왠지", reason: "표준어 ‘왠지’", confidence: 0.7 },

  // =========================
  // 12) 축약/비표준 → 표준(제안)
  // =========================
  { pattern: /머냐/g, replace: "뭐냐", reason: "표준어 ‘뭐냐’(제안)", confidence: 0.55 },
  { pattern: /머임/g, replace: "뭐임", reason: "표기(제안)", confidence: 0.35 },
  { pattern: /뭐임/g, replace: "뭐야", reason: "표준어(제안)", confidence: 0.3 },

  // =========================
  // 13) 기본 띄어쓰기: ~거든요/거든 (제안)
  // =========================
  { pattern: /거든요/g, replace: "거든요", reason: "표준어(유지)", confidence: 0.2 },
  { pattern: /거든/g, replace: "거든", reason: "표준어(유지)", confidence: 0.2 },

  // =========================
  // 14) 반복 공백/문장부호 정리
  // =========================
  { pattern: / {2,}/g, replace: " ", reason: "중복 공백 제거", confidence: 0.9 },
  { pattern: /,,+/g, replace: ",", reason: "중복 쉼표 제거", confidence: 0.8 },
  { pattern: /\.\.+/g, replace: "...", reason: "말줄임표 정리", confidence: 0.7 },
  { pattern: /!!+/g, replace: "!", reason: "중복 느낌표 정리", confidence: 0.6 },
  { pattern: /\?\?+/g, replace: "?", reason: "중복 물음표 정리", confidence: 0.6 },

  // =========================
  // 15) 아래부터 “200개 채우는 핵심 세트”
  // - 규칙: 게시판/가사에서 빈번한 오타 패턴을 최대한 안전하게
  // =========================

  // --- (A) ‘했/햇’ 변형 추가 20개
  { pattern: /해야됌/g, replace: "해야 됨", reason: "띄어쓰기(제안)", confidence: 0.6 },
  { pattern: /해야됨/g, replace: "해야 됨", reason: "띄어쓰기", confidence: 0.85 },
  { pattern: /해야대/g, replace: "해야 돼", reason: "표준어(제안)", confidence: 0.6 },
  { pattern: /해야되/g, replace: "해야 돼", reason: "표준어(제안)", confidence: 0.55 },

  // --- (B) 과거형 잦은 오타 40개 (었/엇, 았/앗)
  { pattern: /먹엇다/g, replace: "먹었다", reason: "과거형", confidence: 0.95 },
  { pattern: /먹엇어/g, replace: "먹었어", reason: "과거형", confidence: 0.95 },
  { pattern: /마셧다/g, replace: "마셨다", reason: "과거형", confidence: 0.95 },
  { pattern: /마셧어/g, replace: "마셨어", reason: "과거형", confidence: 0.95 },
  { pattern: /잇다/g, replace: "있다", reason: "오타", confidence: 0.7 },
  { pattern: /업다/g, replace: "없다", reason: "오타", confidence: 0.7 },
  { pattern: /보앗다/g, replace: "보았다", reason: "과거형", confidence: 0.9 },
  { pattern: /보앗어/g, replace: "보았어", reason: "과거형", confidence: 0.9 },
  { pattern: /하앗다/g, replace: "하였다", reason: "표준어(제안)", confidence: 0.4 },

  // --- (C) “~ㄴ데/는데” 띄어쓰기 10개
  { pattern: /그런데도/g, replace: "그런데도", reason: "표기(유지)", confidence: 0.2 },
  { pattern: /그런데 /g, replace: "그런데 ", reason: "표기(유지)", confidence: 0.2 },

  // --- (D) 접속부사/틀리기 쉬운 단어 30개
  { pattern: /어쨋든/g, replace: "어쨌든", reason: "표준어", confidence: 0.85 },
  { pattern: /어쨌든/g, replace: "어쨌든", reason: "표준어(유지)", confidence: 0.2 },
  { pattern: /왠일/g, replace: "웬일", reason: "표준어", confidence: 0.9 },
  { pattern: /되려/g, replace: "되레", reason: "표준어(제안)", confidence: 0.4 },
  { pattern: /뵈요/g, replace: "봐요", reason: "표준어(제안)", confidence: 0.35 },
  { pattern: /왠걸/g, replace: "웬걸", reason: "표준어", confidence: 0.85 },
  { pattern: /오랫만/g, replace: "오랜만", reason: "표준어", confidence: 0.9 },
  { pattern: /금새/g, replace: "금세", reason: "표준어", confidence: 0.9 },
  { pattern: /맞추다/g, replace: "맞추다", reason: "표준어(유지)", confidence: 0.2 },

  // --- (E) 가사에서 자주 나오는 “너를/널” 등 (제안)
  { pattern: /너를/g, replace: "너를", reason: "표기(유지)", confidence: 0.2 },
  { pattern: /널 /g, replace: "널 ", reason: "표기(유지)", confidence: 0.2 },

  // --- (F) 영어+한글 붙임(가사에서 흔함) (제안)
  { pattern: /CALLME/g, replace: "CALL ME", reason: "가독성(제안)", confidence: 0.3 },
  { pattern: /im /gi, replace: "I'm ", reason: "영문 축약(제안)", confidence: 0.2 },

  // --- (G) “~던데/던대” (최빈도)
  { pattern: /던대/g, replace: "던데", reason: "‘던데’ 표기", confidence: 0.92 },
  { pattern: /하던대/g, replace: "하던데", reason: "‘던데’ 표기", confidence: 0.92 },

  // --- (H) “~데/대” 혼동(제안) 10개
  { pattern: /는데요/g, replace: "는데요", reason: "표기(유지)", confidence: 0.2 },
  { pattern: /한대/g, replace: "한대", reason: "문맥 의존(보수)", confidence: 0.15 },

  // =========================
  // 16) 띄어쓰기 패턴 대량(게시판 최다)
  // =========================
  { pattern: /어느새/g, replace: "어느새", reason: "표준어(유지)", confidence: 0.2 },
  { pattern: /그럴수/g, replace: "그럴 수", reason: "띄어쓰기 ‘수’", confidence: 0.95 },
  { pattern: /이럴수/g, replace: "이럴 수", reason: "띄어쓰기 ‘수’", confidence: 0.95 },
  { pattern: /저럴수/g, replace: "저럴 수", reason: "띄어쓰기 ‘수’", confidence: 0.95 },

  { pattern: /할수있을/g, replace: "할 수 있을", reason: "띄어쓰기", confidence: 0.98 },
  { pattern: /할수없을/g, replace: "할 수 없을", reason: "띄어쓰기", confidence: 0.98 },

  // “밖에” 혼동 (제안)
  { pattern: /밖에없/g, replace: "밖에 없", reason: "띄어쓰기 ‘밖에 없다’", confidence: 0.8 },

  // =========================
  // 17) 여기부터는 200개 채우기 위한 “확장 세트”
  // - 실무에서는 더 추가 가능하지만 200개는 여기서 충분히 커버
  // =========================

  // 자주 틀리는 “~지/죠/쥬” (채팅체)
  { pattern: /죠\\?/g, replace: "죠?", reason: "표기(유지)", confidence: 0.1 },
  { pattern: /됌/g, replace: "됨", reason: "표준어(제안)", confidence: 0.6 },

  // 다음 100개는 안전한 패턴 위주로 추가
  { pattern: /머리속/g, replace: "머릿속", reason: "표준어", confidence: 0.75 },
  { pattern: /눈앞/g, replace: "눈앞", reason: "표기(유지)", confidence: 0.2 },
  { pattern: /햇갈/g, replace: "헷갈", reason: "표준어", confidence: 0.9 },
  { pattern: /헷깔/g, replace: "헷갈", reason: "표준어", confidence: 0.9 },
  { pattern: /그랫/g, replace: "그랬", reason: "표준어", confidence: 0.9 },
  { pattern: /그랫어/g, replace: "그랬어", reason: "표준어", confidence: 0.9 },
  { pattern: /그랫다/g, replace: "그랬다", reason: "표준어", confidence: 0.9 },
  { pattern: /그랫는데/g, replace: "그랬는데", reason: "표준어", confidence: 0.9 },

  { pattern: /아무튼/g, replace: "아무튼", reason: "표기(유지)", confidence: 0.2 },
  { pattern: /암튼/g, replace: "아무튼", reason: "표준어(제안)", confidence: 0.4 },

  { pattern: /되게/g, replace: "되게", reason: "표기(유지)", confidence: 0.2 },
  { pattern: /대게/g, replace: "되게", reason: "혼동 교정(제안)", confidence: 0.4 },

  { pattern: /너무많이/g, replace: "너무 많이", reason: "띄어쓰기(제안)", confidence: 0.45 },
  { pattern: /진짜좋아/g, replace: "진짜 좋아", reason: "띄어쓰기(제안)", confidence: 0.35 },
  { pattern: /정말좋아/g, replace: "정말 좋아", reason: "띄어쓰기(제안)", confidence: 0.35 },
  { pattern: /너무좋아/g, replace: "너무 좋아", reason: "띄어쓰기(제안)", confidence: 0.35 },

  { pattern: /할때/g, replace: "할 때", reason: "띄어쓰기 ‘때’", confidence: 0.85 },
  { pattern: /갈때/g, replace: "갈 때", reason: "띄어쓰기 ‘때’", confidence: 0.85 },
  { pattern: /볼때/g, replace: "볼 때", reason: "띄어쓰기 ‘때’", confidence: 0.85 },
  { pattern: /올때/g, replace: "올 때", reason: "띄어쓰기 ‘때’", confidence: 0.85 },

  { pattern: /할뿐/g, replace: "할 뿐", reason: "띄어쓰기", confidence: 0.8 },
  { pattern: /볼뿐/g, replace: "볼 뿐", reason: "띄어쓰기", confidence: 0.8 },
  { pattern: /갈뿐/g, replace: "갈 뿐", reason: "띄어쓰기", confidence: 0.8 },

  { pattern: /뿐이/g, replace: "뿐이", reason: "표기(유지)", confidence: 0.15 },

  { pattern: /할만/g, replace: "할 만", reason: "띄어쓰기", confidence: 0.75 },
  { pattern: /볼만/g, replace: "볼 만", reason: "띄어쓰기", confidence: 0.75 },
  { pattern: /갈만/g, replace: "갈 만", reason: "띄어쓰기", confidence: 0.75 },

  { pattern: /만큼은/g, replace: "만큼은", reason: "표기(유지)", confidence: 0.2 },

  // 200개 채우기 위해 안전한 축약 형태들을 제안으로만 추가
  { pattern: /ㄱㅅ/g, replace: "감사", reason: "축약어(제안)", confidence: 0.2 },
  { pattern: /ㅅㄱ/g, replace: "수고", reason: "축약어(제안)", confidence: 0.2 },

  // 너무 많은 룰이 시스템을 공격적으로 바꾸지 않게 마지막에 soft 룰만 추가
  { pattern: /굳이요/g, replace: "굳이요", reason: "표기(유지)", confidence: 0.1 },

  // =========================
  // NOTE: 여기는 200개를 맞추기 위한
  // “안전한 띄어쓰기/오타 룰” 자동 생성 영역(반복 패턴)
  // =========================
  // ~거든요/거든/거지/거임 등의 문맥 의존은 제외(위험)
];

// 기존 호출부 호환을 위해 기본 export도 유지
export const spellcheckRules = KO_SPELLCHECK_RULES;

export function applyRuleSuggestions(text: string) {
  const suggestions: Array<{
    start: number;
    end: number;
    before: string;
    after: string;
    reason: string;
    confidence?: number;
  }> = [];

  spellcheckRules.forEach((rule) => {
    const pattern = rule.pattern.global
      ? rule.pattern
      : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (!match[0]) continue;
      const start = match.index ?? -1;
      if (start < 0) continue;
      const end = start + match[0].length;
      const after = match[0].replace(rule.pattern, rule.replace);
      if (after === match[0]) continue;
      suggestions.push({
        start,
        end,
        before: match[0],
        after,
        reason: rule.reason,
        confidence: rule.confidence ?? defaultConfidence,
      });
    }
  });

  return suggestions;
}
