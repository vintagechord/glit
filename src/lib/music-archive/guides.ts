/** Central defaults; admin overrides are stored separately. External navigation never changes task state. */
export type AgencyGuide = {
  id: string; name: string; kind: "review" | "copyright" | "performer" | "karaoke";
  introduction: string; eligibility: string; preparation: string[]; steps: string[];
  after: string[]; costNote: string; url: string; searchUrl: string; applyUrl: string;
  checkedAt: string; sources: { title: string; url: string }[]; visible: boolean;
};
const checkedAt = "2026-09-08";
const copyrightIntro = "저작권은 창작과 동시에 발생합니다. 협회의 음악저작물 신고·관리와 한국저작권위원회의 법적 등록은 목적과 절차가 다릅니다. 본인의 권리자 역할과 신탁 관계에 해당하는 업무를 선택하세요.";
const creationSource = { title: "문화체육관광부 · 저작자와 저작권자", url: "https://www.mcst.go.kr/site/s_policy/copyright/knowledge/know05.jsp?pCommPage=1" };
export const agencyGuides: AgencyGuide[] = [
  {
    id: "komca", name: "KOMCA · 음악저작물 등록·관리", kind: "copyright",
    introduction: copyrightIntro,
    eligibility: "작사·작곡 등 저작자 또는 적법한 권리·업무 권한이 있는 담당자가 자신의 신탁 관계를 확인합니다. 입회·신탁계약과 작품별 신고를 별도로 기록하며, KOMCA와 KOSCAP 양쪽 등록을 요구하지 않습니다.",
    preparation: ["관리할 저작물의 제목, 저작자명·역할, 확보한 지분·작품번호와 발매 정보를 정리하세요.", "공식 자료실의 신탁 관련 서식에서 해당 신고서와 위임·변경 서식을 확인하세요. 실제 제출 자료는 본인 상황에 맞게 협회에 확인하세요."],
    steps: ["KOMCA 홈페이지에서 저작물 검색을 열어 제목뿐 아니라 저작자와 작품번호를 비교하세요.", "신탁 관계를 확인한 뒤 자료실 → 신탁관련서식 → 저작물 등록 관련에서 신고 방법을 확인하세요. 온라인 로그인 이후 세부 신청 화면은 이번 점검에서 확인하지 못했으므로 협회 안내에 따라 진행하세요."],
    after: ["신고 접수와 등록 정보 반영을 따로 확인하세요. 검색된 작품이 있어도 자신의 권리 관계가 인증된 것은 아닙니다.", "온사이드에는 대상 저작물·트랙, 저작자와 역할, 작품번호, 신청·확인 날짜, 결과와 근거를 기록하세요. 직접 조회한 내용은 사용자 입력으로 보관됩니다."],
    costNote: "온사이드의 안내·기록 관리는 무료입니다. 협회 입회·신탁·기타 비용의 적용 여부와 금액은 공식 안내를 확인하세요. 이번 안내는 비용 면제나 등록 승인을 보장하지 않습니다.",
    url: "https://www.komca.or.kr/dat2/dat_contents_0101.jsp", searchUrl: "https://www.komca.or.kr/", applyUrl: "https://www.komca.or.kr/dat2/dat_contents_0101.jsp", checkedAt, visible: true,
    sources: [{ title: "KOMCA · 신탁관련서식", url: "https://www.komca.or.kr/dat2/dat_contents_0101.jsp" }, creationSource],
  },
  {
    id: "koscap", name: "KOSCAP · 음악저작물 등록·관리", kind: "copyright",
    introduction: copyrightIntro,
    eligibility: "저작자 또는 정당한 권한이 있는 담당자가 KOSCAP 신탁 관계와 대상 저작물을 확인합니다. 신탁계약 완료와 작품별 등록 완료는 각각 확인해야 합니다.",
    preparation: ["작품명, 가수명, 저작자·역할, 앨범명과 이미 확보한 작품번호를 정리하세요.", "공식 안내에는 작품등록신청서, 여러 곡의 별지, 해당하는 예명·저작자명·지분변경 신청서와 저작자임을 증명할 자료가 안내되어 있습니다. 제출 전 최신 양식을 확인하세요."],
    steps: ["공식 작품검색에서 작품명·가수명·저작자를 함께 비교하고 동명 작품을 구분하세요.", "입회·신탁 → 신탁계약안내와 작품등록안내를 확인한 뒤, 본인 계정의 마이페이지 → 작품등록에서 진행하세요."],
    after: ["마이페이지의 등록곡리스트와 접수 결과를 확인하세요. 신탁 관계가 없는 다른 기관의 등록을 추가로 완료할 필요는 없습니다.", "온사이드에는 대상 저작물·트랙, 관련 저작자, 기관 작품번호, 신청·등록·확인 날짜와 사용자 입력 근거를 기록하세요."],
    costNote: "온사이드 무료 관리에 외부기관 비용은 포함되지 않습니다. 입회·신탁 조건과 적용 비용은 공식 신탁계약안내에서 확인하세요.",
    url: "https://www.koscap.or.kr/v2/admission/regist_info", searchUrl: "https://www.koscap.or.kr/v2/music/search_list", applyUrl: "https://www.koscap.or.kr/", checkedAt, visible: true,
    sources: [{ title: "KOSCAP · 작품등록안내", url: "https://www.koscap.or.kr/v2/admission/regist_info" }, { title: "KOSCAP · 신탁계약안내", url: "https://www.koscap.or.kr/v2/admission/information" }, { title: "KOSCAP · 작품검색", url: "https://www.koscap.or.kr/v2/music/search_list" }, creationSource],
  },
  {
    id: "copyright_commission", name: "한국저작권위원회 · 법적 저작권 등록", kind: "copyright",
    introduction: "저작자·창작일 등 일정 사항이나 권리변동을 등록부에 공시하는 법적 제도입니다. 저작권은 창작으로 발생하며, 이 등록은 협회 작품 관리나 음악 서비스 발매와 별개입니다.",
    eligibility: "저작자·권리자 또는 신청 권한이 있는 대리인이 등록 목적과 종류를 검토합니다. 협회 가입 여부만으로 등록 완료나 미완료를 판단하지 않습니다.",
    preparation: ["저작물 제목·종류, 저작자, 창작일·공표일, 신청하는 권리와 보유한 증빙을 정리하세요.", "CROS에서 본인의 등록 종류별 신청서·제출물·본인인증 요구 사항을 확인하세요. 인증서와 민감한 제출서류는 기관에 직접 제출하세요."],
    steps: ["위원회 사업 → 저작권 등록에서 제도와 신청 방법을 확인하고 저작권등록시스템(CROS)으로 이동하세요.", "등록 상담·신청서 작성 → 등록 신청 및 해당 수수료 납부 → 등록 심사 순으로 진행합니다. 회원가입만으로 작품 등록이 완료되지 않습니다."],
    after: ["심사·보완 여부, 등록부 등재와 등록증 교부를 확인하세요. 제출 완료를 승인으로 기록하지 마세요.", "온사이드에는 법적 등록 업무로 구분하여 대상 저작물, 등록번호, 신청·등록일, 결과와 선택적 증빙을 기록하세요."],
    costNote: "공식 안내의 등록 절차에는 수수료 납부와 지방세가 포함됩니다. 유형별 실제 금액은 CROS에서 확인하세요. 온사이드는 비용을 대신 납부하거나 승인을 보장하지 않습니다.",
    url: "https://www.copyright.or.kr/business/registration/index.do", searchUrl: "https://www.cros.or.kr/", applyUrl: "https://www.cros.or.kr/", checkedAt, visible: true,
    sources: [{ title: "한국저작권위원회 · 저작권 등록", url: "https://www.copyright.or.kr/business/registration/index.do" }, creationSource],
  },
  {
    id: "fkmp", name: "한국음악실연자연합회 · 실연정보", kind: "performer",
    introduction: "보컬·코러스·악기 연주 등 실제 참여자와 녹음별 실연정보를 관리하는 업무입니다. 입회·위탁 상태와 작품별 실연정보 등록 상태를 분리합니다.",
    eligibility: "참여자 본인 또는 업무 관리 권한이 있는 담당자가 본인의 참여 범위만 확인합니다. 대표 아티스트가 등록되어 있어도 다른 참여자가 모두 등록된 것은 아닙니다.",
    preparation: ["참여자명·활동명, 대상 트랙·녹음 버전, 참여 역할, 앨범과 발매 정보를 정리하세요.", "공식 위탁안내·양식자료에서 본인에게 해당하는 자료를 확인하세요. 신분증·인증서·외부기관 비밀번호는 온사이드에 올리지 마세요."],
    steps: ["홈페이지 → 입회 및 저작인접권 → 위탁안내에서 관계를 확인하세요. 신규 입회는 기관에서 본인인증을 거칩니다.", "기존 회원은 기관 로그인 후 회원전용 → 신규작품신청 또는 실연 정보 등록으로 이동하세요. 로그인 이후 등록 화면과 개인 내역은 자동 조회하지 않습니다."],
    after: ["회원전용 작품조회에서 본인의 트랙·역할·처리 여부를 확인하세요. 기관 가입만으로 작품별 처리를 완료로 기록하지 마세요.", "온사이드에는 기관, 참여자, 역할, 대상 녹음·트랙, 신청일·처리일, 확인번호, 결과와 사용자 근거를 기록하세요."],
    costNote: "온사이드의 안내·기록 기능은 무료입니다. 기관의 적용 비용·조건은 공식 위탁안내에서 확인해야 하며 이 안내는 비용 면제를 뜻하지 않습니다.",
    url: "https://www.fkmp.kr/", searchUrl: "https://www.fkmp.kr/", applyUrl: "https://www.fkmp.kr/", checkedAt, visible: true,
    sources: [{ title: "음실련 · 회원전용 작품조회·실연정보 등록", url: "https://www.fkmp.kr/" }, { title: "음실련 · 온라인 입회신청", url: "https://www.fkmp.kr/entrust/Entrust/entrust1" }],
  },
  {
    id: "tj", name: "TJ · 일반 반주곡 신청·추천", kind: "karaoke",
    introduction: "TJ의 기존 수록곡과 신청곡을 확인하고 원하는 곡을 신청·추천하는 경로입니다. 신청 또는 추천은 실제 수록과 다릅니다. 금영 상태는 별도로 관리합니다.",
    eligibility: "원하는 노래의 수록을 확인하거나 신청하려는 이용자가 공식 신청 유의사항을 확인합니다.",
    preparation: ["정확한 곡명·가수명·녹음 버전과 앨범 정보를 정리하고, 이미 수록된 곡인지 먼저 검색하세요."],
    steps: ["반주곡 → 반주곡 검색에서 곡번호와 곡·가수·버전을 비교하세요.", "반주곡 신청 → 필독 사항 확인 → 기존 신청곡 확인으로 진행합니다. 이미 신청된 곡은 중복 신청 대신 기관의 추천 경로를 이용하며, 온사이드가 투표를 대신하지 않습니다."],
    after: ["신청 이후 반주곡 검색에서 실제 수록을 확인하세요. 추천 수가 많아도 저작권 승인·자료 검토 등으로 수록되지 않을 수 있습니다.", "온사이드에는 TJ, 일반 신청/추천 방식, 대상 트랙, 신청일·접수 URL, 수록곡 번호·확인일을 각각 기록하세요."],
    costNote: "일반 신청·추천과 유료곡 등록은 별도 경로입니다. 이 무료 업무 관리 서비스는 외부기관 비용을 제공하지 않으며 수록을 보장하지 않습니다.",
    url: "https://www.tjmedia.com/song/accompaniment_apply", searchUrl: "https://www.tjmedia.com/song/accompaniment", applyUrl: "https://www.tjmedia.com/song/accompaniment_apply", checkedAt, visible: true,
    sources: [{ title: "TJ · 반주곡 신청 전 필독 사항", url: "https://www.tjmedia.com/song/accompaniment_apply_agree" }],
  },
  {
    id: "tj_paid", name: "TJ · 유료곡 등록", kind: "karaoke",
    introduction: "일반 추천과 별도로 비용이 발생하는 TJ의 공식 유료곡 등록 경로입니다. 접수와 실제 수록 결과를 나누어 관리하세요.",
    eligibility: "공식 안내상 가수·저작자·제작자·팬·기업·단체 등 신청할 수 있습니다. 본인의 신청 권한과 대상 곡의 권리 문제는 기관과 확인하세요.",
    preparation: ["곡명·가수·앨범·버전과 권리 관계를 정리하세요. 필요한 자료, 견적과 계약 조건은 TJ의 공식 유료곡 상담 창구에 확인하세요."],
    steps: ["반주곡 → 유료곡 등록에서 조건을 읽고 직접 상담·신청하세요. 온사이드는 신청·결제를 실행하지 않습니다."],
    after: ["나의 접수내역에서 처리 상태를 확인하고, 수록 후 공식 반주곡 검색에서 곡번호를 확인하세요.", "TJ 업무 기록의 신청 방식을 유료 등록으로 구분하고 신청번호·날짜와 수록번호·확인일을 저장하세요."],
    costNote: "TJ 공식 안내는 일정 비용 발생과 내부 심사 후 거절 가능성을 명시합니다. 실제 금액·자료·일정은 기관 상담에서 확인하세요.",
    url: "https://www.tjmedia.com/support/paidsong", searchUrl: "https://www.tjmedia.com/song/accompaniment", applyUrl: "https://www.tjmedia.com/support/paidsong", checkedAt, visible: true,
    sources: [{ title: "TJ · 유료곡 등록", url: "https://www.tjmedia.com/support/paidsong" }],
  },
  {
    id: "ky", name: "금영 · 반주곡 신청·수록 확인", kind: "karaoke",
    introduction: "금영의 반주곡 신청 내역과 실제 수록을 확인합니다. TJ 신청·수록 결과는 금영에 자동 적용되지 않습니다.",
    eligibility: "금영 수록을 확인하거나 곡을 신청하려는 이용자가 공식 게시판·신청 안내를 확인합니다.",
    preparation: ["정확한 곡명·가수명·대상 버전, 앨범과 발매 정보를 정리하고 기존 수록곡을 검색하세요."],
    steps: ["금영엔터테인먼트 → 반주곡 → 반주곡 검색을 이용하세요. 현재 공식 메뉴는 K-VOICE 검색(kygabang.com)으로 연결됩니다.", "반주곡 → 반주곡 신청 게시판에서 기존 신청을 확인하고 기관의 최신 안내에 따라 직접 신청하세요."],
    after: ["게시글 접수와 실제 수록은 구분해야 합니다. 공식 검색에서 정확한 곡명·가수·곡번호를 확인한 뒤 결과를 기록하세요.", "온사이드에는 금영, 신청 방식, 대상 트랙, 신청일·게시글 URL, 수록곡 번호·확인 날짜와 사용자 근거를 남기세요."],
    costNote: "일반 반주곡 신청 게시판과 유료곡 등록 메뉴는 별개입니다. 확인된 공개 신청 페이지에는 확정 수록 보장이 없으므로 온사이드도 수록을 보장하지 않습니다. 적용 비용·조건은 기관에서 확인하세요.",
    url: "https://www.kyentertainment.kr/bbs/board.php?bo_table=qa_song", searchUrl: "https://kygabang.com/shop/", applyUrl: "https://www.kyentertainment.kr/bbs/board.php?bo_table=qa_song", checkedAt, visible: true,
    sources: [{ title: "금영 · 반주곡 신청 및 공식 검색 메뉴", url: "https://www.kyentertainment.kr/bbs/board.php?bo_table=qa_song" }, { title: "금영 K-VOICE · 노래검색", url: "https://kygabang.com/shop/" }],
  },
  {
    id: "ky_paid", name: "금영 · 유료곡 등록", kind: "karaoke",
    introduction: "금영의 일반 반주곡 신청과 별도로 안내되는 곡 등록 상담 경로입니다. 유료 접수와 수록 확인을 구분하세요.",
    eligibility: "공식 안내는 가수·작사/작곡가·팬클럽·소속사·단체 등의 활용을 소개합니다. 실제 신청 권한과 조건은 기관 상담에서 확인하세요.",
    preparation: ["곡명·가수·버전·앨범 및 권리 관계를 정리하고 필요한 자료·비용·신청 조건을 기관에 문의하세요. 미확인 필수서류나 금액을 온사이드에서 확정하지 않습니다."],
    steps: ["금영엔터테인먼트 → 플랫폼 → 유료곡 등록의 공식 상담 안내를 확인하고 직접 진행하세요."],
    after: ["기관의 접수·보완·처리 결과를 확인한 뒤 공식 반주곡 검색에서 수록 여부를 별도로 확인하세요.", "금영 업무에 유료 등록 방식, 접수 정보, 결과·곡번호·확인일을 기록하세요."],
    costNote: "공식 유료곡 등록 경로입니다. 공개 안내에서 확인되지 않은 견적·처리기간·수록 보장을 온사이드가 대신 약속하지 않습니다. 외부 비용은 무료 업무 관리에 포함되지 않습니다.",
    url: "https://www.kyentertainment.kr/w/platform/enrollment.php", searchUrl: "https://kygabang.com/shop/", applyUrl: "https://www.kyentertainment.kr/w/platform/enrollment.php", checkedAt, visible: true,
    sources: [{ title: "금영 · 유료곡 등록", url: "https://www.kyentertainment.kr/w/platform/enrollment.php" }],
  },
];

const officialHosts = new Set(["www.komca.or.kr", "www.koscap.or.kr", "www.copyright.or.kr", "www.cros.or.kr", "www.fkmp.kr", "www.tjmedia.com", "www.kyentertainment.kr", "kyentertainment.kr", "kysing.kr", "kygabang.com", "www.mcst.go.kr"]);
export function isOfficialAgencyUrl(value: string): boolean {
  try { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port && officialHosts.has(parsed.hostname); } catch { return false; }
}
