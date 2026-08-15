import {
  isApplicationFormFile,
  isAudioUploadFile,
  isVideoUploadFile,
} from "@/lib/submission-files";
import { hasNonKoreanLyrics } from "@/lib/lyrics-tools";

export type SubmissionPreflightSeverity = "blocking" | "warning";

export type AlbumPreflightStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type MvPreflightStep = 1 | 2 | 3 | 4 | 5 | 6;

export type SubmissionPreflightTarget = {
  step: AlbumPreflightStep | MvPreflightStep;
  field: string;
  trackIndex?: number;
};

export type SubmissionPreflightIssue = {
  id: string;
  severity: SubmissionPreflightSeverity;
  title: string;
  message: string;
  target: SubmissionPreflightTarget;
  acknowledgementKey?: "cart-price-change";
  meta?: {
    previousAmountKrw?: number;
    currentAmountKrw?: number;
    previousPackageId?: string;
    currentPackageId?: string;
  };
};

export type AlbumPreflightTrack = {
  trackTitle?: string | null;
  performer?: string | null;
  composer?: string | null;
  lyrics?: string | null;
  translatedLyrics?: string | null;
  isTitle?: boolean | null;
  broadcastSelected?: boolean | null;
};

export type AlbumPreflightFile = {
  originalName?: string | null;
  mime?: string | null;
};

export type AlbumPreflightUpload = {
  name?: string | null;
  status: "pending" | "uploading" | "done" | "error";
};

export type MvPreflightFile = AlbumPreflightFile;
export type MvPreflightUpload = AlbumPreflightUpload;

export type ExistingCartSubmissionSnapshot = {
  submissionId: string;
  packageId?: string | null;
  amountKrw?: number | null;
};

export type ExistingMvCartSubmissionSnapshot = {
  submissionId: string;
  amountKrw?: number | null;
  selectedOptionCodes: string[];
  onlineBaseSelected: boolean;
};

export type AlbumSubmissionPreflightInput = {
  submissionId?: string | null;
  selectedPackageId?: string | null;
  amountKrw?: number | null;
  existingCartSubmission?: ExistingCartSubmissionSnapshot | null;
  priceChangeAcknowledged?: boolean;
  isAdminReviewer?: boolean;
  isOneClick: boolean;
  applicationFormMode: "online" | "upload" | null;
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
  tracks: AlbumPreflightTrack[];
  files: AlbumPreflightFile[];
  uploads?: AlbumPreflightUpload[];
  filesSubmittedByEmail: boolean;
};

export type SubmissionPreflightResult = {
  issues: SubmissionPreflightIssue[];
  blockingIssues: SubmissionPreflightIssue[];
  warnings: SubmissionPreflightIssue[];
  canSubmit: boolean;
  firstBlockingTarget: SubmissionPreflightTarget | null;
  requiresPriceChangeConfirmation: boolean;
};

export type MvSubmissionPreflightInput = {
  submissionId?: string | null;
  mvType: "MV_DISTRIBUTION" | "MV_BROADCAST" | null;
  applicationFormMode: "online" | "upload" | null;
  selectedOptionCodes: string[];
  onlineBaseSelected: boolean;
  amountKrw?: number | null;
  existingCartSubmission?: ExistingMvCartSubmissionSnapshot | null;
  priceChangeAcknowledged?: boolean;
  isAdminReviewer?: boolean;
  isGuest: boolean;
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
  aiUsed?: boolean | null;
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  files: MvPreflightFile[];
  uploads?: MvPreflightUpload[];
  filesSubmittedByEmail: boolean;
};

const hasText = (value?: string | null) => Boolean(value?.trim());

const isValidEmail = (value?: string | null) => {
  const email = value?.trim() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isValidPhone = (value?: string | null) => {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 9 && digits.length <= 11;
};

const normalizeAmount = (value?: number | null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
};

const issue = (
  id: string,
  severity: SubmissionPreflightSeverity,
  title: string,
  message: string,
  target: SubmissionPreflightTarget,
  extra?: Pick<
    SubmissionPreflightIssue,
    "acknowledgementKey" | "meta"
  >,
): SubmissionPreflightIssue => ({
  id,
  severity,
  title,
  message,
  target,
  ...extra,
});

const addRequiredTextIssue = (
  issues: SubmissionPreflightIssue[],
  value: string | null | undefined,
  config: {
    id: string;
    title: string;
    message?: string;
    field: string;
    step?: AlbumPreflightStep;
  },
) => {
  if (hasText(value)) return;
  issues.push(
    issue(
      config.id,
      "blocking",
      config.title,
      config.message ?? `${config.title}을(를) 입력해주세요.`,
      { step: config.step ?? 3, field: config.field },
    ),
  );
};

const addTrackIssue = (
  issues: SubmissionPreflightIssue[],
  trackIndex: number,
  field: string,
  title: string,
  message: string,
  severity: SubmissionPreflightSeverity = "blocking",
) => {
  issues.push(
    issue(
      `track.${trackIndex}.${field}`,
      severity,
      `${trackIndex + 1}번 트랙 · ${title}`,
      message,
      { step: 4, field, trackIndex },
    ),
  );
};

const addCartPriceChangeIssue = (
  issues: SubmissionPreflightIssue[],
  input: AlbumSubmissionPreflightInput,
) => {
  const existing = input.existingCartSubmission;
  if (
    !existing ||
    !input.submissionId ||
    existing.submissionId !== input.submissionId
  ) {
    return;
  }

  const previousPackageId = existing.packageId?.trim() ?? "";
  const currentPackageId = input.selectedPackageId?.trim() ?? "";
  const previousAmountKrw = normalizeAmount(existing.amountKrw);
  const currentAmountKrw = normalizeAmount(input.amountKrw);
  const packageChanged =
    Boolean(previousPackageId && currentPackageId) &&
    previousPackageId !== currentPackageId;
  const amountChanged =
    previousAmountKrw !== null &&
    currentAmountKrw !== null &&
    previousAmountKrw !== currentAmountKrw;

  if ((!packageChanged && !amountChanged) || input.priceChangeAcknowledged) {
    return;
  }

  issues.push(
    issue(
      "cart.price-change",
      "blocking",
      "결제 금액 변경",
      "패키지 또는 결제 금액이 변경되었습니다. 변경 내용을 확인해주세요.",
      { step: 1, field: "package" },
      {
        acknowledgementKey: "cart-price-change",
        meta: {
          previousAmountKrw: previousAmountKrw ?? undefined,
          currentAmountKrw: currentAmountKrw ?? undefined,
          previousPackageId: previousPackageId || undefined,
          currentPackageId: currentPackageId || undefined,
        },
      },
    ),
  );
};

/**
 * Builds the final-check list shown immediately before a submission is added
 * to the cart. It deliberately returns every actionable problem instead of a
 * single alert so the UI can take the user straight to the matching field.
 */
export const buildAlbumSubmissionPreflight = (
  input: AlbumSubmissionPreflightInput,
): SubmissionPreflightResult => {
  const issues: SubmissionPreflightIssue[] = [];
  const isAdminReviewer = Boolean(input.isAdminReviewer);
  const isDownloadedForm =
    !input.isOneClick && input.applicationFormMode === "upload";
  const isOnlineForm =
    !input.isOneClick && input.applicationFormMode === "online";

  if (!hasText(input.selectedPackageId)) {
    issues.push(
      issue(
        "package.required",
        "blocking",
        "패키지",
        "심의 패키지를 선택해주세요.",
        { step: 1, field: "package" },
      ),
    );
  }

  if (!input.isOneClick && input.applicationFormMode === null) {
    issues.push(
      issue(
        "application-mode.required",
        "blocking",
        "작성 방식",
        "온라인 작성 또는 파일 제출 중 하나를 선택해주세요.",
        { step: 2, field: "applicationFormMode" },
      ),
    );
  }

  if (!isAdminReviewer && !isDownloadedForm) {
    addRequiredTextIssue(issues, input.applicantName, {
      id: "applicant.name",
      title: "접수자 이름",
      field: "applicantName",
    });
    addRequiredTextIssue(issues, input.applicantEmail, {
      id: "applicant.email",
      title: "접수자 이메일",
      field: "applicantEmail",
    });
    if (hasText(input.applicantEmail) && !isValidEmail(input.applicantEmail)) {
      issues.push(
        issue(
          "applicant.email-format",
          "blocking",
          "접수자 이메일",
          "이메일 형식을 확인해주세요.",
          { step: 3, field: "applicantEmail" },
        ),
      );
    }
    addRequiredTextIssue(issues, input.applicantPhone, {
      id: "applicant.phone",
      title: "접수자 연락처",
      field: "applicantPhone",
    });
    if (hasText(input.applicantPhone) && !isValidPhone(input.applicantPhone)) {
      issues.push(
        issue(
          "applicant.phone-format",
          "blocking",
          "접수자 연락처",
          "연락처는 숫자 9~11자리로 입력해주세요.",
          { step: 3, field: "applicantPhone" },
        ),
      );
    }
    if (typeof input.aiUsed !== "boolean") {
      issues.push(
        issue(
          "ai-usage.required",
          "blocking",
          "AI 활용 여부",
          "AI 활용 여부를 선택해주세요.",
          { step: 3, field: "aiUsed" },
        ),
      );
    }

    if (input.isOneClick) {
      addRequiredTextIssue(issues, input.melonUrl, {
        id: "album.melon-url",
        title: "멜론 링크",
        field: "melonUrl",
      });
    } else if (isOnlineForm) {
      const basicFields: Array<{
        value?: string | null;
        id: string;
        title: string;
        field: string;
      }> = [
        { value: input.title, id: "album.title", title: "앨범 제목", field: "title" },
        {
          value: input.artistName,
          id: "album.artist-name",
          title: "아티스트명",
          field: "artistName",
        },
        {
          value: input.artistNameKr,
          id: "album.artist-name-kr",
          title: "아티스트명(한글)",
          field: "artistNameKr",
        },
        {
          value: input.artistNameEn,
          id: "album.artist-name-en",
          title: "아티스트명(영문)",
          field: "artistNameEn",
        },
        {
          value: input.releaseDate,
          id: "album.release-date",
          title: "발매일",
          field: "releaseDate",
        },
        { value: input.genre, id: "album.genre", title: "장르", field: "genre" },
        {
          value: input.distributor,
          id: "album.distributor",
          title: "유통사",
          field: "distributor",
        },
        {
          value: input.productionCompany,
          id: "album.production-company",
          title: "제작사",
          field: "productionCompany",
        },
        {
          value: input.previousRelease,
          id: "album.previous-release",
          title: "이전 발매곡",
          field: "previousRelease",
        },
        {
          value: input.artistType,
          id: "album.artist-type",
          title: "그룹/솔로",
          field: "artistType",
        },
        {
          value: input.artistGender,
          id: "album.artist-gender",
          title: "성별",
          field: "artistGender",
        },
      ];
      for (const field of basicFields) {
        addRequiredTextIssue(issues, field.value, field);
      }
      if (input.artistType === "GROUP") {
        addRequiredTextIssue(issues, input.artistMembers, {
          id: "album.artist-members",
          title: "그룹 팀원",
          field: "artistMembers",
        });
      }
    }
  }

  if (!isAdminReviewer && isDownloadedForm && typeof input.aiUsed !== "boolean") {
    issues.push(
      issue(
        "ai-usage.required",
        "blocking",
        "AI 활용 여부",
        "AI 활용 여부를 선택해주세요.",
        { step: 3, field: "aiUsed" },
      ),
    );
  }

  if (!isAdminReviewer && isOnlineForm) {
    if (input.tracks.length === 0) {
      issues.push(
        issue(
          "tracks.required",
          "blocking",
          "트랙 정보",
          "한 곡 이상 입력해주세요.",
          { step: 4, field: "tracks" },
        ),
      );
    }

    input.tracks.forEach((track, trackIndex) => {
      if (!hasText(track.trackTitle)) {
        addTrackIssue(
          issues,
          trackIndex,
          "trackTitle",
          "곡명",
          "곡명을 입력해주세요.",
        );
      }
      if (!hasText(track.performer)) {
        addTrackIssue(
          issues,
          trackIndex,
          "performer",
          "가수명",
          "이 트랙의 가수명을 입력해주세요.",
        );
      }
      if (!hasText(track.composer)) {
        addTrackIssue(
          issues,
          trackIndex,
          "composer",
          "작곡",
          "작곡자 정보를 입력해주세요.",
        );
      }
      if (
        hasNonKoreanLyrics(track.lyrics ?? "") &&
        !hasText(track.translatedLyrics)
      ) {
        addTrackIssue(
          issues,
          trackIndex,
          "translatedLyrics",
          "번역 가사",
          "외국어 가사의 번역본을 입력해주세요.",
        );
      }
    });

    const titleCount =
      input.tracks.length === 1
        ? 1
        : input.tracks.filter((track) => track.isTitle).length;
    if (input.tracks.length > 1 && titleCount === 0) {
      issues.push(
        issue(
          "tracks.title-required",
          "blocking",
          "타이틀곡",
          "타이틀곡을 한 곡 이상 선택해주세요.",
          { step: 4, field: "isTitle" },
        ),
      );
    }
    if (
      input.tracks.length >= 4 &&
      input.tracks.filter((track) => track.broadcastSelected).length !== 3
    ) {
      issues.push(
        issue(
          "tracks.broadcast-selection",
          "blocking",
          "방송 심의 대상곡",
          "수록곡이 4곡 이상이면 심의 대상곡 3곡을 선택해주세요.",
          { step: 4, field: "broadcastSelected" },
        ),
      );
    }
  }

  if (!isAdminReviewer) {
    const uploads = input.uploads ?? [];
    if (uploads.some((upload) => upload.status === "error")) {
      issues.push(
        issue(
          "files.upload-error",
          "blocking",
          "파일 업로드",
          "업로드에 실패한 파일을 다시 선택해주세요.",
          { step: 5, field: "files" },
        ),
      );
    } else if (
      uploads.some(
        (upload) => upload.status === "pending" || upload.status === "uploading",
      )
    ) {
      issues.push(
        issue(
          "files.upload-pending",
          "blocking",
          "파일 업로드",
          "파일 업로드가 끝날 때까지 기다려주세요.",
          { step: 5, field: "files" },
        ),
      );
    }

    if (!input.filesSubmittedByEmail) {
      const audioFiles = input.files.filter((file) =>
        isAudioUploadFile(file.originalName ?? "", file.mime ?? ""),
      );
      if (audioFiles.length === 0) {
        issues.push(
          issue(
            "files.audio-required",
            "blocking",
            "음원 파일",
            "음원 파일을 업로드하거나 이메일 제출을 선택해주세요.",
            { step: 5, field: "files" },
          ),
        );
      }

      if (
        isDownloadedForm &&
        !input.files.some((file) =>
          isApplicationFormFile(file.originalName ?? ""),
        )
      ) {
        issues.push(
          issue(
            "files.application-form-required",
            "blocking",
            "작성한 신청서",
            "작성한 신청서 파일을 함께 첨부해주세요.",
            { step: 5, field: "files" },
          ),
        );
      }

      const containsArchive = input.files.some((file) =>
        /\.zip$/i.test(file.originalName?.trim() ?? ""),
      );
      if (
        isOnlineForm &&
        input.tracks.length > 1 &&
        audioFiles.length > 0 &&
        !containsArchive &&
        audioFiles.length !== input.tracks.length
      ) {
        issues.push(
          issue(
            "files.track-count-mismatch",
            "warning",
            "트랙과 음원 수",
            `${input.tracks.length}개 트랙에 음원 ${audioFiles.length}개가 첨부되었습니다. 누락 또는 중복 여부를 확인해주세요.`,
            { step: 5, field: "files" },
          ),
        );
      }
    }
  }

  addCartPriceChangeIssue(issues, input);

  const blockingIssues = issues.filter(
    (item) => item.severity === "blocking",
  );
  const warnings = issues.filter((item) => item.severity === "warning");

  return {
    issues,
    blockingIssues,
    warnings,
    canSubmit: blockingIssues.length === 0,
    firstBlockingTarget: blockingIssues[0]?.target ?? null,
    requiresPriceChangeConfirmation: blockingIssues.some(
      (item) => item.acknowledgementKey === "cart-price-change",
    ),
  };
};

const buildPreflightResult = (
  issues: SubmissionPreflightIssue[],
): SubmissionPreflightResult => {
  const blockingIssues = issues.filter(
    (item) => item.severity === "blocking",
  );
  const warnings = issues.filter((item) => item.severity === "warning");

  return {
    issues,
    blockingIssues,
    warnings,
    canSubmit: blockingIssues.length === 0,
    firstBlockingTarget: blockingIssues[0]?.target ?? null,
    requiresPriceChangeConfirmation: blockingIssues.some(
      (item) => item.acknowledgementKey === "cart-price-change",
    ),
  };
};

/**
 * Produces the actionable final-check list for music-video submissions.
 * Server-side validation remains authoritative; this mirrors its required
 * fields so users can fix every problem before attempting a save.
 */
export const buildMvSubmissionPreflight = (
  input: MvSubmissionPreflightInput,
): SubmissionPreflightResult => {
  const issues: SubmissionPreflightIssue[] = [];
  const isAdminReviewer = Boolean(input.isAdminReviewer);
  const isDownloadedForm = input.applicationFormMode === "upload";
  const isOnlineForm = input.applicationFormMode === "online";

  if (!input.mvType) {
    issues.push(
      issue(
        "mv.purpose-required",
        "blocking",
        "심의 목적",
        "뮤직비디오 심의 목적을 선택해주세요.",
        { step: 1, field: "mvPurpose" },
      ),
    );
  } else if (
    input.mvType === "MV_BROADCAST" &&
    input.selectedOptionCodes.length === 0
  ) {
    issues.push(
      issue(
        "mv.broadcast-option-required",
        "blocking",
        "방송국",
        "TV 송출 심의를 진행할 방송국을 선택해주세요.",
        { step: 1, field: "reviewOptions" },
      ),
    );
  } else if (
    input.mvType === "MV_DISTRIBUTION" &&
    !input.onlineBaseSelected &&
    input.selectedOptionCodes.length === 0
  ) {
    issues.push(
      issue(
        "mv.distribution-option-required",
        "blocking",
        "심의 옵션",
        "온라인 심의 옵션을 하나 이상 선택해주세요.",
        { step: 1, field: "reviewOptions" },
      ),
    );
  }

  const amountKrw = normalizeAmount(input.amountKrw);
  if (amountKrw === null || amountKrw <= 0) {
    issues.push(
      issue(
        "mv.amount-required",
        "blocking",
        "결제 금액",
        "선택한 심의 옵션과 결제 금액을 확인해주세요.",
        { step: 1, field: "reviewOptions" },
      ),
    );
  }

  const existingCartSubmission = input.existingCartSubmission;
  if (
    existingCartSubmission &&
    input.submissionId &&
    existingCartSubmission.submissionId === input.submissionId &&
    !input.priceChangeAcknowledged
  ) {
    const normalizeOptionCodes = (codes: string[]) =>
      Array.from(
        new Set(codes.map((code) => code.trim()).filter(Boolean)),
      ).sort();
    const previousCodes = normalizeOptionCodes(
      existingCartSubmission.selectedOptionCodes,
    );
    const currentCodes = normalizeOptionCodes(input.selectedOptionCodes);
    const optionsChanged =
      previousCodes.length !== currentCodes.length ||
      previousCodes.some((code, index) => code !== currentCodes[index]) ||
      existingCartSubmission.onlineBaseSelected !== input.onlineBaseSelected;
    const previousAmountKrw = normalizeAmount(
      existingCartSubmission.amountKrw,
    );
    const amountChanged =
      previousAmountKrw !== null &&
      amountKrw !== null &&
      previousAmountKrw !== amountKrw;

    if (optionsChanged || amountChanged) {
      issues.push(
        issue(
          "mv.cart-price-change",
          "blocking",
          "심의 옵션 변경",
          "심의 옵션 또는 결제 금액이 변경되었습니다. 변경 내용을 확인해주세요.",
          { step: 1, field: "reviewOptions" },
          {
            acknowledgementKey: "cart-price-change",
            meta: {
              previousAmountKrw: previousAmountKrw ?? undefined,
              currentAmountKrw: amountKrw ?? undefined,
            },
          },
        ),
      );
    }
  }

  if (!input.applicationFormMode) {
    issues.push(
      issue(
        "mv.application-mode-required",
        "blocking",
        "작성 방식",
        "온라인 작성 또는 파일 제출 중 하나를 선택해주세요.",
        { step: 2, field: "applicationFormMode" },
      ),
    );
  }

  if (!isAdminReviewer && isOnlineForm) {
    const requiredFields: Array<{
      value?: string | null;
      id: string;
      title: string;
      field: string;
    }> = [
      { value: input.title, id: "mv.title", title: "뮤직비디오 제목", field: "title" },
      { value: input.artistName, id: "mv.artist-name", title: "아티스트명", field: "artistName" },
      {
        value: input.artistNameOfficial,
        id: "mv.artist-name-official",
        title: "아티스트명 공식 표기",
        field: "artistNameOfficial",
      },
      { value: input.releaseDate, id: "mv.release-date", title: "영상 공개일자", field: "releaseDate" },
      { value: input.director, id: "mv.director", title: "감독", field: "director" },
      { value: input.leadActor, id: "mv.lead-actor", title: "주연", field: "leadActor" },
      {
        value: input.productionCompany,
        id: "mv.production-company",
        title: "뮤직비디오 제작사",
        field: "productionCompany",
      },
      { value: input.agency, id: "mv.agency", title: "소속사", field: "agency" },
      { value: input.albumTitle, id: "mv.album-title", title: "앨범명", field: "albumTitle" },
      {
        value: input.distributionCompany,
        id: "mv.distribution-company",
        title: "유통사",
        field: "distributionCompany",
      },
      { value: input.usage, id: "mv.usage", title: "용도", field: "usage" },
      { value: input.songTitleKr, id: "mv.song-title-kr", title: "곡명(한글)", field: "songTitleKr" },
      { value: input.songTitleEn, id: "mv.song-title-en", title: "곡명(영문)", field: "songTitleEn" },
      {
        value: input.songTitleOfficial,
        id: "mv.song-title-official",
        title: "곡 정보 공식 표기",
        field: "songTitleOfficial",
      },
      { value: input.composer, id: "mv.composer", title: "작곡자", field: "composer" },
      { value: input.storyline, id: "mv.storyline", title: "줄거리", field: "storyline" },
      { value: input.lyrics, id: "mv.lyrics", title: "가사", field: "lyrics" },
    ];

    for (const field of requiredFields) {
      addRequiredTextIssue(issues, field.value, {
        ...field,
        step: 3,
      });
    }

    if (input.isGuest) {
      addRequiredTextIssue(issues, input.guestName, {
        id: "mv.guest-name",
        title: "담당자명",
        field: "guestName",
        step: 3,
      });
      addRequiredTextIssue(issues, input.guestEmail, {
        id: "mv.guest-email",
        title: "이메일",
        field: "guestEmail",
        step: 3,
      });
      if (hasText(input.guestEmail) && !isValidEmail(input.guestEmail)) {
        issues.push(
          issue(
            "mv.guest-email-format",
            "blocking",
            "이메일",
            "이메일 형식을 확인해주세요.",
            { step: 3, field: "guestEmail" },
          ),
        );
      }
      addRequiredTextIssue(issues, input.guestPhone, {
        id: "mv.guest-phone",
        title: "연락처",
        field: "guestPhone",
        step: 3,
      });
      if (hasText(input.guestPhone) && !isValidPhone(input.guestPhone)) {
        issues.push(
          issue(
            "mv.guest-phone-format",
            "blocking",
            "연락처",
            "연락처는 숫자 9~11자리로 입력해주세요.",
            { step: 3, field: "guestPhone" },
          ),
        );
      }
    }
  }

  if (
    !isAdminReviewer &&
    (isOnlineForm || isDownloadedForm) &&
    typeof input.aiUsed !== "boolean"
  ) {
    issues.push(
      issue(
        "mv.ai-usage-required",
        "blocking",
        "AI 활용 여부",
        "AI 활용 여부를 선택해주세요.",
        { step: 3, field: "aiUsed" },
      ),
    );
  }

  if (!isAdminReviewer && !input.filesSubmittedByEmail) {
    const uploads = input.uploads ?? [];
    if (uploads.some((upload) => upload.status === "error")) {
      issues.push(
        issue(
          "mv.files-upload-error",
          "blocking",
          "파일 업로드",
          "업로드에 실패한 파일을 다시 선택해주세요.",
          { step: 4, field: "files" },
        ),
      );
    } else if (
      uploads.some(
        (upload) =>
          upload.status === "pending" || upload.status === "uploading",
      )
    ) {
      issues.push(
        issue(
          "mv.files-upload-pending",
          "blocking",
          "파일 업로드",
          "파일 업로드가 끝날 때까지 기다려주세요.",
          { step: 4, field: "files" },
        ),
      );
    }

    if (
      !input.files.some((file) =>
        isVideoUploadFile(file.originalName ?? "", file.mime ?? ""),
      )
    ) {
      issues.push(
        issue(
          "mv.video-required",
          "blocking",
          "영상 파일",
          "영상 파일을 업로드하거나 이메일 제출을 선택해주세요.",
          { step: 4, field: "files" },
        ),
      );
    }

    if (
      isDownloadedForm &&
      !input.files.some((file) =>
        isApplicationFormFile(file.originalName ?? ""),
      )
    ) {
      issues.push(
        issue(
          "mv.application-form-required",
          "blocking",
          "작성한 신청서",
          "작성한 신청서 파일을 영상과 함께 첨부해주세요.",
          { step: 4, field: "files" },
        ),
      );
    }
  }

  return buildPreflightResult(issues);
};
