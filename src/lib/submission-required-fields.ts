import {
  isApplicationFormFile,
  isAudioUploadFile,
  isVideoUploadFile,
} from "@/lib/submission-files";

type SubmissionFileInput = {
  originalName?: string | null;
  mime?: string | null;
};

const hasText = (value?: string | null) => Boolean(value?.trim());

export const validateAlbumSubmittedFields = (input: {
  isAdminReviewer: boolean;
  externalApplicationForm: boolean;
  isOneClick: boolean;
  applicantName?: string | null;
  applicantEmail?: string | null;
  applicantPhone?: string | null;
  aiUsed?: boolean | null;
  melonUrl?: string | null;
  title?: string | null;
  artistName?: string | null;
  artistNameKr?: string | null;
  artistNameEn?: string | null;
  releaseDate?: string | null;
  genre?: string | null;
  distributor?: string | null;
  productionCompany?: string | null;
  previousRelease?: string | null;
  artistType?: string | null;
  artistGender?: string | null;
  artistMembers?: string | null;
  tracks: Array<{
    trackTitle?: string | null;
    performer?: string | null;
    composer?: string | null;
    isTitle?: boolean | null;
    broadcastSelected?: boolean | null;
  }>;
}) => {
  if (input.isAdminReviewer) return null;
  // In the downloaded-form flow the detailed album fields live in the
  // attached/email form. The wizard still requires the AI declaration.
  if (input.externalApplicationForm) {
    return typeof input.aiUsed === "boolean"
      ? null
      : "AI 활용 여부를 선택해주세요.";
  }
  if (
    !hasText(input.applicantName) ||
    !hasText(input.applicantEmail) ||
    !hasText(input.applicantPhone)
  ) {
    return "접수자 정보(이름/이메일/연락처)를 입력해주세요.";
  }
  if (typeof input.aiUsed !== "boolean") {
    return "AI 활용 여부를 선택해주세요.";
  }
  if (input.isOneClick) {
    return hasText(input.melonUrl) ? null : "멜론 링크를 입력해주세요.";
  }
  if (
    !hasText(input.title) ||
    !hasText(input.artistName) ||
    !hasText(input.artistNameKr) ||
    !hasText(input.artistNameEn)
  ) {
    return "앨범 제목 및 아티스트 정보를 모두 입력해주세요.";
  }
  if (!hasText(input.releaseDate)) return "발매일을 입력해주세요.";
  if (!hasText(input.genre)) return "장르를 선택해주세요.";
  if (!hasText(input.distributor) || !hasText(input.productionCompany)) {
    return "유통사/제작사를 입력해주세요.";
  }
  if (!hasText(input.previousRelease)) return "이전 발매곡을 입력해주세요.";
  if (!hasText(input.artistType) || !hasText(input.artistGender)) {
    return "그룹/솔로 및 성별 정보를 선택해주세요.";
  }
  if (input.artistType === "GROUP" && !hasText(input.artistMembers)) {
    return "그룹 팀원 전체 이름을 입력해주세요.";
  }
  if (input.tracks.length === 0) return "트랙 정보를 입력해주세요.";
  if (input.tracks.some((track) => !hasText(track.trackTitle))) {
    return "모든 트랙의 곡명을 입력해주세요.";
  }
  if (input.tracks.some((track) => !hasText(track.performer))) {
    return "모든 트랙의 가수명을 입력해주세요.";
  }
  if (input.tracks.some((track) => !hasText(track.composer))) {
    return "모든 트랙의 작곡 정보를 입력해주세요.";
  }
  const titleCount =
    input.tracks.length === 1
      ? 1
      : input.tracks.filter((track) => track.isTitle).length;
  if (titleCount === 0) {
    return "타이틀곡과 방송 심의 대상곡을 선택해주세요.";
  }
  if (
    input.tracks.length >= 4 &&
    input.tracks.filter((track) => track.broadcastSelected).length !== 3
  ) {
    return "수록곡이 4곡 이상인 경우 방송 심의 대상곡 3곡을 선택해주세요.";
  }
  return null;
};

export const validateMvSubmittedFields = (input: {
  isAdminReviewer: boolean;
  externalApplicationForm: boolean;
  aiUsed?: boolean | null;
  title?: string | null;
  artistName?: string | null;
  artistNameOfficial?: string | null;
  releaseDate?: string | null;
  director?: string | null;
  leadActor?: string | null;
  productionCompany?: string | null;
  agency?: string | null;
  albumTitle?: string | null;
  distributionCompany?: string | null;
  usage?: string | null;
  songTitleKr?: string | null;
  songTitleEn?: string | null;
  songTitleOfficial?: string | null;
  composer?: string | null;
  storyline?: string | null;
  lyrics?: string | null;
}) => {
  if (input.isAdminReviewer) return null;
  if (typeof input.aiUsed !== "boolean") {
    return "AI 활용 여부를 선택해주세요.";
  }
  // In the downloaded-form flow these fields live in the attached/email form.
  if (input.externalApplicationForm) return null;

  const required: Array<[string | null | undefined, string]> = [
    [input.title, "뮤직비디오 제목을 입력해주세요."],
    [input.artistName, "아티스트명을 입력해주세요."],
    [input.artistNameOfficial, "아티스트명 공식 표기를 입력해주세요."],
    [input.releaseDate, "영상 공개일자를 입력해주세요."],
    [input.director, "감독 정보를 입력해주세요."],
    [input.leadActor, "주연 정보를 입력해주세요."],
    [input.productionCompany, "뮤직비디오 제작사를 입력해주세요."],
    [input.agency, "소속사를 입력해주세요."],
    [input.albumTitle, "앨범명을 입력해주세요."],
    [input.distributionCompany, "유통사를 입력해주세요."],
    [input.usage, "용도를 입력해주세요."],
    [input.songTitleKr, "곡명(한글)을 입력해주세요."],
    [input.songTitleEn, "곡명(영문)을 입력해주세요."],
    [input.songTitleOfficial, "곡 정보 공식 표기를 입력해주세요."],
    [input.composer, "작곡자 정보를 입력해주세요."],
    [input.storyline, "줄거리 정보를 입력해주세요."],
    [input.lyrics, "가사를 입력해주세요."],
  ];
  return required.find(([value]) => !hasText(value))?.[1] ?? null;
};

export const validateSubmittedFiles = (input: {
  kind: "ALBUM" | "MV";
  isAdminReviewer: boolean;
  filesSubmittedByEmail: boolean;
  externalApplicationForm?: boolean;
  files: SubmissionFileInput[];
}) => {
  if (input.isAdminReviewer || input.filesSubmittedByEmail) return null;
  const hasMedia = input.files.some((file) =>
    input.kind === "ALBUM"
      ? isAudioUploadFile(file.originalName ?? "", file.mime ?? "")
      : isVideoUploadFile(file.originalName ?? "", file.mime ?? ""),
  );
  if (!hasMedia) {
    return input.kind === "ALBUM"
      ? "음원 파일(WAV/MP3/ZIP)을 업로드하거나 이메일 제출을 선택해주세요."
      : "영상 파일을 업로드하거나 이메일 제출을 선택해주세요.";
  }
  if (
    input.externalApplicationForm &&
    !input.files.some((file) =>
      isApplicationFormFile(file.originalName ?? ""),
    )
  ) {
    return "작성한 신청서 파일(HWP/DOC/DOCX)을 함께 업로드해주세요.";
  }
  return null;
};
