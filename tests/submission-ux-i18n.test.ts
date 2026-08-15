import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const translations = read(
  "src/components/i18n/english-language-pack.tsx",
);

const assertExactTranslations = (labels: readonly string[]) => {
  for (const label of labels) {
    assert.ok(
      translations.includes(`${JSON.stringify(label)}:`),
      `missing exact English translation for: ${label}`,
    );
  }
};

test("track table and checkpoint controls have exact English translations", () => {
  assertExactTranslations([
    "트랙 빠른 입력",
    "곡별 값은 표에서 비교하고, 가사와 타이틀 설정은 상세 편집에서 입력합니다.",
    "빈 참여진 채우기",
    "같은 참여진으로 추가",
    "빈 트랙 추가",
    "여러 트랙 붙여넣기",
    "Excel·Sheets의 곡명·가수명·작곡·작사·편곡 열을 그대로 붙여넣으세요. 입력된 열만 반영됩니다.",
    "붙여넣을 트랙 표",
    "곡명\t가수명\t작곡\t작사\t편곡\n첫 번째 곡\t가수 A\t작곡가\t작사가\t편곡가",
    "붙여넣은 내용이 여기에 반영됩니다.",
    "표에 적용",
    "트랙 표 입력",
    "트랙별 곡명, 가수명, 작곡, 작사, 편곡 빠른 입력",
    "작사",
    "편곡",
    "작업",
    "상세",
    "업로드가 어려우면 파일 없이 진행한 뒤",
    "로 보내주세요.",
    "실물 앨범을 발표했다면",
    "기기에 남아 있는 최신 입력을 지우고 서버 저장본을 사용할까요?",
    "복구본을 사용하지 않음",
    "현재 입력을 이전 저장본으로 되돌릴까요?",
    "이전 저장본 복원",
    "최근 입력 복구 가능",
    "복구",
    "서버 저장본 사용",
    "저장 중",
    "저장 실패",
    "기기에 저장됨",
    "저장됨",
    "재시도",
    "이전 저장본",
  ]);

  assert.match(
    translations,
    /node instanceof HTMLTextAreaElement[\s\S]*?NodeFilter\.FILTER_ACCEPT/,
    "textarea labels and placeholders should be translated without rewriting input",
  );
});

test("album and MV final-check issues have exact English translations", () => {
  assertExactTranslations([
    "최종 점검",
    "변경 확인",
    "필수 정보와 트랙별 크레딧",
    "트랙 수, 타이틀곡과 심의 대상곡",
    "음원·신청서 파일과 결제 금액 변경",
    "확인 완료",
    "수정이 필요한 항목",
    "제출 전 확인 권장",
    "확인을 권장하는 항목",
    "신청 정보를 모두 확인했습니다.",
    "점검 기준",
    "결제 금액 변경",
    "패키지 또는 결제 금액이 변경되었습니다. 변경 내용을 확인해주세요.",
    "심의 패키지를 선택해주세요.",
    "온라인 작성 또는 파일 제출 중 하나를 선택해주세요.",
    "이메일 형식을 확인해주세요.",
    "연락처는 숫자 9~11자리로 입력해주세요.",
    "AI 활용 여부",
    "AI 활용 여부를 선택해주세요.",
    "한 곡 이상 입력해주세요.",
    "곡명을 입력해주세요.",
    "이 트랙의 가수명을 입력해주세요.",
    "작곡자 정보를 입력해주세요.",
    "외국어 가사의 번역본을 입력해주세요.",
    "타이틀곡을 한 곡 이상 선택해주세요.",
    "수록곡이 4곡 이상이면 심의 대상곡 3곡을 선택해주세요.",
    "업로드에 실패한 파일을 다시 선택해주세요.",
    "파일 업로드가 끝날 때까지 기다려주세요.",
    "음원 파일을 업로드하거나 이메일 제출을 선택해주세요.",
    "작성한 신청서 파일을 함께 첨부해주세요.",
    "뮤직비디오 심의 목적을 선택해주세요.",
    "TV 송출 심의를 진행할 방송국을 선택해주세요.",
    "온라인 심의 옵션을 하나 이상 선택해주세요.",
    "심의 옵션 변경",
    "심의 옵션 또는 결제 금액이 변경되었습니다. 변경 내용을 확인해주세요.",
    "선택한 심의 옵션과 결제 금액을 확인해주세요.",
    "영상 파일을 업로드하거나 이메일 제출을 선택해주세요.",
    "작성한 신청서 파일을 영상과 함께 첨부해주세요.",
    "접수 ID를 확인하지 못했습니다.",
    "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.",
    "저장 중 오류가 발생했습니다.",
    "서버 저장이 지연되고 있습니다. 입력은 이 기기에 보관했습니다.",
    "옵션 수정",
    "선택 내역",
    "선택된 옵션이 없습니다.",
  ]);

  for (const title of [
    "접수자 이름",
    "접수자 이메일",
    "접수자 연락처",
    "멜론 링크",
    "앨범 제목",
    "아티스트명",
    "아티스트명(한글)",
    "아티스트명(영문)",
    "발매일",
    "장르",
    "유통사",
    "제작사",
    "이전 발매곡",
    "그룹/솔로",
    "성별",
    "그룹 팀원",
    "뮤직비디오 제목",
    "아티스트명 공식 표기",
    "영상 공개일자",
    "감독",
    "주연",
    "뮤직비디오 제작사",
    "소속사",
    "앨범명",
    "용도",
    "곡명(한글)",
    "곡명(영문)",
    "곡 정보 공식 표기",
    "작곡자",
    "줄거리",
    "가사",
    "담당자명",
    "이메일",
    "연락처",
  ]) {
    assertExactTranslations([`${title}을(를) 입력해주세요.`]);
  }
});

test("dynamic track, save, and file-match labels are translated before generic words", () => {
  for (const pattern of [
    "/확인 필요\\s*(\\d+)/g",
    "/확인 권장\\s*(\\d+)/g",
    "/(\\d+)\\/(\\d+)곡 연결/g",
    "/(\\d+)개 트랙 확인/g",
    "/트랙\\s*(\\d+)\\s*상세 편집/g",
    "/(\\d+)번 트랙 · 곡명/g",
    "/(\\d+)번 트랙 위로 이동/g",
    "/(\\d+)번 트랙 아래로 이동/g",
    "/(\\d+)번 트랙 삭제/g",
    "/(\\d+)\\.\\s*곡명 미입력/g",
    "/저장됨\\s*·\\s*(.+)/g",
    "/(\\d+)개 트랙에 음원\\s*(\\d+)개가 첨부되었습니다",
  ]) {
    assert.ok(
      translations.includes(pattern),
      `missing dynamic English translation pattern: ${pattern}`,
    );
  }
});
