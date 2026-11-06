/**
 * Terms a first-time applicant meets on Onside. Each definition states what
 * the service actually does: result labels mirror station-review-display and
 * broadcast-rating, rating names mirror mv-assets, prices come from the guides.
 */
export type GlossaryTerm = {
  term: string;
  /** Other names people search for. */
  aliases?: string[];
  definition: string;
  /** Guide that explains it in depth. */
  link?: { label: string; href: string };
};

export type GlossarySection = { heading: string; terms: GlossaryTerm[] };

export const REVIEW_GLOSSARY: GlossarySection[] = [
  {
    heading: "심의 종류",
    terms: [
      {
        term: "음반 심의",
        aliases: ["앨범 심의", "가요 심의", "음원 심의", "방송국 심의", "라디오 심의"],
        definition: "방송사가 노래를 방송에 내보내기 전에 가사와 음원을 검토해 방송 적합성을 판정하는 절차입니다. 앨범 심의, 가요 심의, 방송국 심의, 라디오 심의는 모두 같은 절차를 부르는 이름이며, 방송국마다 따로 접수하고 결과도 방송국별로 나옵니다.",
        link: { label: "음반 심의 안내", href: "/guide/album-review" },
      },
      {
        term: "뮤직비디오 심의",
        aliases: ["뮤비 심의", "MV 심의"],
        definition: "뮤직비디오를 공개하기 전에 받는 심의입니다. 온라인 유통용 심의(영상물등급위원회 등급분류)와 TV 송출을 위한 방송국별 심의로 나뉩니다.",
        link: { label: "뮤직비디오 심의 안내", href: "/guide/mv-review" },
      },
      {
        term: "온라인 유통용 심의",
        aliases: ["유통용 심의", "등급분류"],
        definition: "음원 유통사와 온라인 플랫폼에 뮤직비디오를 올리기 위해 영상물등급위원회의 등급분류를 받는 절차입니다. 온사이드에서는 Mnet을 추가 옵션으로 함께 접수할 수 있습니다.",
      },
      {
        term: "방송국별 심의 (뮤직비디오)",
        aliases: ["TV 송출용 심의"],
        definition: "뮤직비디오를 TV에 송출하기 위해 KBS·MBC·SBS 가운데 방송사를 골라 각각 받는 심의입니다. 방송사마다 제출 규격과 편성 조건이 다릅니다.",
      },
      {
        term: "방송용 입고",
        aliases: ["입고", "ETN 입고"],
        definition: "심의 없이 방송사에 뮤직비디오를 방송용으로 전달해 등록하는 절차입니다. ETN은 입고로 접수하며 입고비는 영상 1건 30,000원입니다. 온라인 심의(영등위 등급분류)를 마친 영상만 입고할 수 있습니다.",
        link: { label: "ETN 입고 안내", href: "/guide/stations/etn" },
      },
      {
        term: "심의 대행",
        definition: "신청서 작성, 자료 정리, 방송국 접수, 결과 수령을 신청자 대신 진행하는 서비스입니다. 온사이드는 2017년부터 음반·뮤직비디오 심의 접수를 대행하고 있습니다.",
        link: { label: "온사이드 소개", href: "/about" },
      },
    ],
  },
  {
    heading: "접수와 비용",
    terms: [
      {
        term: "방송국 패키지",
        aliases: ["3곳 패키지", "15곳 패키지"],
        definition: "음반 심의를 접수할 방송국 묶음입니다. KBS·MBC·SBS 3곳부터 7곳·10곳·13곳·15곳까지 있으며, 비용은 앨범 1건 기준으로 패키지마다 정해져 있습니다.",
        link: { label: "심의 비용 안내", href: "/guide/pricing" },
      },
      {
        term: "발매 전 접수",
        definition: "아직 발매하지 않은 앨범을 신청서(HWP 또는 DOC), WAV 음원 또는 전체 음원 ZIP, 앨범 정보, 트랙별 크레딧, 전체 가사와 외국어 가사 번역으로 접수하는 방식입니다.",
      },
      {
        term: "발매 후 접수",
        aliases: ["멜론 링크 접수", "지니 링크 접수"],
        definition: "이미 발매된 앨범을 멜론 또는 지니 앨범 링크로 접수하는 방식입니다. 추가금이 없고 신청서는 앨범 링크로 대신하며, 심의용 WAV 음원 또는 전체 음원 ZIP만 첨부합니다.",
      },
      {
        term: "심의용 CD·가사집",
        definition: "정식 CD로 발매한 앨범은 방송사가 실제 CD를 요구할 수 있습니다. 디지털 음반은 온사이드가 심의용 CD와 가사집 제작을 지원합니다.",
      },
      {
        term: "긴급 심의",
        definition: "일정이 급한 접수입니다. 가능 여부는 방송국 조건에 따라 다르고 추가 비용이 생길 수 있어 신청 전에 문의가 필요합니다.",
      },
      {
        term: "현금영수증·세금계산서",
        definition: "결제 후 발급할 수 있는 지출 증빙입니다. 카드 결제와 무통장 입금 모두 가능하며, 사업자는 세금계산서, 개인은 현금영수증을 선택합니다.",
      },
    ],
  },
  {
    heading: "진행 상태와 결과",
    terms: [
      {
        term: "조회 코드",
        definition: "접수 후 발급되는 코드로, 로그인 없이 결과 조회 화면에서 진행 상황과 방송국별 결과를 확인할 때 씁니다. 회원 접수는 마이페이지에도 저장됩니다.",
        link: { label: "결과 조회", href: "/track" },
      },
      {
        term: "접수예정 · 접수완료",
        definition: "접수예정은 자료와 결제를 확인하고 방송국에 보내기 전 상태, 접수완료는 방송국에 접수되어 결과를 기다리는 상태입니다.",
      },
      {
        term: "적격",
        aliases: ["방송 적합"],
        definition: "방송에 내보내도 된다는 판정입니다. 곡별로 나오며, 적격을 받아도 실제 편성은 방송사가 결정합니다.",
      },
      {
        term: "부적격",
        aliases: ["방송 부적합", "방송 불가"],
        definition: "가사나 내용이 방송 기준에 맞지 않아 방송할 수 없다는 판정입니다. 앨범 가운데 일부 곡만 부적격이면 방송국 결과에 'N곡 부적격'으로 표시됩니다.",
      },
      {
        term: "부분 적격",
        definition: "여러 곡 가운데 일부는 적격, 일부는 부적격으로 나온 방송국 결과입니다. 곡별 결과는 결과 화면에서 확인합니다.",
      },
      {
        term: "보완 요청",
        definition: "방송국이 자료 보완을 요구한 상태입니다. 가사 누락, 번역 누락, 발매일 미정 같은 사유가 많으며, 보완 자료를 내면 다시 진행합니다.",
      },
      {
        term: "방송 시청 등급",
        aliases: ["전체 시청가", "12세 이상 시청가", "15세 이상 시청가", "19세 이상 시청가"],
        definition: "방송국별 뮤직비디오 심의에서 적격과 함께 나오는 등급입니다. 전체 시청가, 12세 이상 시청가, 15세 이상 시청가, 19세 이상 시청가로 표시됩니다.",
      },
    ],
  },
  {
    heading: "뮤직비디오 등급",
    terms: [
      {
        term: "영상물등급위원회",
        aliases: ["영등위"],
        definition: "영상물의 등급을 분류하는 기관입니다. 온라인 유통용 뮤직비디오 심의는 이 기관의 등급분류 결과를 받는 절차입니다.",
        link: { label: "영등위 뮤직비디오 심의 안내", href: "/guide/stations/kmrb" },
      },
      {
        term: "등급분류 결과",
        aliases: ["전체관람가", "12세이상관람가", "15세이상관람가", "청소년관람불가"],
        definition: "뮤직비디오에 매겨지는 등급입니다. 전체관람가, 12세이상관람가, 15세이상관람가, 청소년관람불가 가운데 하나로 나오며, 기준에 맞지 않으면 심의불가가 됩니다.",
      },
      {
        term: "필증",
        definition: "등급분류를 받았다는 증빙 문서입니다. 유통사나 플랫폼이 제출을 요구하는 경우가 많아, 온사이드는 결과와 함께 내려받을 수 있게 안내합니다.",
      },
      {
        term: "등급 표기 이미지",
        definition: "영상 앞부분에 넣는 등급 마크 이미지입니다. 온라인 유통용 결과에 등급 표기 이미지와 사용 안내가 함께 제공됩니다.",
      },
      {
        term: "영상 규격",
        definition: "뮤직비디오 심의에 권장하는 파일 규격입니다. MOV 또는 MP4, 1920×1080, 29.97fps를 권장하며, 방송국별 심의는 방송사 규격을 다시 확인합니다.",
      },
    ],
  },
];

export const GLOSSARY_TERM_COUNT = REVIEW_GLOSSARY.reduce((sum, section) => sum + section.terms.length, 0);
