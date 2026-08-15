"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PendingOverlay } from "@/components/ui/pending-overlay";
import {
  applyAlbumTrackCreditsToBlankTracks,
  createAlbumTrackWithReusableCredits,
} from "@/lib/album-track-reuse";
import {
  getAlbumReviewDiscountPercentForPackage,
  getDiscountedAlbumPrice,
  normalizeAlbumDiscountPercent,
} from "@/lib/album-pricing";
import { showCenteredConfirm } from "@/lib/centered-dialog";
import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import {
  addGuestSubmissionCartEntries,
  toGuestTokensBySubmissionId,
} from "@/lib/guest-submission-cart";
import {
  cleanupInicisPaymentLayer,
  openInicisCardPopup,
} from "@/lib/inicis/popup";
import {
  isBusinessRegistrationFile,
  uploadSubmissionEtcFile,
} from "@/lib/submission-etc-upload";
import {
  buildInlineTranslatedLyrics,
  collectForeignLyricsSegments,
  hasNonKoreanLyrics,
  requestLyricsTranslations,
} from "@/lib/lyrics-tools";
import {
  albumApplicationForms,
  isApplicationFormFile,
  isApplicationFormMime,
  isAudioUploadFile,
} from "@/lib/submission-files";
import {
  buildProfanityExtraRules,
  buildLegacyProfanityMatchers,
  extractProfanityWords,
  type ProfanityTerm,
} from "@/lib/profanity/legacy";
import { runProfanityCheck } from "@/lib/profanity/check";

import {
  saveAlbumSubmissionAction,
  type SubmissionActionState,
} from "./actions";
import { AiUsageSelector } from "./ai-usage-selector";
import { ApplicationFormModeTabs } from "./application-form-mode-tabs";
import { SubmissionProgress } from "./submission-progress";
import { safeRandomUUID } from "@/lib/uuid";

declare global {
  interface Window {
    INIStdPay?: {
      pay: (formId: string) => void;
      close?: () => void;
      destroy?: () => void;
    };
  }
}

type StationOption = {
  id: string;
  name: string;
  code: string;
};

type PackageOption = {
  id: string;
  name: string;
  stationCount: number;
  priceKrw: number;
  description?: string | null;
  stations: StationOption[];
};

type TrackInput = {
  trackTitle: string;
  performer: string;
  featuring: string;
  composer: string;
  lyricist: string;
  arranger: string;
  lyrics: string;
  translatedLyrics: string;
  notes: string;
  isTitle: boolean;
  titleRole: "" | "MAIN" | "SUB";
  broadcastSelected: boolean;
};

type PaymentDocumentType = "" | "CASH_RECEIPT" | "TAX_INVOICE";
type CashReceiptPurpose =
  | ""
  | "PERSONAL_INCOME_DEDUCTION"
  | "BUSINESS_EXPENSE_PROOF";

type UploadItem = {
  name: string;
  size: number;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  path?: string;
  mime?: string;
};

type UploadResult = {
  path: string;
  originalName: string;
  mime?: string;
  size: number;
  checksum?: string;
  durationSeconds?: number;
  accessUrl?: string;
};

type ApplicationFormMode = "online" | "upload";

type DraftSnapshot = {
  draft: AlbumDraft;
  emailSubmitConfirmed: boolean;
};

const initialTrack: TrackInput = {
  trackTitle: "",
  performer: "",
  featuring: "",
  composer: "",
  lyricist: "",
  arranger: "",
  lyrics: "",
  translatedLyrics: "",
  notes: "",
  isTitle: false,
  titleRole: "",
  broadcastSelected: false,
};

const standardSteps = [
  "방송국 패키지 선택",
  "기본 정보",
  "트랙 정보",
  "파일 업로드",
  "결제",
  "접수 완료",
];

const compactSteps = [
  "방송국 패키지 선택",
  "기본 정보",
  "파일 업로드",
  "결제",
  "접수 완료",
];

const deferredPaymentNotice = "신청서를 장바구니에 담았습니다.";
const paymentFailureStorageNotice = "신청서는 장바구니에 보관됩니다.";
const paymentFailureDraftNotice =
  `결제에 실패했습니다. ${paymentFailureStorageNotice}`;
const usesSubmissionCartCheckout = true;

const selectedBadgeClass =
  "inline-flex items-center rounded-full border-2 border-[#111111] bg-[#111111] px-3 py-1 text-[11px] font-black tracking-normal text-[#f2cf27] shadow-[2px_2px_0_rgba(0,0,0,0.24)] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]";

const isReviewTestPackage = (name?: string | null) =>
  name?.startsWith("[테스트]") ?? false;
const formatPackageName = (count: number, isOneClick = false) =>
  `${isOneClick ? "원클릭 " : ""}${count}개 패키지`;
const getPackageDisplayName = (
  pkg: { name?: string | null; stationCount: number },
  isOneClick = false,
) =>
  isReviewTestPackage(pkg.name)
    ? (pkg.name ?? "테스트 패키지")
    : formatPackageName(pkg.stationCount, isOneClick);
const packageGuidance: Record<
  number,
  { recommendation: string; badge?: string; conditional?: string[] }
> = {
  3: {
    recommendation: "지상파 핵심만 빠르게 확인하고 싶은 경우",
  },
  7: {
    recommendation: "기본 방송 홍보용으로 부담 없이 시작하는 경우",
  },
  10: {
    recommendation: "전국·종교·교통방송까지 포함하는 기본 확장",
  },
  13: {
    recommendation: "라디오와 지역 방송까지 넓게 송출하려는 경우",
    badge: "가장 많이 선택",
  },
  15: {
    recommendation: "CCM·국악 등 특수 방송국까지 필요한 경우",
    conditional: ["극동방송: CCM 음원만 가능", "국악방송: 국악 장르만 가능"],
  },
};

const packageToneClasses = [
  {
    card: "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[4px_4px_0_#f2cf27]",
    chip: "border-[#111111]/30 bg-white/45 text-[#111111]",
  },
  {
    card: "border-[#111111] bg-[#1556a4] text-white shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f] dark:shadow-[4px_4px_0_#f2cf27]",
    chip: "border-white/30 bg-white/16 text-white dark:text-[#06111f]",
  },
  {
    card: "border-[#111111] bg-[#d9362c] text-white shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#ff6258] dark:text-[#111111] dark:shadow-[4px_4px_0_#f2cf27]",
    chip: "border-white/30 bg-white/16 text-white dark:text-[#111111]",
  },
  {
    card: "border-[#111111] bg-white text-[#111111] shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[4px_4px_0_#f2cf27]",
    chip: "border-[#111111]/30 bg-[#f2cf27] text-[#111111]",
  },
];

const uploadMaxMb = Number(
  process.env.NEXT_PUBLIC_AUDIO_UPLOAD_MAX_MB ??
  process.env.NEXT_PUBLIC_UPLOAD_MAX_MB ??
  "4096",
);
const uploadMaxBytes = uploadMaxMb * 1024 * 1024;
const directUploadMaxBytes = 128 * 1024 * 1024;
const albumMultipartThresholdBytes = 32 * 1024 * 1024;
const uploadMaxLabel =
  uploadMaxMb >= 1024
    ? `${Math.round(uploadMaxMb / 1024)}GB`
    : `${uploadMaxMb}MB`;
const draftDeleteTimeoutMs = 8000;
const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");
const adminReviewEmail =
  process.env.NEXT_PUBLIC_ADMIN_REVIEW_EMAIL ?? APP_CONFIG.supportEmail;

const genreOptions = [
  "댄스",
  "발라드",
  "성인가요",
  "락",
  "일렉트로닉",
  "RNB",
  "OST",
  "포크",
  "힙합",
  "모던락",
  "락발라드",
  "기타",
];

const lyricCautions = [
  "코러스, 나레이션, 반복하는 후렴을 포함하여 모든 가사를 수록해야 합니다.",
  "음원과 다르게 고의로 가사(욕설 및 선정성 문구 포함)를 누락하는 경우 심의가 불가하며, 향후 방송사에서 해당 음반기획사의 심의를 거부할 수 있습니다.",
  "외국어 가사에는 반드시 번역을 나란히 또는 번역본은 기재해주세요.",
  "심의요청서의 곡 순서와 CD 순서는 반드시 일치해야 합니다.",
  "실제 발매 앨범과 동일한 음원·가사·트랙수가 필요합니다. (예: 2트랙 앨범—AR 1곡 + INST 1곡—의 경우 INST까지 제출)",
];

const broadcastRequirementMessage =
  "타이틀곡 지정해 주시고 4곡 이상의 앨범일 경우 원음방송 심의를 위해 3곡 지정 해주세요. (원음방송은 앨범당 3곡만 심의가 가능합니다.)";

const oneClickPriceMap: Record<number, number> = {
  7: 100000,
  10: 130000,
  13: 150000,
  15: 170000,
};

type AlbumDraft = {
  submissionId: string;
  guestToken: string;
  title: string;
  artistName: string;
  artistNameKr: string;
  artistNameEn: string;
  releaseDate: string;
  genre: string;
  distributor: string;
  productionCompany: string;
  previousRelease: string;
  artistType: string;
  artistGender: string;
  artistMembers: string;
  melonUrl: string;
  aiUsed: boolean | null;
  tracks: TrackInput[];
  files: UploadResult[];
  emailSubmitConfirmed: boolean;
};

const getAlbumDraftGuestTokens = (drafts: AlbumDraft[]) =>
  toGuestTokensBySubmissionId(
    drafts.map((draft) => ({
      submissionId: draft.submissionId,
      guestToken: draft.guestToken,
    })),
  );

const getStoredAlbumDraftGuestTokens = (
  drafts: Array<Record<string, unknown>>,
  storedTokens: Record<string, string> = {},
  fallbackToken = "",
) =>
  toGuestTokensBySubmissionId(
    drafts.map((draft) => {
      const submissionId = String(draft.id ?? "");
      const rowToken =
        typeof draft.guest_token === "string" ? draft.guest_token : "";
      return {
        submissionId,
        guestToken: rowToken || storedTokens[submissionId] || fallbackToken,
      };
    }),
  );

export function AlbumWizard({
  packages,
  userId,
  userEmail,
  profanityTerms = [],
  profanityFilterV2Enabled = false,
  albumDiscountPercent = 0,
}: {
  packages: PackageOption[];
  userId?: string | null;
  userEmail?: string | null;
  profanityTerms?: ProfanityTerm[];
  profanityFilterV2Enabled?: boolean;
  albumDiscountPercent?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const localePrefix =
    pathname === "/en" || pathname.startsWith("/en/") ? "/en" : "";
  const isGuest = !userId;
  const isAdminReviewer =
    userEmail?.trim().toLowerCase() === adminReviewEmail.trim().toLowerCase();
  const isFromDraftsTab = searchParams?.get("from") === "drafts";
  const [step, setStep] = React.useState(1);
  const [isOneClick, setIsOneClick] = React.useState(false);
  const [applicationFormMode, setApplicationFormMode] =
    React.useState<ApplicationFormMode>("online");
  const [selectedPackage, setSelectedPackage] =
    React.useState<PackageOption | null>(packages[0] ?? null);
  const [tracks, setTracks] = React.useState<TrackInput[]>([initialTrack]);
  const [activeTrackIndex, setActiveTrackIndex] = React.useState(0);
  const [title, setTitle] = React.useState("");
  const [artistName, setArtistName] = React.useState("");
  const [artistNameKr, setArtistNameKr] = React.useState("");
  const [artistNameEn, setArtistNameEn] = React.useState("");
  const [releaseDate, setReleaseDate] = React.useState("");
  const [genreSelection, setGenreSelection] = React.useState("");
  const [genreCustom, setGenreCustom] = React.useState("");
  const [distributor, setDistributor] = React.useState("");
  const [productionCompany, setProductionCompany] = React.useState("");
  const [applicantName, setApplicantName] = React.useState("");
  const [applicantEmail, setApplicantEmail] = React.useState("");
  const [applicantPhone, setApplicantPhone] = React.useState("");
  const [previousRelease, setPreviousRelease] = React.useState("");
  const [artistType, setArtistType] = React.useState("");
  const [artistGender, setArtistGender] = React.useState("");
  const [artistMembers, setArtistMembers] = React.useState("");
  const [melonUrl, setMelonUrl] = React.useState("");
  const [aiUsed, setAiUsed] = React.useState<boolean | null>(null);
  const [paymentMethod, setPaymentMethod] = React.useState<"CARD" | "BANK">(
    "BANK",
  );
  const [bankDepositorName, setBankDepositorName] = React.useState("");
  const [paymentDocumentType, setPaymentDocumentType] =
    React.useState<PaymentDocumentType>("");
  const [cashReceiptPurpose, setCashReceiptPurpose] =
    React.useState<CashReceiptPurpose>("");
  const [cashReceiptPhone, setCashReceiptPhone] = React.useState("");
  const [cashReceiptBusinessNumber, setCashReceiptBusinessNumber] =
    React.useState("");
  const [taxInvoiceBusinessNumber, setTaxInvoiceBusinessNumber] =
    React.useState("");
  const [taxInvoiceCertificateFile, setTaxInvoiceCertificateFile] =
    React.useState<File | null>(null);
  const [taxInvoiceCertificateUpload, setTaxInvoiceCertificateUpload] =
    React.useState<UploadItem | null>(null);
  const [files, setFiles] = React.useState<File[]>([]);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadResult[]>([]);
  const [fileDigest, setFileDigest] = React.useState("");
  const [emailSubmitConfirmed, setEmailSubmitConfirmed] = React.useState(false);
  const [showCdInfo, setShowCdInfo] = React.useState(false);
  const [showOneclickNotice, setShowOneclickNotice] = React.useState(false);
  const [packageConfirmTarget, setPackageConfirmTarget] =
    React.useState<PackageOption | null>(null);
  const lyricsOverlayRef = React.useRef<HTMLDivElement | null>(null);
  const lyricsTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [lyricsToolApplied, setLyricsToolApplied] = React.useState<
    Record<number, boolean>
  >({});
  const [profanityCheckedMap, setProfanityCheckedMap] = React.useState<
    Record<number, boolean>
  >({});
  const [profanityHighlightMap, setProfanityHighlightMap] = React.useState<
    Record<number, boolean>
  >({});
  const [isTranslatingLyrics, setIsTranslatingLyrics] = React.useState(false);
  const [translationPanelOpenMap, setTranslationPanelOpenMap] = React.useState<
    Record<number, boolean>
  >({});
  const [isPreparingDraft, setIsPreparingDraft] = React.useState(false);
  const [isContinuingDownloadedApplication, setIsContinuingDownloadedApplication] =
    React.useState(false);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const draftErrorRef = React.useRef<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<SubmissionActionState>({});
  const [resumeChecked, setResumeChecked] = React.useState(false);
  const [resumePrompt, setResumePrompt] = React.useState<{
    drafts: Array<Record<string, unknown>>;
    storedGuestToken?: string;
    storedGuestTokensBySubmissionId?: Record<string, string>;
  } | null>(null);
  const [isClearingResumeDrafts, setIsClearingResumeDrafts] = React.useState(false);
  const resumePromptHandledRef = React.useRef(false);
  const draftInitAttemptedRef = React.useRef(false);
  const draftCreationPromiseRef = React.useRef<Promise<string | null> | null>(
    null,
  );

  const [isAddingAlbum, setIsAddingAlbum] = React.useState(false);
  const [completionId, setCompletionId] = React.useState<string | null>(null);
  const [completionTokens, setCompletionTokens] = React.useState<
    Array<{ token: string; title: string }>
  >([]);
  const [completionSubmissionIds, setCompletionSubmissionIds] = React.useState<
    string[]
  >([]);
  const [albumDrafts, setAlbumDrafts] = React.useState<AlbumDraft[]>([]);
  const [uploadDrafts, setUploadDrafts] = React.useState<AlbumDraft[] | null>(
    null,
  );
  const [uploadDraftIndex, setUploadDraftIndex] = React.useState(0);
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [baseDraftSnapshot, setBaseDraftSnapshot] =
    React.useState<DraftSnapshot | null>(null);
  const [currentSubmissionId, setCurrentSubmissionId] =
    React.useState<string | null>(null);
  const [currentGuestToken, setCurrentGuestToken] = React.useState(() =>
    safeRandomUUID(),
  );
  const currentGuestTokenRef = React.useRef(currentGuestToken);
  const draftStorageKey = React.useMemo(
    () => `onside:draft:album:${userId ?? "guest"}`,
    [userId],
  );
  const guestTokenStorageKey = React.useMemo(
    () => `onside:guest-token:album:${userId ?? "guest"}`,
    [userId],
  );
  const profanityMatchers = React.useMemo(
    () => buildLegacyProfanityMatchers(profanityTerms),
    [profanityTerms],
  );
  const profanityExtraRules = React.useMemo(
    () => buildProfanityExtraRules(profanityTerms),
    [profanityTerms],
  );
  const isProfanityFilterV2Enabled = Boolean(profanityFilterV2Enabled);
  const profanityPattern = profanityMatchers?.pattern ?? null;
  const profanityTestPattern = profanityMatchers?.testPattern ?? null;
  const activeTrack = tracks[activeTrackIndex] ?? tracks[0];
  const isDownloadedApplicationFlow = applicationFormMode === "upload";
  const hasTrackStep = !isOneClick && !isDownloadedApplicationFlow;
  const progressSteps = hasTrackStep ? standardSteps : compactSteps;
  const progressCurrentStep = hasTrackStep
    ? step
    : step <= 2
      ? step
      : step - 1;
  const profanityWords = extractProfanityWords(
    activeTrack.lyrics,
    profanityPattern,
  );
  const showLyricsToolNotice = Boolean(lyricsToolApplied[activeTrackIndex]);
  const showProfanityPanel = Boolean(profanityCheckedMap[activeTrackIndex]);
  const showProfanityOverlay =
    showProfanityPanel &&
    Boolean(profanityHighlightMap[activeTrackIndex]) &&
    profanityWords.length > 0;
  const needsTranslatedLyrics = hasNonKoreanLyrics(activeTrack.lyrics);
  const showTranslatedLyricsPanel =
    Boolean(translationPanelOpenMap[activeTrackIndex]) ||
    Boolean(activeTrack.translatedLyrics.trim()) ||
    needsTranslatedLyrics;

  const handleLyricsScroll = React.useCallback(
    (event: React.UIEvent<HTMLTextAreaElement>) => {
      if (lyricsOverlayRef.current) {
        lyricsOverlayRef.current.scrollTop = event.currentTarget.scrollTop;
      }
    },
    [],
  );
  const showLyricsTabs = showProfanityPanel;
  const requireSubmissionId = React.useCallback(() => {
    if (!currentSubmissionId) {
      throw new Error("접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
    return currentSubmissionId;
  }, [currentSubmissionId]);
  const genreValue =
    genreSelection === "기타" ? genreCustom.trim() : genreSelection;
  const titleCount = tracks.filter((track) => track.isTitle).length;
  const effectiveTitleCount = tracks.length === 1 ? 1 : titleCount;
  const broadcastCount = tracks.filter((track) => track.broadcastSelected)
    .length;
  const requiresBroadcastSelection = tracks.length >= 4;
  const normalizedAlbumDiscountPercent =
    normalizeAlbumDiscountPercent(albumDiscountPercent);
  const originalBasePriceKrw = selectedPackage
    ? isOneClick
      ? oneClickPriceMap[selectedPackage.stationCount] ??
      selectedPackage.priceKrw
      : selectedPackage.priceKrw
    : 0;
  const basePriceKrw = getDiscountedAlbumPrice(
    originalBasePriceKrw,
    normalizedAlbumDiscountPercent,
    selectedPackage?.stationCount ?? null,
  );
  const selectedAlbumDiscountPercent = getAlbumReviewDiscountPercentForPackage(
    normalizedAlbumDiscountPercent,
    selectedPackage?.stationCount ?? null,
  );
  const hasAlbumEventDiscount = selectedAlbumDiscountPercent > 0;
  const additionalPriceKrw = Math.round(basePriceKrw * 0.5);
  const additionalAlbumCount = albumDrafts.length;
  const totalAlbumCount = additionalAlbumCount + 1;
  const additionalAlbumTotalKrw = additionalAlbumCount * additionalPriceKrw;
  const originalTotalPriceKrw = totalAlbumCount * originalBasePriceKrw;
  const totalPriceKrw =
    basePriceKrw + additionalAlbumTotalKrw;
  const albumEventDiscountTotalKrw = hasAlbumEventDiscount
    ? totalAlbumCount * Math.max(0, originalBasePriceKrw - basePriceKrw)
    : 0;
  const additionalAlbumDiscountTotalKrw = additionalAlbumCount * Math.max(
    0,
    basePriceKrw - additionalPriceKrw,
  );
  const hasAdditionalAlbumDiscount = additionalAlbumDiscountTotalKrw > 0;
  const totalDisplayDiscountKrw = Math.max(
    0,
    originalTotalPriceKrw - totalPriceKrw,
  );
  const hasPaymentSummaryDiscount = totalDisplayDiscountKrw > 0;
  const selectionLocked = albumDrafts.length > 0;
  const selectedPackageSummary = selectedPackage
    ? {
      name: selectedPackage.name,
      stationCount: selectedPackage.stationCount,
      priceKrw: basePriceKrw,
    }
    : null;
  const albumFilesReady = uploadDrafts?.length
    ? uploadDrafts.every((draft, index) =>
      index === uploadDraftIndex
        ? uploadedFiles.length > 0 || emailSubmitConfirmed
        : draft.files.length > 0 || draft.emailSubmitConfirmed,
    )
    : uploadedFiles.length > 0 || emailSubmitConfirmed;
  const uploadStatusLabel = emailSubmitConfirmed
    ? "파일 없이 진행 선택"
    : uploads.some((upload) => upload.status === "uploading")
      ? "업로드 진행 중"
      : uploads.some((upload) => upload.status === "error")
        ? "업로드 실패 확인 필요"
        : uploadedFiles.length > 0
          ? `${uploadedFiles.length}개 업로드 완료`
          : "파일 필요";
  const albumPaymentReadiness = [
    {
      label: "심의 상품",
      value: selectedPackageSummary
        ? getPackageDisplayName(selectedPackageSummary, isOneClick)
        : "패키지 선택 필요",
      ready: Boolean(selectedPackageSummary),
    },
    {
      label: "신청서",
      value: `앨범 ${totalAlbumCount}건 저장됨`,
      ready: step >= 5 || Boolean(uploadDrafts?.length),
    },
    {
      label: "파일",
      value: uploadStatusLabel,
      ready: albumFilesReady,
    },
    {
      label: "결제 금액",
      value: `${formatCurrency(totalPriceKrw)}원`,
      ready: totalPriceKrw > 0,
    },
  ];
  const albumPaymentReady = albumPaymentReadiness.every((item) => item.ready);
  const albumPaymentBlockers = albumPaymentReadiness.filter((item) => !item.ready);
  const readDraftStorage = React.useCallback(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        ids?: string[];
        updatedAt?: number;
        guestToken?: string;
        guestTokensBySubmissionId?: Record<string, string>;
      };
    } catch {
      return null;
    }
  }, [draftStorageKey]);

  const writeDraftStorage = React.useCallback((payload: {
    ids: string[];
    guestToken?: string | null;
    guestTokensBySubmissionId?: Record<string, string>;
  }) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          ids: payload.ids,
          guestToken: payload.guestToken ?? null,
          guestTokensBySubmissionId:
            payload.guestTokensBySubmissionId ?? {},
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // ignore storage errors
    }
  }, [draftStorageKey]);

  const clearDraftStorage = React.useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {
      // ignore
    }
  }, [draftStorageKey]);

  const clearServerDrafts = React.useCallback(async (options: {
    ids?: string[];
    guestToken?: string | null;
    guestTokensBySubmissionId?: Record<string, string>;
  }) => {
    const ids = (options.ids ?? []).filter(Boolean);
    const payload: {
      type: "ALBUM";
      ids?: string[];
      guestToken?: string;
      guestTokensBySubmissionId?: Record<string, string>;
    } = {
      type: "ALBUM",
    };
    if (ids.length > 0) {
      payload.ids = ids;
    }
    if (isGuest) {
      const guestToken = options.guestToken ?? currentGuestToken;
      if (guestToken) payload.guestToken = guestToken;
      if (
        options.guestTokensBySubmissionId &&
        Object.keys(options.guestTokensBySubmissionId).length > 0
      ) {
        payload.guestTokensBySubmissionId =
          options.guestTokensBySubmissionId;
      }
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, draftDeleteTimeoutMs);

    try {
      const res = await fetch("/api/submissions/drafts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "임시저장 삭제에 실패했습니다.");
      }
    } catch (error) {
      const isAbortError =
        error instanceof DOMException && error.name === "AbortError";
      if (isAbortError) {
        throw new Error("임시저장 삭제 요청이 지연되어 중단되었습니다.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, [currentGuestToken, isGuest]);

  const createDraft = React.useCallback(async (options?: { force?: boolean }) => {
    if (currentSubmissionId) return currentSubmissionId;
    if (draftCreationPromiseRef.current) {
      return draftCreationPromiseRef.current;
    }
    if (!options?.force && draftInitAttemptedRef.current) {
      return currentSubmissionId;
    }
    draftInitAttemptedRef.current = true;
    const draftPromise = (async () => {
      setIsPreparingDraft(true);
      draftErrorRef.current = null;
      setDraftError(null);
      try {
        const res = await fetch("/api/submissions/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "ALBUM",
            guestToken: isGuest ? currentGuestTokenRef.current : undefined,
          }),
        });
        const json = (await res.json().catch(() => null)) as {
          submissionId?: string;
          guestToken?: string;
          error?: string;
        };
        if (res.ok && json?.submissionId) {
          if (isGuest && json.guestToken) {
            currentGuestTokenRef.current = json.guestToken;
            setCurrentGuestToken(json.guestToken);
          }
          setCurrentSubmissionId(json.submissionId);
          return json.submissionId;
        }
        const message =
          json?.error ||
          "접수 초안을 생성하지 못했습니다. 새로고침 후 다시 시도해주세요.";
        draftErrorRef.current = message;
        setDraftError(message);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "접수 초안을 생성하지 못했습니다. 새로고침 후 다시 시도해주세요.";
        draftErrorRef.current = message;
        setDraftError(message);
      } finally {
        setIsPreparingDraft(false);
      }
      return null;
    })();
    draftCreationPromiseRef.current = draftPromise;
    try {
      return await draftPromise;
    } finally {
      if (draftCreationPromiseRef.current === draftPromise) {
        draftCreationPromiseRef.current = null;
      }
    }
  }, [currentSubmissionId, isGuest]);

  React.useEffect(() => {
    currentGuestTokenRef.current = currentGuestToken;
  }, [currentGuestToken]);

  React.useEffect(() => {
    if (!resumeChecked) return;
    if (currentSubmissionId || isPreparingDraft) return;
    void createDraft();
  }, [createDraft, currentSubmissionId, isPreparingDraft, resumeChecked]);

  const shouldShowGuestLookup = isGuest || completionTokens.length > 0;
  const completionCodesToShow = shouldShowGuestLookup
    ? completionTokens.length > 0
      ? completionTokens
      : completionSubmissionIds.length > 0
        ? completionSubmissionIds.map((id, index) => ({
          token: id,
          title: albumDrafts[index]?.title || title || "앨범",
        }))
        : [{ token: currentGuestToken, title: title || "앨범" }]
    : [];

  React.useEffect(() => {
    if (!requiresBroadcastSelection) {
      setTracks((prev) => {
        if (!prev.some((track) => track.broadcastSelected)) {
          return prev;
        }
        return prev.map((track) => ({ ...track, broadcastSelected: false }));
      });
    }
  }, [requiresBroadcastSelection]);

  React.useEffect(() => {
    if (!searchParams) return;
    const mode = searchParams.get("mode");
    if (mode === "oneclick") {
      setIsOneClick(true);
      setShowOneclickNotice(true);
    }
  }, [searchParams]);

  const activePackageId = packageConfirmTarget?.id ?? selectedPackage?.id ?? null;
  const genderOptions =
    artistType === "GROUP"
      ? [
        { value: "", label: "선택" },
        { value: "MALE", label: "남성" },
        { value: "FEMALE", label: "여성" },
        { value: "MIXED", label: "혼성" },
      ]
      : [
        { value: "", label: "선택" },
        { value: "MALE", label: "남성" },
        { value: "FEMALE", label: "여성" },
      ];

  const handleConfirmPackage = () => {
    if (!packageConfirmTarget) return;
    setSelectedPackage(packageConfirmTarget);
    setPackageConfirmTarget(null);
    setStep(2);
  };

  const handleCancelPackage = () => setPackageConfirmTarget(null);

  React.useEffect(() => {
    if (artistType !== "GROUP" && artistGender === "MIXED") {
      setArtistGender("");
    }
  }, [artistGender, artistType]);

  React.useEffect(() => {
    if (!isGuest || typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(guestTokenStorageKey);
      if (stored && stored !== currentGuestToken) {
        currentGuestTokenRef.current = stored;
        setCurrentGuestToken(stored);
        return;
      }
      if (!stored) {
        window.localStorage.setItem(guestTokenStorageKey, currentGuestToken);
      }
    } catch {
      // ignore storage errors
    }
  }, [currentGuestToken, guestTokenStorageKey, isGuest]);

  React.useEffect(() => {
    if (!isGuest || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(guestTokenStorageKey, currentGuestToken);
    } catch {
      // ignore
    }
  }, [currentGuestToken, guestTokenStorageKey, isGuest]);

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof window === "undefined") return;
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const type = (data as { type?: string }).type;
      const payload = (data as { payload?: Record<string, unknown> }).payload ?? {};
      if (!type || !String(type).startsWith("INICIS:")) return;
      const status = String(type).replace("INICIS:", "");
      cleanupInicisPaymentLayer();
      const submissionIdFromMsg = (payload.submissionId as string | undefined) || currentSubmissionId;
      const guestTokenFromMsg = payload.guestToken as string | undefined;
      const guestPaymentToken = isGuest
        ? guestTokenFromMsg || currentGuestToken
        : guestTokenFromMsg;
      if (status === "SUCCESS") {
        clearDraftStorage();
        if (guestPaymentToken) {
          window.location.href = `${localePrefix}/track/${encodeURIComponent(guestPaymentToken)}?payment=success`;
        } else if (submissionIdFromMsg) {
          window.location.href = `${localePrefix}/dashboard/submissions/${encodeURIComponent(submissionIdFromMsg)}?payment=success`;
        }
        return;
      }
      if (status === "FAIL" || status === "CANCEL" || status === "ERROR") {
        const message =
          typeof payload.message === "string"
            ? `${payload.message} ${paymentFailureStorageNotice}`
            : paymentFailureDraftNotice;
        const paymentState = status.toLowerCase();
        if (guestPaymentToken) {
          window.location.href = `${localePrefix}/track/${encodeURIComponent(guestPaymentToken)}?payment=${paymentState}`;
          return;
        }
        if (submissionIdFromMsg) {
          window.location.href = `${localePrefix}/dashboard/submissions/${encodeURIComponent(submissionIdFromMsg)}?payment=${paymentState}`;
          return;
        }
        setNotice({ error: message });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [
    clearDraftStorage,
    currentGuestToken,
    currentSubmissionId,
    isGuest,
    localePrefix,
  ]);

  const stepLabels = (
    <SubmissionProgress
      steps={progressSteps}
      currentStep={progressCurrentStep}
    />
  );

  const updateTrack = <K extends keyof TrackInput>(
    index: number,
    field: K,
    value: TrackInput[K],
  ) => {
    setTracks((prev) =>
      prev.map((track, idx) =>
        idx === index ? { ...track, [field]: value } : track,
      ),
    );
  };

  const markLyricsToolApplied = (index: number) => {
    setLyricsToolApplied((prev) => ({ ...prev, [index]: true }));
  };

  const toggleTranslationPanel = () => {
    setTranslationPanelOpenMap((prev) => ({
      ...prev,
      [activeTrackIndex]: !showTranslatedLyricsPanel,
    }));
  };

  const renderProfanityPreview = (
    value: string,
    pattern?: RegExp | null,
    testPattern?: RegExp | null,
  ) => {
    if (!value || !pattern || !testPattern) return value;
    const parts = value.split(pattern);
    return parts.map((part, index) => {
      if (!part) return null;
      if (testPattern.test(part)) {
        return (
          <mark
            key={`${part}-${index}`}
            className="rounded bg-red-200/80 px-1 text-red-900 dark:bg-red-500/30 dark:text-red-100"
          >
            {part}
          </mark>
        );
      }
      return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    });
  };

  const handleProfanityCheck = async () => {
    const lyrics = activeTrack.lyrics.trim();
    if (!lyrics) return;
    const v1HasProfanity = profanityTestPattern
      ? profanityTestPattern.test(lyrics)
      : false;
    const { hasProfanity } = runProfanityCheck(lyrics, {
      v1HasProfanity,
      enableV2: isProfanityFilterV2Enabled,
      preferV2: isProfanityFilterV2Enabled,
      v2Options: { extraRules: profanityExtraRules },
    });
    if (hasProfanity) {
      const shouldProceed = await showCenteredConfirm(
        "욕설이 감지되었습니다. 욕설이 있는 경우 심의 부적격 가능성이 높습니다",
      );
      if (!shouldProceed) return;
    }
    setProfanityCheckedMap((prev) => ({
      ...prev,
      [activeTrackIndex]: true,
    }));
    setProfanityHighlightMap((prev) => ({
      ...prev,
      [activeTrackIndex]: hasProfanity,
    }));
    markLyricsToolApplied(activeTrackIndex);
  };

  const handleTranslateLyrics = async () => {
    const lyricsFromState = activeTrack.lyrics;
    const lyricsFromDom = lyricsTextareaRef.current?.value ?? "";
    const lyrics = lyricsFromDom || lyricsFromState;
    if (!lyrics.trim()) {
      setNotice({ error: "번역할 가사를 먼저 입력해주세요." });
      return;
    }
    const { lines, segmentMap, sentencesToTranslate } =
      collectForeignLyricsSegments(lyrics);
    if (!sentencesToTranslate.length) {
      setNotice({
        error: "한국어 외 언어 가사를 찾지 못했습니다. 번역 대상을 확인해주세요.",
      });
      return;
    }
    setIsTranslatingLyrics(true);
    try {
      const translations = await requestLyricsTranslations(sentencesToTranslate, {
        source: "auto",
        target: "ko",
      });
      const translatedLines = buildInlineTranslatedLyrics(
        lines,
        segmentMap,
        translations,
      );
      updateTrack(activeTrackIndex, "translatedLyrics", translatedLines.join("\n"));
      setTranslationPanelOpenMap((prev) => ({
        ...prev,
        [activeTrackIndex]: true,
      }));
      markLyricsToolApplied(activeTrackIndex);
    } catch (error) {
      console.error(error);
      setNotice({
        error: "자동번역 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsTranslatingLyrics(false);
    }
  };

  const setMainTitleTrack = (index: number) => {
    setTracks((prev) =>
      prev.map((track, idx) => {
        if (!track.isTitle) return track;
        if (idx === index) {
          return { ...track, isTitle: true, titleRole: "MAIN" };
        }
        return { ...track, titleRole: "SUB" };
      }),
    );
  };

  const toggleTitleTrack = (index: number) => {
    setTracks((prev) => {
      const next = prev.map((track) => ({ ...track }));
      const target = next[index];
      if (!target) return prev;

      if (target.isTitle) {
        const wasMain = target.titleRole === "MAIN";
        target.isTitle = false;
        target.titleRole = "";

        if (wasMain) {
          const fallbackIndex = next.findIndex(
            (track, idx) => idx !== index && track.isTitle,
          );
          if (fallbackIndex >= 0) {
            next[fallbackIndex].titleRole = "MAIN";
          }
        }
      } else {
        target.isTitle = true;
        const hasMain = next.some(
          (track, idx) => idx !== index && track.titleRole === "MAIN",
        );
        target.titleRole = hasMain ? "SUB" : "MAIN";
      }

      if (!next.some((track) => track.titleRole === "MAIN")) {
        const firstTitle = next.find((track) => track.isTitle);
        if (firstTitle) {
          firstTitle.titleRole = "MAIN";
        }
      }

      return next;
    });
  };

  const toggleBroadcastTrack = (index: number) => {
    setTracks((prev) => {
      const next = prev.map((track) => ({ ...track }));
      const target = next[index];
      if (!target) return prev;
      if (next.length < 4) {
        return prev;
      }
      const selectedCount = next.filter((track) => track.broadcastSelected)
        .length;
      const shouldLimit = next.length >= 4;
      if (!target.broadcastSelected && shouldLimit && selectedCount >= 3) {
        setNotice({
          error: "원음방송 심의는 3곡까지만 선택할 수 있습니다.",
        });
        return prev;
      }
      target.broadcastSelected = !target.broadcastSelected;
      return next;
    });
  };

  const addBlankTrack = () => {
    setTracks((prev) => {
      const next = [...prev, { ...initialTrack }];
      setActiveTrackIndex(next.length - 1);
      return next;
    });
  };

  const addTrackWithSameCredits = () => {
    setTracks((prev) => {
      const source = prev[activeTrackIndex] ?? prev[0] ?? initialTrack;
      const next = [
        ...prev,
        createAlbumTrackWithReusableCredits(initialTrack, source),
      ];
      setActiveTrackIndex(next.length - 1);
      return next;
    });
  };

  const applyCurrentCreditsToBlankTracks = () => {
    setTracks((prev) =>
      applyAlbumTrackCreditsToBlankTracks(prev, activeTrackIndex),
    );
  };

  const removeTrack = (index: number) => {
    setTracks((prev) => {
      const removed = prev[index];
      const next = prev.filter((_, idx) => idx !== index);
      if (removed?.titleRole === "MAIN") {
        const fallback = next.find((track) => track.isTitle);
        if (fallback) {
          fallback.titleRole = "MAIN";
        }
      }
      setActiveTrackIndex((prevIndex) => {
        const nextIndex =
          prevIndex > index ? prevIndex - 1 : prevIndex === index ? 0 : prevIndex;
        return Math.min(nextIndex, Math.max(0, next.length - 1));
      });
      return next;
    });
  };

  const [isDraggingOver, setIsDraggingOver] = React.useState(false);

  const addFiles = (selected: File[]) => {
    if (!currentSubmissionId) {
      setNotice({
        error:
          draftError ||
          "신청 정보를 준비하는 중입니다. 잠시 후 다시 시도해주세요. 업로드가 계속 어려우면 예전 온사이드 사이트에서도 동일하게 접수할 수 있습니다.",
      });
      void createDraft({ force: true });
      return;
    }
    let invalidNotice: string | null = null;
    const filtered = selected.filter((file) => {
      if (file.size > uploadMaxBytes) {
        invalidNotice = `파일 용량은 ${uploadMaxLabel} 이하만 가능합니다.`;
        return false;
      }
      const isAllowed =
        isAudioUploadFile(file.name, file.type) ||
        isApplicationFormFile(file.name) ||
        isApplicationFormMime(file.type);
      if (!isAllowed) {
        invalidNotice =
          "WAV, MP3, ZIP 또는 신청서 파일(HWP/DOC/DOCX)만 업로드할 수 있습니다.";
        return false;
      }
      return true;
    });
    if (filtered.length === 0) {
      if (invalidNotice) {
        setNotice({ error: invalidNotice });
      }
      return;
    }

    const nextFileEntries: File[] = [];
    const seenFileKeys = new Set<string>();
    [...files, ...filtered].forEach((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (seenFileKeys.has(key)) return;
      seenFileKeys.add(key);
      nextFileEntries.push(file);
    });

    const existingMap = new Map<string, UploadItem>();
    uploads.forEach((item) => {
      existingMap.set(`${item.name}-${item.size}`, item);
    });
    const nextUploads = nextFileEntries.map((file) => {
      const key = `${file.name}-${file.size}`;
      return (
        existingMap.get(key) ?? {
          name: file.name,
          size: file.size,
          progress: 0,
          status: "pending" as const,
          mime: file.type,
        }
      );
    });
    setNotice({});
    setFiles(nextFileEntries);
    setUploads(nextUploads);
    setFileDigest("");
    setEmailSubmitConfirmed(false);
    setUploadDrafts((prev) => {
      if (!prev) return prev;
      return prev.map((draft, index) =>
        index === uploadDraftIndex
          ? { ...draft, emailSubmitConfirmed: false }
          : draft,
      );
    });
    void uploadFiles(nextFileEntries, nextUploads).catch((error: unknown) => {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "파일 업로드 중 오류가 발생했습니다.";
      console.error("[AlbumUpload] upload failed", error);
      setNotice({ error: message });
    });
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    addFiles(selected);
  };

  const onDropFiles = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length === 0) return;
    setIsDraggingOver(false);
    addFiles(dropped);
  };

  const handleTaxInvoiceCertificateChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!isBusinessRegistrationFile(file.name, file.type)) {
      setNotice({
        error: "사업자등록증은 PDF, JPG, PNG, WEBP 파일로 첨부해주세요.",
      });
      return;
    }
    setTaxInvoiceCertificateFile(file);
    setTaxInvoiceCertificateUpload({
      name: file.name,
      size: file.size,
      progress: 0,
      status: "pending",
      mime: file.type,
    });
    setNotice({});
  };

  const clearTaxInvoiceCertificate = () => {
    setTaxInvoiceCertificateFile(null);
    setTaxInvoiceCertificateUpload(null);
  };

  const uploadTaxInvoiceCertificateForSubmission = async (
    submissionId: string,
    titleForUpload: string,
  ) => {
    if (!taxInvoiceCertificateFile) return null;
    setTaxInvoiceCertificateUpload({
      name: taxInvoiceCertificateFile.name,
      size: taxInvoiceCertificateFile.size,
      progress: 0,
      status: "uploading",
      mime: taxInvoiceCertificateFile.type,
    });
    try {
      const uploaded = await uploadSubmissionEtcFile({
        file: taxInvoiceCertificateFile,
        submissionId,
        guestToken: isGuest ? currentGuestTokenRef.current : undefined,
        title: `${titleForUpload || "tax-invoice"}-business-registration`,
        onProgress: (progress) =>
          setTaxInvoiceCertificateUpload({
            name: taxInvoiceCertificateFile.name,
            size: taxInvoiceCertificateFile.size,
            progress,
            status: "uploading",
            mime: taxInvoiceCertificateFile.type,
          }),
      });
      setTaxInvoiceCertificateUpload({
        name: taxInvoiceCertificateFile.name,
        size: taxInvoiceCertificateFile.size,
        progress: 100,
        status: "done",
        path: uploaded.path,
        mime: taxInvoiceCertificateFile.type,
      });
      return uploaded;
    } catch (error) {
      setTaxInvoiceCertificateUpload({
        name: taxInvoiceCertificateFile.name,
        size: taxInvoiceCertificateFile.size,
        progress: 0,
        status: "error",
        mime: taxInvoiceCertificateFile.type,
      });
      const message =
        error instanceof Error && error.message
          ? error.message
          : "사업자등록증 업로드 중 오류가 발생했습니다.";
      setNotice({ error: message });
      throw new Error(message);
    }
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  const getMultipartConcurrency = () => {
    if (
      typeof navigator !== "undefined" &&
      /iphone|ipad|ipod|android|mobile/i.test(navigator.userAgent)
    ) {
      return 3;
    }
    const cores =
      typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 8 : 8;
    if (cores >= 12) return 8;
    if (cores >= 8) return 7;
    return 6;
  };

  const putBlobWithProgress = (
    url: string,
    blob: Blob,
    onProgress: (loaded: number, total: number) => void,
  ) =>
    new Promise<string | null>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        onProgress(event.loaded, event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.getResponseHeader("ETag"));
          return;
        }
        reject(new Error(`Upload failed (status ${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Upload failed (network/CORS)"));
      xhr.open("PUT", url);
      xhr.send(blob);
    });

  type MultipartResumeState = {
    grantId: string;
    uploadId: string;
    key: string;
    partSize: number;
    parts: Record<number, string>;
    createdAt: number;
  };

  const buildMultipartResumeKey = (submissionId: string, file: File) =>
    `album-multipart:${submissionId}:${file.name}:${file.size}:${file.lastModified}`;

  const loadMultipartResumeState = (
    resumeKey: string,
  ): MultipartResumeState | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(resumeKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MultipartResumeState;
      if (!parsed.grantId || !parsed.uploadId || !parsed.key || !parsed.partSize) {
        window.localStorage.removeItem(resumeKey);
        return null;
      }
      if (Date.now() - (parsed.createdAt ?? 0) > 24 * 60 * 60 * 1_000) {
        window.localStorage.removeItem(resumeKey);
        return null;
      }
      return parsed;
    } catch {
      window.localStorage.removeItem(resumeKey);
      return null;
    }
  };

  const saveMultipartResumeState = (
    resumeKey: string,
    state: MultipartResumeState,
  ) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(resumeKey, JSON.stringify(state));
    } catch {
      // Upload remains usable when private browsing disables localStorage.
    }
  };

  const clearMultipartResumeState = (resumeKey: string) => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(resumeKey);
  };

  const presignMultipartParts = async (params: {
    grantId: string;
    resumeKey: string;
    submissionId: string;
    key: string;
    uploadId: string;
    partNumbers: number[];
  }) => {
    const urlMap = new Map<number, string>();
    for (let index = 0; index < params.partNumbers.length; index += 100) {
      const partNumbers = params.partNumbers.slice(index, index + 100);
      const response = await fetch("/api/uploads/multipart/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grantId: params.grantId,
          submissionId: params.submissionId,
          key: params.key,
          uploadId: params.uploadId,
          partNumbers,
          guestToken: isGuest ? currentGuestTokenRef.current : undefined,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        urls?: Array<{ partNumber: number; url: string }>;
        error?: string;
      };
      if (!response.ok || !json.urls) {
        if ([400, 403, 409, 410].includes(response.status)) {
          clearMultipartResumeState(params.resumeKey);
        }
        throw new Error(json.error || "업로드 URL을 생성할 수 없습니다.");
      }
      json.urls.forEach((item) => urlMap.set(item.partNumber, item.url));
    }
    return urlMap;
  };

  const uploadMultipartAudioFile = async (
    file: File,
    onProgress: (percent: number) => void,
  ) => {
    const submissionId = requireSubmissionId();
    const mimeType = file.type || "application/octet-stream";
    const resumeKey = buildMultipartResumeKey(submissionId, file);
    const resumeState = loadMultipartResumeState(resumeKey);

    let grantId = resumeState?.grantId ?? null;
    let uploadId = resumeState?.uploadId ?? null;
    let key = resumeState?.key ?? null;
    let partSize = resumeState?.partSize ?? null;

    if (!grantId || !uploadId || !key || !partSize) {
      const initResponse = await fetch("/api/uploads/multipart/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          kind: "audio",
          filename: file.name,
          mimeType,
          sizeBytes: file.size,
          guestToken: isGuest ? currentGuestTokenRef.current : undefined,
          title: title.trim() || undefined,
        }),
      });
      const initJson = (await initResponse.json().catch(() => ({}))) as {
        grantId?: string;
        key?: string;
        uploadId?: string;
        partSize?: number;
        error?: string;
      };
      if (
        !initResponse.ok ||
        !initJson.grantId ||
        !initJson.key ||
        !initJson.uploadId ||
        !initJson.partSize
      ) {
        throw new Error(
          initJson.error || "대용량 음원 업로드를 시작할 수 없습니다.",
        );
      }
      grantId = initJson.grantId;
      uploadId = initJson.uploadId;
      key = initJson.key;
      partSize = initJson.partSize;
      saveMultipartResumeState(resumeKey, {
        grantId,
        uploadId,
        key,
        partSize,
        parts: {},
        createdAt: Date.now(),
      });
    }

    const partCount = Math.ceil(file.size / partSize);
    const uploadedParts: Record<number, string> = {
      ...(resumeState?.parts ?? {}),
    };
    const partsToUpload: number[] = [];
    let totalLoaded = 0;
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      if (uploadedParts[partNumber]) {
        const start = (partNumber - 1) * partSize;
        totalLoaded += Math.min(partSize, file.size - start);
      } else {
        partsToUpload.push(partNumber);
      }
    }
    if (totalLoaded > 0) {
      onProgress(Math.min(100, Math.round((totalLoaded / file.size) * 100)));
    }

    const urlMap =
      partsToUpload.length > 0
        ? await presignMultipartParts({
            grantId,
            resumeKey,
            submissionId,
            key,
            uploadId,
            partNumbers: partsToUpload,
          })
        : new Map<number, string>();
    const partProgress = new Map<number, number>();
    const partsResult: Array<{ partNumber: number; etag: string } | null> =
      Array.from({ length: partCount }, () => null);
    Object.entries(uploadedParts).forEach(([partNumber, etag]) => {
      const index = Number(partNumber) - 1;
      if (index >= 0 && index < partsResult.length) {
        partsResult[index] = { partNumber: Number(partNumber), etag };
      }
    });

    let cursor = 0;
    const uploadPart = async (partNumber: number) => {
      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const blob = file.slice(start, end);
      for (let attempt = 0; attempt <= 5; attempt += 1) {
        let url = urlMap.get(partNumber);
        if (!url) {
          const refreshed = await presignMultipartParts({
            grantId,
            resumeKey,
            submissionId,
            key,
            uploadId,
            partNumbers: [partNumber],
          });
          url = refreshed.get(partNumber);
          if (url) urlMap.set(partNumber, url);
        }
        if (!url) throw new Error("업로드 URL을 생성할 수 없습니다.");
        try {
          const etagRaw = await putBlobWithProgress(
            url,
            blob,
            (loaded, total) => {
              const previous = partProgress.get(partNumber) ?? 0;
              const boundedLoaded = Math.min(loaded, total);
              partProgress.set(partNumber, boundedLoaded);
              totalLoaded += boundedLoaded - previous;
              onProgress(
                Math.min(100, Math.round((totalLoaded / file.size) * 100)),
              );
            },
          );
          const etag = etagRaw?.replace(/\"/g, "") ?? "";
          if (!etag) {
            throw new Error("ETag를 확인할 수 없습니다. CORS 설정을 확인해주세요.");
          }
          uploadedParts[partNumber] = etag;
          partsResult[partNumber - 1] = { partNumber, etag };
          saveMultipartResumeState(resumeKey, {
            grantId,
            uploadId,
            key,
            partSize,
            parts: uploadedParts,
            createdAt: Date.now(),
          });
          return;
        } catch (error) {
          if (attempt >= 5) throw error;
          await sleep(Math.min(2_000, 400 * 2 ** attempt));
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(getMultipartConcurrency(), partsToUpload.length) },
      async () => {
        while (cursor < partsToUpload.length) {
          const partNumber = partsToUpload[cursor];
          cursor += 1;
          await uploadPart(partNumber);
        }
      },
    );
    await Promise.all(workers);

    const completeResponse = await fetch("/api/uploads/multipart/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grantId,
        submissionId,
        key,
        uploadId,
        parts: partsResult.filter(
          (part): part is { partNumber: number; etag: string } => Boolean(part),
        ),
        filename: file.name,
        mimeType,
        sizeBytes: file.size,
        kind: "AUDIO",
        guestToken: isGuest ? currentGuestTokenRef.current : undefined,
      }),
    });
    const completeJson = (await completeResponse.json().catch(() => ({}))) as {
      key?: string;
      error?: string;
    };
    if (!completeResponse.ok || !completeJson.key) {
      if ([400, 403, 409, 410].includes(completeResponse.status)) {
        clearMultipartResumeState(resumeKey);
      }
      throw new Error(completeJson.error || "업로드 확인에 실패했습니다.");
    }

    clearMultipartResumeState(resumeKey);
    return { objectKey: completeJson.key };
  };

  const uploadWithProgress = async (
    file: File,
    onProgress: (percent: number) => void,
  ) => {
    const submissionId = requireSubmissionId();
    const mimeType = file.type || "application/octet-stream";
    const isApplicationFormUpload =
      isApplicationFormFile(file.name) || isApplicationFormMime(file.type);
    const completeUpload = async (objectKey: string) => {
      const completeRes = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          kind: "audio",
          key: objectKey,
          filename: file.name,
          mimeType,
          sizeBytes: file.size,
          guestToken: isGuest ? currentGuestTokenRef.current : undefined,
        }),
      });
      const completeJson = (await completeRes.json().catch(() => ({}))) as {
        key?: string;
        error?: string;
      };
      if (!completeRes.ok || !completeJson.key) {
        throw new Error(completeJson.error || "업로드 확인에 실패했습니다.");
      }
      return { objectKey: completeJson.key };
    };
    const directUploadFallback = () => {
      if (file.size > directUploadMaxBytes) {
        return Promise.reject(
          new Error(
            "128MB를 초과한 파일은 보안 업로드 URL로만 전송할 수 있습니다. 네트워크를 확인한 뒤 다시 시도해주세요.",
          ),
        );
      }
      return new Promise<{ objectKey: string }>((resolve, reject) => {
        const formData = new FormData();
        formData.append("submissionId", submissionId);
        formData.append("filename", file.name);
        formData.append("mimeType", mimeType);
        formData.append("sizeBytes", String(file.size));
        formData.append("kind", "audio");
        if (isGuest && currentGuestTokenRef.current) {
          formData.append("guestToken", currentGuestTokenRef.current);
        }
        if (title.trim()) formData.append("title", title.trim());
        formData.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        };
        xhr.onload = () => {
          let json: { objectKey?: string; error?: string } | null = null;
          try {
            json = JSON.parse(xhr.responseText) as {
              objectKey?: string;
              error?: string;
            };
          } catch {
            json = null;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            if (json?.objectKey) {
              resolve({ objectKey: json.objectKey });
              return;
            }
            reject(new Error(json?.error || "Upload failed"));
            return;
          }
          reject(new Error(json?.error || `Upload failed (status ${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error("Upload failed (network/CORS)"));
        xhr.open("POST", "/api/uploads/direct");
        xhr.send(formData);
      });
    };

    if (isApplicationFormUpload) {
      const directUpload = await directUploadFallback();
      return completeUpload(directUpload.objectKey);
    }

    if (file.size >= albumMultipartThresholdBytes) {
      return uploadMultipartAudioFile(file, onProgress);
    }

    let initRes: Response | null = null;
    let initJson: {
      key?: string;
      uploadUrl?: string;
      headers?: Record<string, string>;
      error?: string;
    } = {};
    for (let attempt = 0; attempt < 3; attempt += 1) {
      initRes = await fetch("/api/uploads/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          kind: "audio",
          filename: file.name,
          mimeType,
          sizeBytes: file.size,
          guestToken: isGuest ? currentGuestTokenRef.current : undefined,
          title: title.trim() || undefined,
        }),
      });
      initJson = (await initRes.json().catch(() => ({}))) as typeof initJson;
      if (initRes.ok && initJson.key && initJson.uploadUrl) break;
      if (initRes.status < 500 || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
    if (!initRes?.ok || !initJson.key || !initJson.uploadUrl) {
      console.warn("[Upload][album] init failed, fallback to direct", {
        status: initRes?.status,
        error: initJson.error,
      });
      const fallback = await directUploadFallback();
      return completeUpload(fallback.objectKey);
    }

    const { key, uploadUrl, headers } = initJson;
    const contentType = headers?.["Content-Type"] || mimeType;

    const putPresignedFile = () =>
      new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed (status ${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed (network/CORS)"));
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", contentType);
        xhr.send(file);
      });
    try {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await putPresignedFile();
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 400 * 2 ** attempt),
            );
          }
        }
      }
      if (lastError) throw lastError;
    } catch (error) {
      console.warn("[Upload][album] presigned PUT failed, fallback to direct", error);
      const fallback = await directUploadFallback();
      return completeUpload(fallback.objectKey);
    }

    return completeUpload(key);
  };

  const uploadFiles = async (
    targetFiles: File[] = files,
    initialUploads: UploadItem[] = uploads,
  ) => {
    if (targetFiles.length === 0) {
      return uploadedFiles;
    }

    const digest = targetFiles
      .map((file) => `${file.name}-${file.size}-${file.lastModified}`)
      .join("|");
    if (digest === fileDigest && uploadedFiles.length > 0) {
      return uploadedFiles;
    }

    const results: UploadResult[] = [];
    const nextUploads =
      initialUploads.length === targetFiles.length
        ? [...initialUploads]
        : targetFiles.map((file) => ({
          name: file.name,
          size: file.size,
          progress: 0,
          status: "pending" as const,
          mime: file.type,
        }));

    for (let index = 0; index < targetFiles.length; index += 1) {
      const file = targetFiles[index];

      if (nextUploads[index]?.status === "done" && uploadedFiles[index]) {
        results.push(uploadedFiles[index]);
        continue;
      }

      nextUploads[index] = {
        ...nextUploads[index],
        status: "uploading",
      };
      setUploads([...nextUploads]);

      let path: string;
      try {
        const uploadResult = await uploadWithProgress(file, (progress) => {
          nextUploads[index] = {
            ...nextUploads[index],
            progress,
          };
          setUploads([...nextUploads]);
        });
        path = uploadResult.objectKey;
      } catch (error) {
        nextUploads[index] = {
          ...nextUploads[index],
          status: "error",
        };
        setUploads([...nextUploads]);
        const message =
          error instanceof Error && error.message
            ? error.message
            : "파일 업로드 중 오류가 발생했습니다.";
        console.error("[AlbumUpload] upload failed", error);
        setNotice({ error: message });
        throw new Error(message);
      }

      nextUploads[index] = {
        ...nextUploads[index],
        status: "done",
        progress: 100,
        path,
      };
      setUploads([...nextUploads]);

      results.push({
        path,
        originalName: file.name,
        mime: file.type || undefined,
        size: file.size,
      });
    }

    setUploadedFiles(results);
    setFileDigest(digest);
    return results;
  };

  const resetAlbumForm = () => {
    setTitle("");
    setArtistName("");
    setArtistNameKr("");
    setArtistNameEn("");
    setReleaseDate("");
    setGenreSelection("");
    setGenreCustom("");
    setDistributor("");
    setProductionCompany("");
    setPreviousRelease("");
    setArtistType("");
    setArtistGender("");
    setArtistMembers("");
    setMelonUrl("");
    setAiUsed(null);
    setTracks([initialTrack]);
    setActiveTrackIndex(0);
    setTranslationPanelOpenMap({});
    setFiles([]);
    setUploads([]);
    setUploadedFiles([]);
    setFileDigest("");
    setEmailSubmitConfirmed(false);
    setNotice({});
    setCurrentSubmissionId(null);
    draftInitAttemptedRef.current = false;
    draftErrorRef.current = null;
    setDraftError(null);
    const nextGuestToken = safeRandomUUID();
    currentGuestTokenRef.current = nextGuestToken;
    setCurrentGuestToken(nextGuestToken);
  };

  const buildUploadsFromFiles = React.useCallback(
    (fileList: UploadResult[]) =>
      fileList.map((file) => ({
        name: file.originalName,
        size: file.size,
        progress: 100,
        status: "done" as const,
        path: file.path,
        mime: file.mime,
      })),
    [],
  );

  const normalizeDateValue = React.useCallback((value: unknown) => {
    if (!value) return "";
    const text = String(value);
    return text.length >= 10 ? text.slice(0, 10) : text;
  }, []);

  const mapDraftFiles = React.useCallback(
    (files: Array<Record<string, unknown>>): UploadResult[] =>
      files.map((file) => ({
        path: String(file.object_key ?? file.file_path ?? ""),
        originalName: String(
          file.original_name ??
          file.file_path ??
          file.object_key ??
          "파일",
        ),
        mime: typeof file.mime === "string" ? file.mime : undefined,
        size: Number(file.size ?? 0),
        accessUrl:
          typeof file.access_url === "string" ? file.access_url : undefined,
        checksum: typeof file.checksum === "string" ? file.checksum : undefined,
        durationSeconds:
          typeof file.duration_seconds === "number"
            ? file.duration_seconds
            : undefined,
      })),
    [],
  );

  const mapDraftTracks = React.useCallback(
    (rows: Array<Record<string, unknown>>): TrackInput[] =>
      rows.map((row) => ({
        trackTitle: String(row.track_title ?? ""),
        performer: String(row.performer ?? ""),
        featuring: String(row.featuring ?? ""),
        composer: String(row.composer ?? ""),
        lyricist: String(row.lyricist ?? ""),
        arranger: String(row.arranger ?? ""),
        lyrics: String(row.lyrics ?? ""),
        translatedLyrics: String(row.translated_lyrics ?? ""),
        notes: String(row.notes ?? ""),
        isTitle: Boolean(row.is_title),
        titleRole:
          (row.title_role as "" | "MAIN" | "SUB" | null | undefined) ?? "",
        broadcastSelected: Boolean(row.broadcast_selected),
      })),
    [],
  );

  const captureCurrentDraft = (
    submissionId: string = requireSubmissionId(),
  ): AlbumDraft => ({
    submissionId,
    guestToken: currentGuestTokenRef.current,
    title: title.trim(),
    artistName: artistName.trim(),
    artistNameKr: artistNameKr.trim(),
    artistNameEn: artistNameEn.trim(),
    releaseDate,
    genre: genreValue,
    distributor: distributor.trim(),
    productionCompany: productionCompany.trim(),
    previousRelease: previousRelease.trim(),
    artistType,
    artistGender,
    artistMembers: artistMembers.trim(),
    melonUrl: melonUrl.trim(),
    aiUsed,
    tracks: tracks.map((track) => ({ ...track })),
    files: uploadedFiles,
    emailSubmitConfirmed,
  });

  const applyDraftToForm = React.useCallback((
    draft: AlbumDraft,
    options?: { emailSubmitConfirmed?: boolean },
  ) => {
    const nextGenre = draft.genre?.trim() ?? "";
    const genreMatches = genreOptions.includes(nextGenre);
    setTitle(draft.title);
    setArtistName(draft.artistName);
    setArtistNameKr(draft.artistNameKr);
    setArtistNameEn(draft.artistNameEn);
    setReleaseDate(draft.releaseDate);
    setGenreSelection(genreMatches ? nextGenre : nextGenre ? "기타" : "");
    setGenreCustom(genreMatches ? "" : nextGenre);
    setDistributor(draft.distributor);
    setProductionCompany(draft.productionCompany);
    setPreviousRelease(draft.previousRelease);
    setArtistType(draft.artistType);
    setArtistGender(draft.artistGender);
    setArtistMembers(draft.artistMembers);
    setMelonUrl(draft.melonUrl);
    setAiUsed(draft.aiUsed ?? null);
    setTracks(draft.tracks.map((track) => ({ ...track })));
    setActiveTrackIndex(0);
    setTranslationPanelOpenMap({});
    setFiles([]);
    setUploads(draft.files.length > 0 ? buildUploadsFromFiles(draft.files) : []);
    setUploadedFiles(draft.files);
    setFileDigest("");
    setEmailSubmitConfirmed(
      options?.emailSubmitConfirmed ??
      draft.emailSubmitConfirmed ??
      draft.files.length === 0,
    );
    setNotice({});
    setCurrentSubmissionId(draft.submissionId);
    currentGuestTokenRef.current = draft.guestToken;
    setCurrentGuestToken(draft.guestToken);
  }, [buildUploadsFromFiles]);

  const applyStoredDrafts = React.useCallback((
    draftRows: Array<Record<string, unknown>>,
    fallbackGuestToken: string,
  ) => {
    if (draftRows.length === 0) return;
    const sorted = [...draftRows].sort((a, b) => {
      const aTime = new Date(String(a.updated_at ?? a.created_at ?? 0)).getTime();
      const bTime = new Date(String(b.updated_at ?? b.created_at ?? 0)).getTime();
      return bTime - aTime;
    });
    const mappedDrafts = sorted.map((row) => {
      const files = mapDraftFiles(
        Array.isArray(row.files) ? (row.files as Array<Record<string, unknown>>) : [],
      );
      const tracks = mapDraftTracks(
        Array.isArray(row.tracks) ? (row.tracks as Array<Record<string, unknown>>) : [],
      );
      const guestTokenValue =
        typeof row.guest_token === "string" && row.guest_token.length > 0
          ? row.guest_token
          : fallbackGuestToken;
      return {
        submissionId: String(row.id),
        guestToken: guestTokenValue,
        title: String(row.title ?? ""),
        artistName: String(row.artist_name ?? ""),
        artistNameKr: String(row.artist_name_kr ?? ""),
        artistNameEn: String(row.artist_name_en ?? ""),
        releaseDate: normalizeDateValue(row.release_date),
        genre: String(row.genre ?? ""),
        distributor: String(row.distributor ?? ""),
        productionCompany: String(row.production_company ?? ""),
        previousRelease: String(row.previous_release ?? ""),
        artistType: String(row.artist_type ?? ""),
        artistGender: String(row.artist_gender ?? ""),
        artistMembers: String(row.artist_members ?? ""),
        melonUrl: String(row.melon_url ?? ""),
        aiUsed:
          typeof row.ai_used === "boolean" ? row.ai_used : null,
        tracks: tracks.length > 0 ? tracks : [initialTrack],
        files,
        emailSubmitConfirmed: files.length === 0,
      } as AlbumDraft;
    });

    const baseRow = sorted[0];
    const baseDraft = mappedDrafts[0];
    const nextPackageId =
      typeof baseRow.package_id === "string" ? baseRow.package_id : null;
    const matchedPackage = nextPackageId
      ? packages.find((pkg) => pkg.id === nextPackageId) ?? null
      : null;
    if (matchedPackage) {
      setSelectedPackage(matchedPackage);
    }
    setIsOneClick(Boolean(baseRow.is_oneclick));
    setApplicantName(String(baseRow.applicant_name ?? ""));
    setApplicantEmail(String(baseRow.applicant_email ?? ""));
    setApplicantPhone(String(baseRow.applicant_phone ?? ""));
    if (baseRow.payment_method === "CARD" || baseRow.payment_method === "BANK") {
      setPaymentMethod(baseRow.payment_method);
    }
    setBankDepositorName(String(baseRow.bank_depositor_name ?? ""));
    setPaymentDocumentType(
      baseRow.payment_document_type === "CASH_RECEIPT" ||
        baseRow.payment_document_type === "TAX_INVOICE"
        ? baseRow.payment_document_type
        : "",
    );
    setCashReceiptPurpose(
      baseRow.cash_receipt_purpose === "PERSONAL_INCOME_DEDUCTION" ||
        baseRow.cash_receipt_purpose === "BUSINESS_EXPENSE_PROOF"
        ? baseRow.cash_receipt_purpose
        : "",
    );
    setCashReceiptPhone(String(baseRow.cash_receipt_phone ?? ""));
    setCashReceiptBusinessNumber(
      String(baseRow.cash_receipt_business_number ?? ""),
    );
    setTaxInvoiceBusinessNumber(String(baseRow.tax_invoice_business_number ?? ""));

    setAlbumDrafts(mappedDrafts.slice(1));
    setUploadDrafts(mappedDrafts);
    setUploadDraftIndex(0);
    applyDraftToForm(baseDraft, {
      emailSubmitConfirmed: baseDraft.emailSubmitConfirmed,
    });
    setStep(2);
  }, [applyDraftToForm, mapDraftFiles, mapDraftTracks, normalizeDateValue, packages]);

  const handleResumeDraftConfirm = React.useCallback(() => {
    if (!resumePrompt) return;
    resumePromptHandledRef.current = true;
    const fallbackGuestToken =
      resumePrompt.storedGuestToken ?? currentGuestToken ?? safeRandomUUID();
    const restoredGuestTokens = getStoredAlbumDraftGuestTokens(
      resumePrompt.drafts,
      resumePrompt.storedGuestTokensBySubmissionId,
      fallbackGuestToken,
    );
    applyStoredDrafts(resumePrompt.drafts, fallbackGuestToken);
    writeDraftStorage({
      ids: resumePrompt.drafts
        .map((draft) => String(draft.id ?? ""))
        .filter(Boolean),
      guestToken: isGuest ? fallbackGuestToken : null,
      guestTokensBySubmissionId: isGuest ? restoredGuestTokens : undefined,
    });
    setResumePrompt(null);
    setResumeChecked(true);
  }, [
    applyStoredDrafts,
    currentGuestToken,
    isGuest,
    resumePrompt,
    writeDraftStorage,
  ]);

  const handleResumeDraftCancel = React.useCallback(async () => {
    if (!resumePrompt || isClearingResumeDrafts) return;
    resumePromptHandledRef.current = true;
    setIsClearingResumeDrafts(true);
    const guestToken = resumePrompt.storedGuestToken ?? currentGuestToken;
    const ids = resumePrompt.drafts
      .map((draft) => String(draft.id ?? ""))
      .filter(Boolean);
    const guestTokensBySubmissionId = getStoredAlbumDraftGuestTokens(
      resumePrompt.drafts,
      resumePrompt.storedGuestTokensBySubmissionId,
      guestToken,
    );
    clearDraftStorage();
    try {
      await clearServerDrafts({
        ids,
        guestToken,
        guestTokensBySubmissionId,
      });
    } catch (error) {
      console.warn("[AlbumDraft][resume-clear] failed", error);
    } finally {
      setIsClearingResumeDrafts(false);
      setResumePrompt(null);
      setResumeChecked(true);
    }
  }, [
    clearDraftStorage,
    clearServerDrafts,
    currentGuestToken,
    isClearingResumeDrafts,
    resumePrompt,
  ]);

  React.useEffect(() => {
    if (resumeChecked) return;
    if (resumePrompt) return;
    if (resumePromptHandledRef.current) return;
    if (typeof window === "undefined") {
      setResumeChecked(true);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const stored = readDraftStorage();
      if (!isFromDraftsTab && (!stored?.ids || stored.ids.length === 0)) {
        setResumeChecked(true);
        return;
      }
      const storedGuestToken =
        stored?.guestToken ??
        (isGuest ? currentGuestToken : null) ??
        undefined;
      const storedGuestTokensBySubmissionId =
        stored?.guestTokensBySubmissionId ?? {};
      const payload = {
        type: "ALBUM",
        ids: stored?.ids,
        guestToken: isGuest ? storedGuestToken : undefined,
        guestTokensBySubmissionId: isGuest
          ? storedGuestTokensBySubmissionId
          : undefined,
      };
      try {
        const res = await fetch("/api/submissions/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await res.json().catch(() => null)) as {
          drafts?: Array<Record<string, unknown>>;
        } | null;
        if (cancelled || resumePromptHandledRef.current) return;
        const drafts = Array.isArray(json?.drafts) ? json!.drafts : [];
        if (drafts.length === 0) {
          setResumeChecked(true);
          return;
        }
        setResumePrompt({
          drafts,
          storedGuestToken: storedGuestToken ?? undefined,
          storedGuestTokensBySubmissionId,
        });
      } catch (error) {
        if (cancelled) return;
        console.warn("[AlbumDraft][resume] failed", error);
        setResumeChecked(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    currentGuestToken,
    isFromDraftsTab,
    isGuest,
    readDraftStorage,
    resumePrompt,
    resumeChecked,
  ]);

  React.useEffect(() => {
    if (!isFromDraftsTab) return;
    if (!resumePrompt) return;
    if (isClearingResumeDrafts) return;
    handleResumeDraftConfirm();
  }, [
    handleResumeDraftConfirm,
    isClearingResumeDrafts,
    isFromDraftsTab,
    resumePrompt,
  ]);

  React.useEffect(() => {
    if (!uploadDrafts) return;
    setUploadDrafts((prev) => {
      if (!prev) return prev;
      const current = prev[uploadDraftIndex];
      if (!current) return prev;
      const sameFiles =
        current.files.length === uploadedFiles.length &&
        current.files.every((file, index) => file.path === uploadedFiles[index]?.path);
      const sameEmail = current.emailSubmitConfirmed === emailSubmitConfirmed;
      if (sameFiles && sameEmail) return prev;
      const next = [...prev];
      next[uploadDraftIndex] = {
        ...current,
        files: uploadedFiles,
        emailSubmitConfirmed,
      };
      return next;
    });
  }, [uploadDraftIndex, uploadDrafts, uploadedFiles, emailSubmitConfirmed]);

  const buildAlbumDraft = async (options?: {
    includeUpload?: boolean;
  }): Promise<AlbumDraft> => {
    const includeUpload = options?.includeUpload ?? true;
    const uploaded = includeUpload ? await uploadFiles() : uploadedFiles;
    return {
      submissionId: requireSubmissionId(),
      guestToken: currentGuestTokenRef.current,
      title: title.trim(),
      artistName: artistName.trim(),
      artistNameKr: artistNameKr.trim(),
      artistNameEn: artistNameEn.trim(),
      releaseDate,
      genre: genreValue,
      distributor: distributor.trim(),
      productionCompany: productionCompany.trim(),
      previousRelease: previousRelease.trim(),
      artistType,
      artistGender,
      artistMembers: artistMembers.trim(),
      melonUrl: melonUrl.trim(),
      aiUsed,
      tracks: tracks.map((track) => ({ ...track })),
      files: uploaded,
      emailSubmitConfirmed,
    };
  };

  const confirmEmailSubmission = React.useCallback(async () => {
    const message =
      "음원 파일 첨부가 완료되지 않으면 파일 없이 다음 단계로 진행할 수 있습니다. 예전 온사이드 사이트에서도 동일하게 접수할 수 있습니다.\n파일 없이 계속 진행하시겠습니까?";
    const confirmed = await showCenteredConfirm(message);
    if (confirmed) {
      setEmailSubmitConfirmed(true);
      setNotice({});
      setUploadDrafts((prev) => {
        if (!prev) return prev;
        return prev.map((draft, index) =>
          index === uploadDraftIndex
            ? { ...draft, files: [], emailSubmitConfirmed: true }
            : draft,
        );
      });
    }
    return confirmed;
  }, [uploadDraftIndex]);

  const selectUploadDeliveryMode = React.useCallback(
    (mode: "upload" | "email") => {
      if (mode === "upload") {
        setEmailSubmitConfirmed(false);
        setNotice({});
        setUploadDrafts((prev) => {
          if (!prev) return prev;
          return prev.map((draft, index) =>
            index === uploadDraftIndex
              ? { ...draft, emailSubmitConfirmed: false }
              : draft,
          );
        });
        return;
      }
      if (emailSubmitConfirmed) {
        setNotice({});
        return;
      }
      setFiles([]);
      setUploads([]);
      setUploadedFiles([]);
      setFileDigest("");
      setEmailSubmitConfirmed(true);
      setNotice({});
      setUploadDrafts((prev) => {
        if (!prev) return prev;
        return prev.map((draft, index) =>
          index === uploadDraftIndex
            ? { ...draft, files: [], emailSubmitConfirmed: true }
            : draft,
        );
      });
    },
    [emailSubmitConfirmed, uploadDraftIndex],
  );

  const getTrackDisplayTitle = (track: TrackInput) =>
    track.trackTitle.trim() || "제목 미입력";

  const mapTracksForSave = (trackList: TrackInput[]) => {
    const isSingleTrack = trackList.length === 1;
    return trackList.map((track) => ({
      ...track,
      trackTitle: track.trackTitle.trim(),
      performer: track.performer.trim(),
      composer: track.composer.trim(),
      lyricist: track.lyricist.trim(),
      arranger: track.arranger.trim(),
      isTitle: isSingleTrack ? true : Boolean(track.isTitle),
      titleRole: isSingleTrack
        ? "MAIN"
        : track.isTitle
          ? track.titleRole || "SUB"
          : undefined,
      broadcastSelected: track.broadcastSelected,
    }));
  };

  const validateBasicInfoStep = () => {
    if (!selectedPackage) {
      setNotice({ error: "패키지를 선택해주세요." });
      return false;
    }

    if (isAdminReviewer) {
      return true;
    }

    if (!applicantName.trim() || !applicantEmail.trim() || !applicantPhone.trim()) {
      setNotice({ error: "접수자 정보(이름/이메일/연락처)를 입력해주세요." });
      return false;
    }

    if (aiUsed === null) {
      setNotice({ error: "AI 활용 여부를 선택해주세요." });
      return false;
    }

    if (isOneClick) {
      if (!melonUrl.trim()) {
        setNotice({ error: "멜론 링크를 입력해주세요." });
        return false;
      }
    } else {
      if (
        !title.trim() ||
        !artistName.trim() ||
        !artistNameKr.trim() ||
        !artistNameEn.trim()
      ) {
        setNotice({
          error: "앨범 제목 및 아티스트 정보를 모두 입력해주세요.",
        });
        return false;
      }

      if (!releaseDate) {
        setNotice({ error: "발매일을 입력해주세요." });
        return false;
      }

      if (!genreValue) {
        setNotice({ error: "장르를 선택해주세요." });
        return false;
      }
      if (genreSelection === "기타" && !genreCustom.trim()) {
        setNotice({ error: "기타 장르를 입력해주세요." });
        return false;
      }

      if (!distributor.trim() || !productionCompany.trim()) {
        setNotice({ error: "유통사/제작사를 입력해주세요." });
        return false;
      }

      if (!previousRelease.trim()) {
        setNotice({ error: "이전 발매곡을 입력해주세요." });
        return false;
      }

      if (!artistType || !artistGender) {
        setNotice({ error: "그룹/솔로 및 성별 정보를 선택해주세요." });
        return false;
      }

      if (artistType === "GROUP" && !artistMembers.trim()) {
        setNotice({ error: "그룹 팀원 전체 이름을 입력해주세요." });
        return false;
      }
    }
    return true;
  };

  const validateTrackInfoStep = () => {
    if (isAdminReviewer || isOneClick || isDownloadedApplicationFlow) {
      return true;
    }

    if (tracks.some((track) => !track.trackTitle.trim())) {
      setNotice({ error: "모든 트랙의 곡명을 입력해주세요." });
      return false;
    }

    if (tracks.some((track) => !track.performer.trim())) {
      setNotice({ error: "모든 트랙의 가수명을 입력해주세요." });
      return false;
    }

    if (tracks.some((track) => !track.composer.trim())) {
      setNotice({ error: "모든 트랙의 작곡 정보를 입력해주세요." });
      return false;
    }

    if (effectiveTitleCount === 0) {
      setNotice({ error: broadcastRequirementMessage });
      return false;
    }

    if (requiresBroadcastSelection && broadcastCount !== 3) {
      setNotice({ error: broadcastRequirementMessage });
      return false;
    }

    return true;
  };

  const validateTranslatedLyrics = () => {
    if (isAdminReviewer) return true;

    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      if (!hasNonKoreanLyrics(track.lyrics)) continue;
      if (track.translatedLyrics.trim()) continue;
      setActiveTrackIndex(index);
      setTranslationPanelOpenMap((prev) => ({
        ...prev,
        [index]: true,
      }));
      setNotice({
        error: `트랙 ${index + 1} 가사에 한국어 외 언어가 포함되어 있습니다. 번역본 가사를 입력해주세요.`,
      });
      return false;
    }
    return true;
  };

  const validateUploadStep = async (drafts: AlbumDraft[]) => {
    if (uploads.some((upload) => upload.status === "error")) {
      setNotice({ error: "업로드에 실패한 파일이 있습니다." });
      return false;
    }
    if (uploads.some((upload) => upload.status !== "done")) {
      setNotice({ error: "파일 업로드가 완료될 때까지 기다려주세요." });
      return false;
    }

    const missingUploads = drafts.filter(
      (draft) => draft.files.length === 0 && !draft.emailSubmitConfirmed,
    );
    if (missingUploads.length > 0) {
      if (isAdminReviewer) {
        return true;
      }
      if (missingUploads.length === 1 && (await confirmEmailSubmission())) {
        return true;
      }
      setNotice({
        error: "음원 파일을 업로드하거나 이메일 제출을 선택해주세요.",
      });
      return false;
    }

    if (!isAdminReviewer) {
      const missingAudioFiles = drafts.filter(
        (draft) =>
          !draft.emailSubmitConfirmed &&
          !draft.files.some((file) =>
            isAudioUploadFile(file.originalName, file.mime),
          ),
      );
      if (missingAudioFiles.length > 0) {
        setNotice({
          error: "음원 파일(WAV/MP3/ZIP)을 업로드하거나 이메일 제출을 선택해주세요.",
        });
        return false;
      }
    }

    if (isDownloadedApplicationFlow && !isAdminReviewer) {
      const missingApplicationForms = drafts.filter(
        (draft) =>
          !draft.emailSubmitConfirmed &&
          !draft.files.some((file) => isApplicationFormFile(file.originalName)),
      );
      if (missingApplicationForms.length > 0) {
        setNotice({
          error: "작성한 신청서 파일(HWP/DOC/DOCX)을 함께 업로드해주세요.",
        });
        return false;
      }
    }

    return true;
  };

  const validatePaymentDocument = () => {
    if (paymentMethod !== "BANK") return true;
    if (isAdminReviewer) return true;
    if (paymentDocumentType === "CASH_RECEIPT") {
      if (!cashReceiptPurpose) {
        setNotice({ error: "현금 영수증 발급 용도를 선택해주세요." });
        return false;
      }
      if (cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION") {
        const phone = digitsOnly(cashReceiptPhone);
        if (!phone) {
          setNotice({
            error: "현금 영수증(개인소득공제용) 휴대폰 번호를 입력해주세요.",
          });
          return false;
        }
        if (phone.length < 9 || phone.length > 11) {
          setNotice({ error: "현금 영수증 휴대폰 번호 형식을 확인해주세요." });
          return false;
        }
      } else if (cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF") {
        const businessNo = digitsOnly(cashReceiptBusinessNumber);
        if (!businessNo) {
          setNotice({
            error: "현금 영수증(사업자지출증빙용) 사업자번호를 입력해주세요.",
          });
          return false;
        }
        if (businessNo.length !== 10) {
          setNotice({ error: "사업자번호는 숫자 10자리로 입력해주세요." });
          return false;
        }
      }
    }
    if (paymentDocumentType === "TAX_INVOICE") {
      const businessNo = digitsOnly(taxInvoiceBusinessNumber);
      if (!businessNo) {
        setNotice({ error: "세금계산서 발급용 사업자번호를 입력해주세요." });
        return false;
      }
      if (businessNo.length !== 10) {
        setNotice({ error: "사업자번호는 숫자 10자리로 입력해주세요." });
        return false;
      }
      if (!taxInvoiceCertificateFile) {
        setNotice({ error: "세금계산서 발급용 사업자등록증을 첨부해주세요." });
        return false;
      }
    }
    return true;
  };

  const startEditingDraft = async (index: number) => {
    if (editingIndex !== null && editingIndex !== index) {
      setNotice({ error: "수정 중인 앨범을 먼저 저장해주세요." });
      return;
    }

    const draft = albumDrafts[index];
    if (!draft) return;

    if (uploads.some((upload) => upload.status !== "done")) {
      setNotice({ error: "파일 업로드가 완료된 뒤 수정할 수 있습니다." });
      return;
    }

    if (!(await showCenteredConfirm("해당 앨범 정보를 불러오겠습니까?"))) {
      return;
    }

    if (!baseDraftSnapshot) {
      setBaseDraftSnapshot({
        draft: captureCurrentDraft(),
        emailSubmitConfirmed,
      });
    }

    setEditingIndex(index);
    applyDraftToForm(draft, {
      emailSubmitConfirmed: draft.emailSubmitConfirmed,
    });
  };

  const saveAlbumDrafts = async (
    drafts: AlbumDraft[],
    options: { includeFiles: boolean; status?: "DRAFT" | "PRE_REVIEW" },
  ) => {
    const applicantNameValue = applicantName.trim();
    const applicantEmailValue = applicantEmail.trim();
    const applicantPhoneValue = applicantPhone.trim();
    const saveStatus =
      options.status ??
      (uploadDrafts && uploadDrafts.length > 0 ? "PRE_REVIEW" : "DRAFT");
    const submissionIds: string[] = [];

    setIsSaving(true);
    setNotice({});
    try {
      for (let index = 0; index < drafts.length; index += 1) {
        const draft = drafts[index];
        const albumPrice =
          basePriceKrw > 0 ? (index === 0 ? basePriceKrw : additionalPriceKrw) : 0;
        const titleValue = draft.title.trim();
        const artistValue = draft.artistName.trim();
        const result = await saveAlbumSubmissionAction({
          submissionId: draft.submissionId,
          packageId: selectedPackage?.id,
          amountKrw: albumPrice,
          title: titleValue || undefined,
          artistName: artistValue || undefined,
          artistNameKr: draft.artistNameKr.trim(),
          artistNameEn: draft.artistNameEn.trim(),
          releaseDate: draft.releaseDate || undefined,
          genre: draft.genre || undefined,
          distributor: draft.distributor || undefined,
          productionCompany: draft.productionCompany || undefined,
          applicantName: applicantNameValue,
          applicantEmail: applicantEmailValue,
          applicantPhone: applicantPhoneValue,
          previousRelease: draft.previousRelease || undefined,
          artistType: draft.artistType || undefined,
          artistGender: draft.artistGender || undefined,
          artistMembers:
            draft.artistType === "GROUP"
              ? draft.artistMembers || undefined
              : undefined,
          isOneClick,
          aiUsed: draft.aiUsed ?? undefined,
          filesSubmittedByEmail:
            isDownloadedApplicationFlow && draft.emailSubmitConfirmed,
          externalApplicationForm: isDownloadedApplicationFlow,
          melonUrl: isOneClick ? draft.melonUrl || undefined : undefined,
          guestToken: draft.guestToken,
          guestName: applicantNameValue,
          guestCompany: draft.productionCompany || undefined,
          guestEmail: applicantEmailValue,
          guestPhone: applicantPhoneValue,
          paymentMethod,
          bankDepositorName:
            paymentMethod === "BANK" ? bankDepositorName.trim() || undefined : undefined,
          paymentDocumentType: paymentDocumentType || undefined,
          cashReceiptPurpose:
            paymentDocumentType === "CASH_RECEIPT"
              ? cashReceiptPurpose || undefined
              : undefined,
          cashReceiptPhone:
            paymentDocumentType === "CASH_RECEIPT" &&
              cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION"
              ? cashReceiptPhone.trim() || undefined
              : undefined,
          cashReceiptBusinessNumber:
            paymentDocumentType === "CASH_RECEIPT" &&
              cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
              ? cashReceiptBusinessNumber.trim() || undefined
              : undefined,
          taxInvoiceBusinessNumber:
            paymentDocumentType === "TAX_INVOICE"
              ? taxInvoiceBusinessNumber.trim() || undefined
              : undefined,
          status: saveStatus,
          tracks:
            isOneClick || isDownloadedApplicationFlow
              ? undefined
              : mapTracksForSave(draft.tracks),
          files: options.includeFiles ? draft.files : undefined,
        });

        if (result.error) {
          setNotice({ error: result.error });
          return false;
        }

        if (result.submissionId) {
          submissionIds.push(result.submissionId);
        }
      }

      const fallbackIds = drafts.map((draft) => draft.submissionId);
      const storedIds = submissionIds.length > 0 ? submissionIds : fallbackIds;
      writeDraftStorage({
        ids: storedIds,
        guestToken: isGuest ? currentGuestTokenRef.current : null,
        guestTokensBySubmissionId: isGuest
          ? getAlbumDraftGuestTokens(drafts)
          : undefined,
      });
      setNotice({ submissionId: submissionIds[0] ?? currentSubmissionId });
      return true;
    } catch {
      setNotice({ error: "저장 중 오류가 발생했습니다." });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddAlbum = async () => {
    if (
      !validateBasicInfoStep() ||
      !validateTrackInfoStep() ||
      !validateTranslatedLyrics()
    ) {
      return;
    }
    setIsAddingAlbum(true);
    setNotice({});
    try {
      const draft = await buildAlbumDraft({ includeUpload: false });
      if (editingIndex !== null) {
        const nextAlbumDrafts = albumDrafts.map((item, idx) =>
          idx === editingIndex ? draft : item,
        );
        const draftsForSave = baseDraftSnapshot
          ? [baseDraftSnapshot.draft, ...nextAlbumDrafts]
          : nextAlbumDrafts;
        const saved = await saveAlbumDrafts(draftsForSave, {
          includeFiles: false,
          status: "DRAFT",
        });
        if (!saved) return;
        setAlbumDrafts((prev) =>
          prev.map((item, idx) => (idx === editingIndex ? draft : item)),
        );
        setEditingIndex(null);
        if (baseDraftSnapshot) {
          applyDraftToForm(baseDraftSnapshot.draft, {
            emailSubmitConfirmed: baseDraftSnapshot.emailSubmitConfirmed,
          });
          setBaseDraftSnapshot(null);
        } else {
          resetAlbumForm();
        }
      } else {
        const saved = await saveAlbumDrafts([draft, ...albumDrafts], {
          includeFiles: false,
          status: "DRAFT",
        });
        if (!saved) return;
        setAlbumDrafts((prev) => [...prev, draft]);
        resetAlbumForm();
        setStep(2);
      }
    } catch {
      setNotice({ error: "추가 앨범 등록 중 오류가 발생했습니다." });
    } finally {
      setIsAddingAlbum(false);
    }
  };

  const removeAlbumDraft = (index: number) => {
    setAlbumDrafts((prev) => prev.filter((_, idx) => idx !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      if (baseDraftSnapshot) {
        applyDraftToForm(baseDraftSnapshot.draft, {
          emailSubmitConfirmed: baseDraftSnapshot.emailSubmitConfirmed,
        });
        setBaseDraftSnapshot(null);
      }
      return;
    }
    if (editingIndex !== null && index < editingIndex) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const handleBasicInfoNext = async () => {
    if (isDownloadedApplicationFlow) {
      await handleDownloadedApplicationContinue();
      return;
    }
    if (!validateBasicInfoStep()) {
      return;
    }

    const submissionId =
      currentSubmissionId ?? (await createDraft({ force: true }));
    if (!submissionId) {
      setNotice({
        error:
          draftError ||
          draftErrorRef.current ||
          "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
      return;
    }

    let currentDraft: AlbumDraft;
    try {
      currentDraft = captureCurrentDraft(submissionId);
    } catch (error) {
      setNotice({
        error:
          draftError ||
          draftErrorRef.current ||
          (error instanceof Error
            ? error.message
            : "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요."),
      });
      void createDraft();
      return;
    }

    const allDrafts =
      editingIndex !== null
        ? baseDraftSnapshot
          ? [
            baseDraftSnapshot.draft,
            ...albumDrafts.map((draft, index) =>
              index === editingIndex ? currentDraft : draft,
            ),
          ]
          : albumDrafts.map((draft, index) =>
            index === editingIndex ? currentDraft : draft,
          )
        : [currentDraft, ...albumDrafts];
    const saved = await saveAlbumDrafts(allDrafts, {
      includeFiles: false,
      status: "DRAFT",
    });
    if (!saved) return;
    setNotice({});

    if (isOneClick) {
      setUploadDrafts(allDrafts);
      setUploadDraftIndex(0);
      applyDraftToForm(allDrafts[0], {
        emailSubmitConfirmed: allDrafts[0].emailSubmitConfirmed,
      });
      setStep(4);
      return;
    }

    setTracks((previousTracks) =>
      previousTracks.map((track) =>
        !track.performer.trim()
          ? { ...track, performer: artistName.trim() }
          : track,
      ),
    );
    setStep(3);
  };

  const handleTrackTemporarySave = async () => {
    const submissionId =
      currentSubmissionId ?? (await createDraft({ force: true }));
    if (!submissionId) {
      setNotice({
        error:
          draftError ||
          draftErrorRef.current ||
          "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
      return;
    }

    const currentDraft = captureCurrentDraft(submissionId);
    const draftsForSave =
      editingIndex !== null
        ? baseDraftSnapshot
          ? [
            baseDraftSnapshot.draft,
            ...albumDrafts.map((draft, index) =>
              index === editingIndex ? currentDraft : draft,
            ),
          ]
          : albumDrafts.map((draft, index) =>
            index === editingIndex ? currentDraft : draft,
          )
        : [currentDraft, ...albumDrafts];
    await saveAlbumDrafts(draftsForSave, {
      includeFiles: false,
      status: "DRAFT",
    });
  };

  const handleTrackInfoNext = async () => {
    if (editingIndex !== null) {
      setNotice({ error: "수정 중인 앨범을 저장한 뒤 진행해주세요." });
      return;
    }
    if (
      !validateBasicInfoStep() ||
      !validateTrackInfoStep() ||
      !validateTranslatedLyrics()
    ) {
      return;
    }

    let currentDraft: AlbumDraft;
    try {
      currentDraft = captureCurrentDraft();
    } catch (error) {
      setNotice({
        error:
          draftError ||
          draftErrorRef.current ||
          (error instanceof Error
            ? error.message
            : "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요."),
      });
      void createDraft({ force: true });
      return;
    }

    const allDrafts = [currentDraft, ...albumDrafts];
    const saved = await saveAlbumDrafts(allDrafts, {
      includeFiles: false,
      status: "PRE_REVIEW",
    });
    if (!saved) return;
    setUploadDrafts(allDrafts);
    setUploadDraftIndex(0);
    applyDraftToForm(allDrafts[0], {
      emailSubmitConfirmed: allDrafts[0].emailSubmitConfirmed,
    });
    setStep(4);
  };

  const handleDownloadedApplicationContinue = async () => {
    if (isContinuingDownloadedApplication) return;
    if (!selectedPackage) {
      setNotice({ error: "패키지를 선택해주세요." });
      return;
    }
    if (!isAdminReviewer && aiUsed === null) {
      setNotice({ error: "AI 활용 여부를 선택해주세요." });
      return;
    }
    setIsContinuingDownloadedApplication(true);
    setNotice({});
    try {
      const submissionId =
        currentSubmissionId ?? (await createDraft({ force: true }));
      if (!submissionId) {
        setNotice({
          error:
            draftErrorRef.current ||
            draftError ||
            "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.",
        });
        return;
      }
      const currentDraft = captureCurrentDraft(submissionId);
      const allDrafts = [currentDraft, ...albumDrafts];
      writeDraftStorage({
        ids: allDrafts.map((draft) => draft.submissionId),
        guestToken: isGuest ? currentGuestTokenRef.current : null,
        guestTokensBySubmissionId: isGuest
          ? getAlbumDraftGuestTokens(allDrafts)
          : undefined,
      });
      setUploadDrafts(allDrafts);
      setUploadDraftIndex(0);
      applyDraftToForm(allDrafts[0], {
        emailSubmitConfirmed: false,
      });
      setStep(4);
    } catch (error) {
      setNotice({
        error:
          error instanceof Error
            ? error.message
            : "파일 업로드 단계로 이동하지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsContinuingDownloadedApplication(false);
    }
  };

  const handleSelectUploadDraft = (index: number) => {
    if (!uploadDrafts || !uploadDrafts[index]) return;
    if (uploads.some((upload) => upload.status !== "done")) {
      setNotice({ error: "파일 업로드가 완료된 뒤 변경할 수 있습니다." });
      return;
    }
    setUploadDraftIndex(index);
    applyDraftToForm(uploadDrafts[index], {
      emailSubmitConfirmed: uploadDrafts[index].emailSubmitConfirmed,
    });
  };

  const resolveUploadDrafts = () => {
    if (uploadDrafts && uploadDrafts.length > 0) {
      const nextDrafts = [...uploadDrafts];
      const current = nextDrafts[uploadDraftIndex];
      if (current) {
        nextDrafts[uploadDraftIndex] = {
          ...current,
          files: uploadedFiles,
          emailSubmitConfirmed,
        };
      }
      return nextDrafts;
    }
    try {
      return [captureCurrentDraft(), ...albumDrafts];
    } catch (error) {
      setNotice({
        error:
          draftError ||
          draftErrorRef.current ||
          (error instanceof Error
            ? error.message
            : "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요."),
      });
      void createDraft();
      return null;
    }
  };

  const handleStep3Next = async () => {
    const draftsForUpload = resolveUploadDrafts();
    if (!draftsForUpload) return;
    if (!(await validateUploadStep(draftsForUpload))) {
      return;
    }
    const saved = await saveAlbumDrafts(draftsForUpload, { includeFiles: true });
    if (saved) {
      setStep(5);
    }
  };

  const handleSave = async (
    status: "DRAFT" | "SUBMITTED",
    options?: { deferPayment?: boolean; redirectToCart?: boolean },
  ) => {
    const deferPayment = status === "SUBMITTED" && options?.deferPayment === true;
    if (editingIndex !== null) {
      setNotice({ error: "수정 중인 앨범을 저장한 뒤 진행해주세요." });
      return;
    }
    if (
      status === "SUBMITTED" &&
      !isDownloadedApplicationFlow &&
      (!validateBasicInfoStep() || !validateTrackInfoStep())
    ) {
      return;
    }
    if (
      status === "SUBMITTED" &&
      !isDownloadedApplicationFlow &&
      !isOneClick &&
      !validateTranslatedLyrics()
    ) {
      return;
    }
    if (
      status === "SUBMITTED" &&
      paymentMethod === "BANK" &&
      !bankDepositorName.trim() &&
      !isAdminReviewer &&
      !deferPayment
    ) {
      setNotice({ error: "입금자명을 입력해주세요." });
      return;
    }
    if (status === "SUBMITTED" && paymentMethod === "BANK" && !deferPayment) {
      if (!validatePaymentDocument()) {
        return;
      }
    }
    let draftsForSubmit: AlbumDraft[];
    if (status === "SUBMITTED" && uploadDrafts?.length) {
      const resolvedDrafts = resolveUploadDrafts();
      if (!resolvedDrafts) return;
      draftsForSubmit = resolvedDrafts;
    } else {
      try {
        const currentDraft = await buildAlbumDraft({
          includeUpload: status === "SUBMITTED",
        });
        draftsForSubmit = [currentDraft, ...albumDrafts];
      } catch (error) {
        setNotice({
          error:
            draftError ||
            (error instanceof Error
              ? error.message
              : "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요."),
        });
        void createDraft();
        return;
      }
    }
    if (
      status === "SUBMITTED" &&
      !(await validateUploadStep(draftsForSubmit))
    ) {
      return;
    }

    setIsSaving(true);
    setNotice({});
    try {
      if (status === "SUBMITTED" && !selectedPackage) {
        setNotice({ error: "패키지를 선택해주세요." });
        return;
      }
      if (status === "SUBMITTED" && basePriceKrw <= 0) {
        setNotice({ error: "결제 금액 정보를 확인할 수 없습니다." });
        return;
      }
      const applicantNameValue = applicantName.trim();
      const applicantEmailValue = applicantEmail.trim();
      const applicantPhoneValue = applicantPhone.trim();
      const submissionIds: string[] = [];
      const guestTokens: Array<{ token: string; title: string }> = [];
      const guestTokensBySubmissionId: Record<string, string> = {};
      let emailNotice: string | undefined;
      const submissionPaymentMethod = deferPayment ? "BANK" : paymentMethod;

      for (let index = 0; index < draftsForSubmit.length; index += 1) {
        const draft = draftsForSubmit[index];
        const albumPrice =
          status === "SUBMITTED"
            ? index === 0
              ? basePriceKrw
              : additionalPriceKrw
            : basePriceKrw > 0
              ? index === 0
                ? basePriceKrw
                : additionalPriceKrw
              : 0;
        const titleValue = draft.title.trim();
        const artistValue = draft.artistName.trim();
        if (
          status === "SUBMITTED" &&
          !deferPayment &&
          submissionPaymentMethod === "BANK" &&
          paymentDocumentType === "TAX_INVOICE"
        ) {
          await uploadTaxInvoiceCertificateForSubmission(
            draft.submissionId,
            titleValue || `album-${index + 1}`,
          );
        }
        const result = await saveAlbumSubmissionAction({
          submissionId: draft.submissionId,
          packageId: selectedPackage?.id,
          amountKrw: albumPrice,
          title: titleValue || undefined,
          artistName: artistValue || undefined,
          artistNameKr: draft.artistNameKr.trim(),
          artistNameEn: draft.artistNameEn.trim(),
          releaseDate: draft.releaseDate || undefined,
          genre: draft.genre || undefined,
          distributor: draft.distributor || undefined,
          productionCompany: draft.productionCompany || undefined,
          applicantName: applicantNameValue,
          applicantEmail: applicantEmailValue,
          applicantPhone: applicantPhoneValue,
          previousRelease: draft.previousRelease || undefined,
          artistType: draft.artistType || undefined,
          artistGender: draft.artistGender || undefined,
          artistMembers:
            draft.artistType === "GROUP"
              ? draft.artistMembers || undefined
              : undefined,
          isOneClick,
          aiUsed: draft.aiUsed ?? undefined,
          filesSubmittedByEmail:
            isDownloadedApplicationFlow && draft.emailSubmitConfirmed,
          externalApplicationForm: isDownloadedApplicationFlow,
          melonUrl: isOneClick ? draft.melonUrl || undefined : undefined,
          guestToken: draft.guestToken,
          guestName: applicantNameValue,
          guestCompany: draft.productionCompany || undefined,
          guestEmail: applicantEmailValue,
          guestPhone: applicantPhoneValue,
          paymentMethod: submissionPaymentMethod,
          bankDepositorName:
            status === "SUBMITTED" && !deferPayment
              ? bankDepositorName.trim()
              : undefined,
          paymentDocumentType:
            status === "SUBMITTED" && !deferPayment
              ? paymentDocumentType || undefined
              : undefined,
          cashReceiptPurpose:
            status === "SUBMITTED" &&
              !deferPayment &&
              paymentDocumentType === "CASH_RECEIPT"
              ? cashReceiptPurpose || undefined
              : undefined,
          cashReceiptPhone:
            status === "SUBMITTED" &&
              !deferPayment &&
              paymentDocumentType === "CASH_RECEIPT" &&
              cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION"
              ? cashReceiptPhone.trim() || undefined
              : undefined,
          cashReceiptBusinessNumber:
            status === "SUBMITTED" &&
              !deferPayment &&
              paymentDocumentType === "CASH_RECEIPT" &&
              cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
              ? cashReceiptBusinessNumber.trim() || undefined
              : undefined,
          taxInvoiceBusinessNumber:
            status === "SUBMITTED" &&
              !deferPayment &&
              paymentDocumentType === "TAX_INVOICE"
              ? taxInvoiceBusinessNumber.trim() || undefined
              : undefined,
          deferPayment,
          status,
          tracks:
            isOneClick || isDownloadedApplicationFlow
              ? undefined
              : mapTracksForSave(draft.tracks),
          files: status === "SUBMITTED" ? draft.files : undefined,
        });

        if (result.error) {
          setNotice({ error: result.error });
          return;
        }

        const savedSubmissionId = result.submissionId ?? draft.submissionId;
        if (result.submissionId) {
          submissionIds.push(result.submissionId);
        }
        const savedGuestToken = result.guestToken ?? draft.guestToken;
        if (isGuest && savedSubmissionId && savedGuestToken) {
          guestTokensBySubmissionId[savedSubmissionId] = savedGuestToken;
        }
        if (result.guestToken) {
          guestTokens.push({
            token: result.guestToken,
            title: draft.title.trim() || "제목 미입력",
          });
        }
        if (result.emailNotice && !emailNotice) {
          emailNotice = result.emailNotice;
        }
      }

      if (status === "SUBMITTED" && submissionIds.length > 0) {
        if (deferPayment) {
          clearDraftStorage();
          if (isGuest) {
            addGuestSubmissionCartEntries(
              Object.entries(guestTokensBySubmissionId).map(
                ([submissionId, guestToken]) => ({
                  submissionId,
                  guestToken,
                }),
              ),
            );
          }
          if (options?.redirectToCart) {
            router.push(
              `${localePrefix}/mypage/cart?added=${encodeURIComponent(submissionIds[0])}`,
            );
            return;
          }
          setNotice({
            emailNotice: emailNotice
              ? `${deferredPaymentNotice} ${emailNotice}`
              : deferredPaymentNotice,
          });
          setCompletionId(submissionIds[0]);
          setCompletionSubmissionIds(submissionIds);
          if (guestTokens.length > 0) {
            setCompletionTokens(guestTokens);
          }
          setStep(6);
          return;
        }
        if (paymentMethod === "CARD") {
          setNotice(emailNotice ? { emailNotice } : {});
          const { ok, error } = await openInicisCardPopup({
            context: isOneClick ? "oneclick" : "music",
            submissionId: submissionIds[0],
            submissionIds,
            guestToken: guestTokens[0]?.token ?? currentGuestToken ?? undefined,
            guestTokensBySubmissionId,
          });
          if (!ok) {
            setNotice({
              error:
                error
                  ? `${error} ${paymentFailureStorageNotice}`
                  : paymentFailureDraftNotice,
            });
          }
          return;
        } else if (paymentMethod === "BANK") {
          clearDraftStorage();
          setNotice(emailNotice ? { emailNotice } : {});
          setCompletionId(submissionIds[0]);
          setCompletionSubmissionIds(submissionIds);
          if (guestTokens.length > 0) {
            setCompletionTokens(guestTokens);
          }
          setStep(6);
          return;
        } else {
          console.warn("[Inicis][STDPay][init][client] unknown payment method", paymentMethod);
          setNotice({ error: "지원하지 않는 결제 수단입니다." });
          return;
        }
      }

      setNotice({
        submissionId: submissionIds[0] ?? currentSubmissionId,
      });
    } catch {
      setNotice({ error: "저장 중 오류가 발생했습니다." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 text-[15px] leading-relaxed sm:text-base [&_input]:text-base [&_textarea]:text-base [&_select]:text-base [&_label]:text-sm">
      <PendingOverlay
        show={isSaving || isAddingAlbum}
        label={step <= 4 ? "신청서 저장 중..." : "심의 저장/결제 처리 중..."}
      />
      {resumePrompt && !isFromDraftsTab ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="임시저장 신청서 불러오기"
            className="max-h-[calc(100dvh-3rem)] w-full max-w-md overflow-y-auto rounded-[24px] border border-border/60 bg-background p-5 text-foreground shadow-xl sm:rounded-[28px] sm:p-6"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              임시저장 알림
            </p>
            <h3 className="mt-2 text-lg font-semibold">
              임시저장된 신청서가 있습니다.
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              불러오시겠습니까?
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleResumeDraftCancel()}
                disabled={isClearingResumeDrafts}
                className="rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isClearingResumeDrafts ? "삭제 중..." : "삭제"}
              </button>
              <button
                type="button"
                onClick={handleResumeDraftConfirm}
                disabled={isClearingResumeDrafts}
                className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                불러오기
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {stepLabels}

      {step === 1 && (
        <div className="space-y-6">
          <h2 className="font-display text-2xl text-foreground">
            패키지 선택
          </h2>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              접수 방식
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  if (selectionLocked) return;
                  setIsOneClick(false);
                }}
                disabled={selectionLocked}
                className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${!isOneClick
                  ? "border-[#0071e3] bg-[#0071e3] text-white shadow-[0_20px_44px_rgba(0,113,227,0.24)] dark:border-[#2997ff] dark:bg-[#2997ff] dark:text-[#00101f]"
                  : "border-border/60 bg-background text-foreground hover:border-primary/40"
                  }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">일반 접수</p>
                  </div>
                  {!isOneClick ? (
                    <span className={selectedBadgeClass}>
                      ✓ 선택됨
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs opacity-80">트랙 정보 직접 입력</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectionLocked) return;
                  setIsOneClick(true);
                  setShowOneclickNotice(true);
                }}
                disabled={selectionLocked}
                className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${isOneClick
                  ? "border-[#0071e3] bg-[#0071e3] text-white shadow-[0_18px_40px_rgba(0,113,227,0.22)] dark:bg-[#2997ff] dark:text-[#00101f]"
                  : "border-border/60 bg-background text-foreground hover:border-primary/40"
                  }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">원클릭 접수</p>
                  </div>
                  {isOneClick ? (
                    <span className={selectedBadgeClass}>
                      ✓ 선택됨
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs opacity-80">멜론 링크로 간편 접수</p>
              </button>
            </div>
            {selectionLocked && (
              <p className="mt-3 text-xs text-muted-foreground">
                추가 앨범이 등록된 경우 접수 방식은 변경할 수 없습니다.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {packages.map((pkg, index) => {
              const isActive = activePackageId === pkg.id;
              const isDisabled =
                selectionLocked && selectedPackage?.id !== pkg.id;
              const tone =
                packageToneClasses[index % packageToneClasses.length];
              const displayPrice = isOneClick
                ? oneClickPriceMap[pkg.stationCount] ?? pkg.priceKrw
                : pkg.priceKrw;
              const packageDiscountPercent = getAlbumReviewDiscountPercentForPackage(
                normalizedAlbumDiscountPercent,
                pkg.stationCount,
              );
              const discountedDisplayPrice = getDiscountedAlbumPrice(
                displayPrice,
                normalizedAlbumDiscountPercent,
                pkg.stationCount,
              );
              const hasDisplayDiscount =
                packageDiscountPercent > 0 &&
                discountedDisplayPrice < displayPrice;
              const guidance = packageGuidance[pkg.stationCount];
              const conditionalGuidance = guidance?.conditional ?? [];
              const includedStationsLabel = `포함 방송국 ${pkg.stations.length}개`;
              return (
                <article
                  key={pkg.id}
                  className={`flex h-full flex-col overflow-hidden rounded-[14px] border-2 text-left transition ${isDisabled ? "opacity-60" : ""} ${isActive
                    ? tone.card
                    : "border-[#111111] bg-card text-foreground hover:-translate-y-0.5 hover:shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:hover:shadow-[3px_3px_0_#f2cf27]"
                    }`}
                >
                  <button
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => {
                      if (selectionLocked && selectedPackage?.id !== pkg.id) {
                        return;
                      }
                      setPackageConfirmTarget(pkg);
                    }}
                    disabled={isDisabled}
                    className="flex flex-1 flex-col p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-inset disabled:cursor-not-allowed"
                  >
                    <div className="flex w-full flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {guidance?.badge ? (
                          <span className={`mb-2 inline-flex rounded-[6px] border px-2 py-0.5 text-[10px] font-black tracking-normal ${isActive ? tone.chip : "border-[#1556a4]/40 bg-[#1556a4]/10 text-[#1556a4]"}`}>
                            {guidance.badge}
                          </span>
                        ) : null}
                        <h3 className="text-base font-black leading-tight sm:text-lg xl:text-base">
                          {getPackageDisplayName(pkg, isOneClick)}
                        </h3>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                        {isActive ? (
                          <span className={selectedBadgeClass}>
                            ✓ 선택됨
                          </span>
                        ) : null}
                        {hasDisplayDiscount ? (
                          <span className="rounded-[6px] border border-[#111111]/20 bg-white/70 px-2 py-0.5 text-[10px] font-black text-[#111111]">
                            {packageDiscountPercent}% 할인
                          </span>
                        ) : null}
                        {hasDisplayDiscount ? (
                          <span className="text-xs font-semibold opacity-60 line-through">
                            {formatCurrency(displayPrice)}원
                          </span>
                        ) : null}
                        <span className="text-sm font-black sm:text-base xl:text-sm">
                          {formatCurrency(discountedDisplayPrice)}원
                        </span>
                      </div>
                    </div>
                    {guidance?.recommendation ? (
                      <p className="mt-3 line-clamp-2 text-xs font-semibold leading-5 opacity-80">
                        {guidance.recommendation}
                      </p>
                    ) : null}
                    {conditionalGuidance.length > 0 ? (
                      <span className={`mt-3 inline-flex self-start rounded-[6px] border px-2 py-1 text-[10px] font-black tracking-normal ${isActive ? tone.chip : "border-[#f2cf27] bg-[#f2cf27]/20 text-[#111111] dark:text-[#f2cf27]"}`}>
                        장르 조건 있음
                      </span>
                    ) : null}
                  </button>
                  <details className="group border-t-2 border-current/25">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-xs font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                      <span>{includedStationsLabel}</span>
                      <span
                        aria-hidden="true"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] border-2 border-current text-sm font-black transition group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <div className="space-y-3 px-4 pb-4">
                      {conditionalGuidance.length > 0 ? (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-black uppercase tracking-[0.12em] opacity-70">
                            선택 조건
                          </p>
                          {conditionalGuidance.map((item) => (
                            <p key={item} className="text-[11px] font-semibold leading-4">
                              {item}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-1.5">
                        {pkg.stations.map((station) => (
                          <span
                            key={station.id}
                            className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${isActive ? tone.chip : "border-border/60 text-muted-foreground"}`}
                          >
                            {station.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
          {selectionLocked && (
            <p className="text-xs text-muted-foreground">
              추가 앨범이 등록된 경우 패키지는 변경할 수 없습니다.
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!selectedPackage}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
            >
              다음 단계
            </button>
          </div>
        </div>
      )}

      {(step === 2 || step === 3) && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl text-foreground">
              {step === 2 ? "기본 정보" : "트랙 정보"}
            </h2>
            <span className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
              앨범 {albumDrafts.length + 1}
              {albumDrafts.length > 0 ? ` · 추가 ${albumDrafts.length}건` : ""}
            </span>
          </div>

          {step === 2 && (
            <ApplicationFormModeTabs
              mode={applicationFormMode}
              onModeChange={setApplicationFormMode}
            />
          )}

          {step === 2 && isDownloadedApplicationFlow ? (
            <div className="rounded-[28px] border-2 border-[#111111] bg-card p-6 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]">
              <h3 className="text-xl font-black text-foreground">신청서 양식</h3>
              <div className="mt-5 flex flex-wrap gap-3">
                {albumApplicationForms.map((form) => (
                  <a
                    key={form.href}
                    href={form.href}
                    download={form.downloadName}
                    onClick={() => {
                      void handleDownloadedApplicationContinue();
                    }}
                    className="inline-flex rounded-[8px] border-2 border-[#111111] bg-white px-5 py-3 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27] hover:shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27]"
                  >
                    {isContinuingDownloadedApplication
                      ? "업로드 단계 준비 중..."
                      : `${form.label} 다운로드`}
                  </a>
                ))}
              </div>
              <div className="mt-5 inline-flex rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                다음: 신청서 + 음원 첨부
              </div>
              <div className="mt-5">
                <AiUsageSelector
                  value={aiUsed}
                  onChange={(nextValue) => {
                    setAiUsed(nextValue);
                    setNotice({});
                  }}
                  context="album"
                />
              </div>
              {notice.error && (
                <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600">
                  {notice.error}
                </div>
              )}
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={isSaving || isAddingAlbum}
                  className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
                >
                  이전 단계
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadedApplicationContinue()}
                  disabled={
                    isSaving ||
                    isAddingAlbum ||
                    isPreparingDraft ||
                    isContinuingDownloadedApplication
                  }
                  className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
                >
                  {isContinuingDownloadedApplication || isPreparingDraft
                    ? "업로드 단계 준비 중..."
                    : "파일 업로드로 이동"}
                </button>
              </div>
            </div>
          ) : (
            <>

              {step === 2 && (
                <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  기본 정보
                </p>
                {!isOneClick ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        앨범 제목 *
                      </label>
                      <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        아티스트명 공식 표기 *
                      </label>
                      <input
                        value={artistName}
                        onChange={(event) => setArtistName(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        아티스트 한글명 *
                      </label>
                      <input
                        value={artistNameKr}
                        onChange={(event) => setArtistNameKr(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        아티스트 영문명 *
                      </label>
                      <input
                        value={artistNameEn}
                        onChange={(event) => setArtistNameEn(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        발매일 *
                      </label>
                      <input
                        type="date"
                        value={releaseDate}
                        onChange={(event) => setReleaseDate(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        장르 *
                      </label>
                      <select
                        value={genreSelection}
                        onChange={(event) => setGenreSelection(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      >
                        <option value="">장르 선택</option>
                        {genreOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    {genreSelection === "기타" && (
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          기타 장르 입력 *
                        </label>
                        <input
                          value={genreCustom}
                          onChange={(event) => setGenreCustom(event.target.value)}
                          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        유통사 *
                      </label>
                      <input
                        value={distributor}
                        onChange={(event) => setDistributor(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        제작사 *
                      </label>
                      <input
                        value={productionCompany}
                        onChange={(event) => setProductionCompany(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        이전 발매곡 *
                      </label>
                      <textarea
                        value={previousRelease}
                        onChange={(event) => setPreviousRelease(event.target.value)}
                        placeholder="가장 최근 발매한 1곡을 적어주세요. 신인인 경우 신인이라고 표기해주세요."
                        className="h-20 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        그룹/솔로 *
                      </label>
                      <select
                        value={artistType}
                        onChange={(event) => setArtistType(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      >
                        <option value="">선택</option>
                        <option value="GROUP">그룹</option>
                        <option value="SOLO">솔로</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        성별 *
                      </label>
                      <select
                        value={artistGender}
                        onChange={(event) => setArtistGender(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      >
                        {genderOptions.map((option) => (
                          <option key={option.value || "empty"} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {artistType === "GROUP" && (
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          팀원 전체 이름 *
                        </label>
                        <input
                          value={artistMembers}
                          onChange={(event) => setArtistMembers(event.target.value)}
                          placeholder="그룹인 경우 팀원 전체의 이름을 적어주세요."
                          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-[14px] border-2 border-[#111111] bg-background p-4 text-foreground shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27] sm:p-5">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] text-xs font-black text-[#111111]"
                        >
                          1
                        </span>
                        <p className="text-sm font-black">
                          원클릭 접수 안내
                        </p>
                      </div>
                      <p className="mt-3 text-sm font-semibold leading-6 text-foreground/80">
                        이미 발매된 음원만 신청할 수 있습니다.
                      </p>
                      <ul
                        aria-label="필수 제출 항목"
                        className="mt-4 grid grid-cols-3 gap-2"
                      >
                        {["멜론 링크", "접수자 정보", "음원 파일"].map(
                          (item) => (
                            <li
                              key={item}
                              className="flex min-h-10 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-1.5 py-2 text-center text-[11px] font-black leading-4 text-[#111111] sm:px-3 sm:text-xs"
                            >
                              {item}
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          멜론 링크 *
                        </label>
                        <input
                          value={melonUrl}
                          onChange={(event) => setMelonUrl(event.target.value)}
                          placeholder="https://www.melon.com/..."
                          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-6">
                  <AiUsageSelector
                    value={aiUsed}
                    onChange={(nextValue) => {
                      setAiUsed(nextValue);
                      setNotice({});
                    }}
                    context="album"
                  />
                </div>

                <div className="mt-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                    접수자 정보
                  </p>
                  {isGuest && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      이름과 이메일은 심의 조회시에 사용됩니다.
                    </p>
                  )}
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        접수자 *
                      </label>
                      <input
                        value={applicantName}
                        onChange={(event) => setApplicantName(event.target.value)}
                        required
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        이메일 *
                      </label>
                      <input
                        type="email"
                        value={applicantEmail}
                        onChange={(event) => setApplicantEmail(event.target.value)}
                        required
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        연락처 *
                      </label>
                      <input
                        value={applicantPhone}
                        onChange={(event) => setApplicantPhone(event.target.value)}
                        required
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                  </div>
                </div>
                </div>
              )}

              {step === 3 && !isOneClick && (
                <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                      트랙 정보
                    </p>
                    <span className="text-xs text-muted-foreground">
                      총 {tracks.length}곡
                    </span>
                  </div>
                  <div className="mt-5 grid gap-6 md:grid-cols-[200px_1fr]">
                    <div className="space-y-3">
                      <div className="flex gap-2 overflow-x-auto pb-2 md:max-h-[60vh] md:block md:space-y-2 md:overflow-y-auto md:overflow-x-hidden md:pb-0 md:pr-1">
                        {tracks.map((track, index) => {
                        const active = index === activeTrackIndex;
                        return (
                          <button
                            key={`track-tab-${index}`}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setActiveTrackIndex(index)}
                            className={`w-[150px] shrink-0 rounded-2xl border px-3 py-3 text-left transition md:w-full ${active
                              ? "border-foreground bg-foreground text-background"
                              : "border-border/60 bg-background text-foreground hover:border-foreground"
                              }`}
                          >
                            <p className="text-xs font-semibold uppercase tracking-[0.2em]">
                              Track {String(index + 1).padStart(2, "0")}
                            </p>
                            <p className="mt-1 text-xs opacity-80">
                              {getTrackDisplayTitle(track)}
                            </p>
                            {track.performer.trim() && (
                              <p className="mt-1 truncate text-[11px] opacity-70">
                                {track.performer.trim()}
                              </p>
                            )}
                            <div
                              className={`mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em] ${active ? "text-background" : ""
                                }`}
                            >
                              {track.isTitle && (
                                <span
                                  className={`rounded-full border px-2 py-1 ${track.titleRole === "MAIN"
                                    ? active
                                      ? "border-[#f6d64a] bg-[#f6d64a] text-black shadow-sm"
                                      : "border-[#f6d64a] bg-[#f6d64a] text-black shadow-sm dark:border-[#f6d64a] dark:bg-[#f6d64a] dark:text-black"
                                    : active
                                      ? "border-background/80 bg-background text-foreground shadow-sm"
                                      : "border-border/60 bg-background/80 text-foreground/80"
                                    }`}
                                >
                                  {track.titleRole === "MAIN"
                                    ? "메인 타이틀"
                                    : "서브 타이틀"}
                                </span>
                              )}
                              {track.broadcastSelected && (
                                <span
                                  className={`rounded-full border px-2 py-1 ${active
                                    ? "border-emerald-200 bg-emerald-100 text-emerald-800 shadow-sm"
                                    : "border-emerald-300 text-emerald-600 dark:text-emerald-200"
                                    }`}
                                >
                                  원음방송
                                </span>
                              )}
                            </div>
                          </button>
                        );
                        })}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
                        <button
                          type="button"
                          onClick={addTrackWithSameCredits}
                          className="w-full rounded-2xl border border-foreground bg-foreground px-3 py-3 text-xs font-semibold text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black"
                        >
                          같은 참여진으로 추가
                        </button>
                        <button
                          type="button"
                          onClick={addBlankTrack}
                          className="w-full rounded-2xl border border-dashed border-border/70 px-3 py-3 text-xs font-semibold text-muted-foreground transition hover:border-foreground hover:text-foreground"
                        >
                          빈 트랙 추가
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            트랙 {activeTrackIndex + 1}
                          </p>
                          {tracks.length > 1 && (
                            <button
                              type="button"
                              onClick={applyCurrentCreditsToBlankTracks}
                              className="rounded-full border border-border/70 bg-background px-3 py-1 text-[11px] font-semibold text-foreground transition hover:border-foreground"
                            >
                              현재 참여진을 빈칸에 적용
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={activeTrack.isTitle}
                              onChange={() => toggleTitleTrack(activeTrackIndex)}
                              className="h-4 w-4 rounded border-border accent-[#f6d64a]"
                            />
                            타이틀
                          </label>
                          {activeTrack.isTitle && (
                            <label className="flex items-center gap-2 rounded-full border border-[#f6d64a] bg-[#f6d64a] px-3 py-1 text-[13px] font-semibold text-black shadow-sm transition dark:border-[#f6d64a] dark:bg-[#f6d64a] dark:text-black">
                              <input
                                type="radio"
                                checked={activeTrack.titleRole === "MAIN"}
                                onChange={() => setMainTitleTrack(activeTrackIndex)}
                                className="h-4 w-4 rounded-full border border-black/60 bg-white accent-black shadow-sm"
                              />
                              메인 타이틀
                            </label>
                          )}
                          {requiresBroadcastSelection && (
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={activeTrack.broadcastSelected}
                                onChange={() =>
                                  toggleBroadcastTrack(activeTrackIndex)
                                }
                                className="h-4 w-4 rounded border-border"
                              />
                              원음방송 심의곡
                            </label>
                          )}
                          {tracks.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeTrack(activeTrackIndex)}
                              className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-400 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-500/70 dark:bg-rose-500/15 dark:text-rose-200 dark:hover:border-rose-400 dark:hover:bg-rose-500/25 dark:hover:text-rose-100"
                            >
                              트랙 삭제
                            </button>
                          )}
                        </div>
                      </div>
                      {requiresBroadcastSelection && (
                        <div className="mt-3 rounded-2xl border border-[#f6d64a] bg-[#f6d64a] px-3 py-2 text-xs text-black dark:border-[#f6d64a] dark:bg-[#f6d64a] dark:text-black">
                          {broadcastRequirementMessage} (선택 {broadcastCount}/3)
                        </div>
                      )}
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            곡명 *
                          </label>
                          <input
                            value={activeTrack.trackTitle}
                            onChange={(event) =>
                              updateTrack(
                                activeTrackIndex,
                                "trackTitle",
                                event.target.value,
                              )
                            }
                            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            가수명 *
                          </label>
                          <input
                            value={activeTrack.performer}
                            onChange={(event) =>
                              updateTrack(
                                activeTrackIndex,
                                "performer",
                                event.target.value,
                              )
                            }
                            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            피처링
                          </label>
                          <input
                            value={activeTrack.featuring}
                            placeholder="피처링이 있는 경우 피처링 아티스트"
                            onChange={(event) =>
                              updateTrack(
                                activeTrackIndex,
                                "featuring",
                                event.target.value,
                              )
                            }
                            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            작곡 *
                          </label>
                          <input
                            value={activeTrack.composer}
                            onChange={(event) =>
                              updateTrack(
                                activeTrackIndex,
                                "composer",
                                event.target.value,
                              )
                            }
                            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            작사
                          </label>
                          <input
                            value={activeTrack.lyricist}
                            placeholder="연주곡/MR/Inst. 인 경우 비워두세요"
                            onChange={(event) =>
                              updateTrack(
                                activeTrackIndex,
                                "lyricist",
                                event.target.value,
                              )
                            }
                            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            편곡
                          </label>
                          <input
                            value={activeTrack.arranger}
                            onChange={(event) =>
                              updateTrack(
                                activeTrackIndex,
                                "arranger",
                                event.target.value,
                              )
                            }
                            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            가사
                          </label>
                          <div className="group/lyrics-tools">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={handleProfanityCheck}
                                className="rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5 active:translate-y-0 active:shadow-none cursor-pointer"
                              >
                                욕설 체크
                              </button>
                              <button
                                type="button"
                                onClick={handleTranslateLyrics}
                                disabled={isTranslatingLyrics}
                                className="rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5 active:translate-y-0 active:shadow-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                자동번역 {isTranslatingLyrics ? "중..." : ""}
                              </button>
                            </div>
                            {showLyricsToolNotice && (
                              <div className="pointer-events-none mt-0 max-h-0 overflow-hidden rounded-2xl border border-transparent bg-transparent px-4 py-0 text-sm font-semibold leading-relaxed text-primary opacity-0 transition-all duration-300 ease-out group-hover/lyrics-tools:pointer-events-auto group-hover/lyrics-tools:mt-2 group-hover/lyrics-tools:max-h-64 group-hover/lyrics-tools:border-primary/20 group-hover/lyrics-tools:bg-primary/8 group-hover/lyrics-tools:py-3 group-hover/lyrics-tools:opacity-100 group-focus-within/lyrics-tools:pointer-events-auto group-focus-within/lyrics-tools:mt-2 group-focus-within/lyrics-tools:max-h-64 group-focus-within/lyrics-tools:border-primary/20 group-focus-within/lyrics-tools:bg-primary/8 group-focus-within/lyrics-tools:py-3 group-focus-within/lyrics-tools:opacity-100 dark:text-[#8bc3ff]">
                                위 기능은 최소한의 보조수단입니다. 하단 유의사항을 꼭
                                체크해주세요.
                              </div>
                            )}
                          </div>
                          <div className="relative isolate overflow-hidden rounded-2xl border border-border/70 bg-background transition focus-within:border-foreground">
                            {showProfanityOverlay && (
                              <div
                                ref={lyricsOverlayRef}
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-0 z-10 overflow-y-auto px-4 py-3 text-sm leading-relaxed text-foreground"
                              >
                                <div className="whitespace-pre-wrap">
                                  {renderProfanityPreview(
                                    activeTrack.lyrics,
                                    profanityPattern,
                                    profanityTestPattern,
                                  )}
                                </div>
                              </div>
                            )}
                            <textarea
                              ref={lyricsTextareaRef}
                              value={activeTrack.lyrics}
                              onChange={(event) =>
                                updateTrack(
                                  activeTrackIndex,
                                  "lyrics",
                                  event.target.value,
                                )
                              }
                              onScroll={handleLyricsScroll}
                              className={`relative z-0 min-h-[180px] w-full resize-y overflow-y-auto bg-transparent px-4 py-3 text-sm leading-relaxed outline-none ${showProfanityOverlay
                                ? "text-transparent caret-foreground"
                                : "text-foreground"
                                }`}
                            />
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={toggleTranslationPanel}
                                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition ${showTranslatedLyricsPanel
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-border/70 text-muted-foreground hover:border-foreground hover:text-foreground"
                                  }`}
                              >
                                번역본 가사 탭
                              </button>
                              <p className="text-[11px] font-semibold text-muted-foreground">
                                한국어 외 언어가 일부라도 있는 경우 번역본 제출 필수
                              </p>
                            </div>
                            {needsTranslatedLyrics && !activeTrack.translatedLyrics.trim() && (
                              <p className="mt-2 text-[11px] font-semibold text-red-600">
                                한국어 외 언어가 포함된 가사는 번역본을 반드시 입력해야
                                제출할 수 있습니다.
                              </p>
                            )}
                          </div>
                          {showTranslatedLyricsPanel && (
                            <div className="space-y-2">
                              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                                번역본 가사
                                {needsTranslatedLyrics ? " *" : ""}
                              </label>
                              <textarea
                                value={activeTrack.translatedLyrics}
                                onChange={(event) =>
                                  updateTrack(
                                    activeTrackIndex,
                                    "translatedLyrics",
                                    event.target.value,
                                  )
                                }
                                placeholder="가사 번역본을 입력해주세요."
                                className="min-h-[140px] w-full resize-y rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm leading-relaxed text-foreground outline-none transition focus:border-foreground"
                              />
                            </div>
                          )}
                          {showLyricsTabs && (
                            <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs text-foreground">
                              {showProfanityPanel && (
                                <div className="mt-3 space-y-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                                    감지된 단어
                                  </p>
                                  <div className="max-h-32 space-y-2 overflow-auto pr-1">
                                    {profanityHighlightMap[activeTrackIndex] &&
                                      profanityWords.length > 0 ? (
                                      profanityWords.map((word) => (
                                        <div
                                          key={word}
                                          className="rounded-xl border border-border/60 bg-background/80 px-3 py-2 text-[11px] font-semibold text-red-600"
                                        >
                                          {word}
                                        </div>
                                      ))
                                    ) : (
                                      <div className="rounded-xl border border-dashed border-border/60 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                                        {profanityHighlightMap[activeTrackIndex]
                                          ? "회피 패턴이 감지되었습니다."
                                          : "욕설이 감지되지 않았습니다."}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          <div className="group rounded-2xl border border-border/60 bg-background/70 px-3 py-3 text-xs text-muted-foreground transition-all duration-200 group-hover:[&_li]:text-sm group-hover:[&_li]:leading-relaxed group-hover:[&_p]:text-xs">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                              유의사항
                            </p>
                            <ul className="mt-2 space-y-1">
                              {lyricCautions.map((note) => (
                                <li key={note} className="list-disc pl-4">
                                  {note}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            특이사항
                          </label>
                          <input
                            value={activeTrack.notes}
                            onChange={(event) =>
                              updateTrack(
                                activeTrackIndex,
                                "notes",
                                event.target.value,
                              )
                            }
                            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && albumDrafts.length > 0 && (
                <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                    등록 앨범 목록
                  </p>
                  <div className="mt-3 space-y-2">
                    {albumDrafts.map((draft, index) => (
                      <div
                        key={draft.submissionId}
                        onClick={() => void startEditingDraft(index)}
                        role="button"
                        tabIndex={0}
                        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs transition ${editingIndex === index
                          ? "border-[#f6d64a] bg-[#f6d64a] text-black"
                          : "border-border/60 bg-background/70 hover:border-foreground"
                          }`}
                      >
                        <div>
                          <p
                            className={`text-sm font-semibold ${editingIndex === index ? "text-black" : "text-foreground"
                              }`}
                          >
                            앨범 {index + 1}
                            {editingIndex === index && (
                              <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-black/70">
                                수정 중
                              </span>
                            )}
                          </p>
                          <p
                            className={`text-xs ${editingIndex === index
                              ? "text-black/80"
                              : "text-muted-foreground"
                              }`}
                          >
                            {(draft.title.trim() ||
                              (isOneClick ? "원클릭 접수" : "제목 미입력")) +
                              " · " +
                              (draft.artistName.trim() ||
                                (isOneClick ? "원클릭 접수" : "아티스트 미입력"))}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeAlbumDraft(index);
                          }}
                          className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:border-foreground hover:text-foreground"
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {notice.submissionId && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-600">
                  임시 저장이 완료되었습니다.
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setStep(step === 2 ? 1 : 2)}
                  disabled={isSaving || isAddingAlbum}
                  className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
                >
                  {step === 2 ? "이전 단계" : "기본 정보 수정"}
                </button>
                {step === 3 && (
                  <button
                    type="button"
                    onClick={() => void handleTrackTemporarySave()}
                    disabled={isSaving || isAddingAlbum}
                    className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
                  >
                    트랙 임시 저장
                  </button>
                )}
                {step === 3 && (
                  <button
                    type="button"
                    onClick={handleAddAlbum}
                    disabled={isSaving || isAddingAlbum}
                    className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
                  >
                    {editingIndex !== null ? "선택 앨범 수정 저장" : "추가 앨범 등록"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={
                    step === 2 ? handleBasicInfoNext : handleTrackInfoNext
                  }
                  disabled={
                    isSaving ||
                    isAddingAlbum ||
                    (step === 3 && editingIndex !== null)
                  }
                  className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
                >
                  {step === 2
                    ? isOneClick
                      ? "저장하고 파일 업로드"
                      : "저장하고 트랙 정보 입력"
                    : "파일 업로드로 이동"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-8">
          {isDraggingOver && (
            <div className="pointer-events-none fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]" />
          )}
          <h2 className="font-display text-2xl text-foreground">파일 첨부</h2>

          <details className="rounded-[20px] border border-border/60 bg-background/70 px-5 py-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-semibold text-foreground">
              파일 준비 기준
            </summary>
            <ul className="mt-3 grid gap-2 leading-5 sm:grid-cols-3">
              <li>WAV·MP3·ZIP / HWP·DOC·DOCX</li>
              <li>신청서와 음원·CD 트랙 순서 일치</li>
              <li>업로드가 어려우면 파일 없이 진행 가능</li>
            </ul>
          </details>

          {uploadDrafts && uploadDrafts.length > 0 && (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                업로드 앨범
              </p>
              <div className="mt-3 space-y-2">
                {uploadDrafts.map((draft, index) => (
                  <div
                    key={draft.submissionId}
                    onClick={() => handleSelectUploadDraft(index)}
                    role="button"
                    tabIndex={0}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs transition ${uploadDraftIndex === index
                      ? "border-[#f6d64a] bg-[#f6d64a] text-black"
                      : "border-border/60 bg-background/70 hover:border-foreground"
                      }`}
                  >
                    <div>
                      <p
                        className={`text-sm font-semibold ${uploadDraftIndex === index
                          ? "text-black"
                          : "text-foreground"
                          }`}
                      >
                        앨범 {index + 1}
                      </p>
                      <p
                        className={`text-xs ${uploadDraftIndex === index
                          ? "text-black/80"
                          : "text-muted-foreground"
                          }`}
                      >
                        {(draft.title.trim() ||
                          (isOneClick ? "원클릭 접수" : "제목 미입력")) +
                          " · " +
                          (draft.artistName.trim() ||
                            (isOneClick ? "원클릭 접수" : "아티스트 미입력"))}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${uploadDraftIndex === index
                        ? "text-black/80"
                        : "text-muted-foreground"
                        }`}
                    >
                      {draft.files.length > 0
                        ? "업로드 완료"
                        : draft.emailSubmitConfirmed
                          ? "이메일 제출"
                          : "업로드 필요"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              전체 음원 파일 업로드
            </p>
            <div className="mt-4 grid gap-2 rounded-2xl border border-border/70 bg-background/70 p-1 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => selectUploadDeliveryMode("upload")}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${!emailSubmitConfirmed
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  }`}
              >
                파일 업로드
              </button>
              <button
                type="button"
                onClick={() => selectUploadDeliveryMode("email")}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${emailSubmitConfirmed
                  ? "bg-[#1556a4] text-white shadow-sm dark:bg-[#3f8ad8] dark:text-[#06111f]"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  }`}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px] font-black ${emailSubmitConfirmed
                      ? "border-white bg-white text-[#1556a4] dark:border-[#06111f] dark:bg-[#06111f] dark:text-[#3f8ad8]"
                      : "border-current"
                      }`}
                  >
                    {emailSubmitConfirmed ? "✓" : ""}
                  </span>
                  파일 없이 진행
                </span>
              </button>
            </div>
            {emailSubmitConfirmed ? (
              <div className="mt-4 rounded-2xl border-2 border-primary/25 bg-primary/8 px-4 py-5 text-sm text-foreground shadow-[4px_4px_0_rgba(0,113,227,0.18)] dark:border-[#2997ff]/35 dark:bg-[#2997ff]/12">
                <p className="text-xs font-semibold text-muted-foreground">
                  파일 첨부 대신 아래 이메일 주소로 음원 파일을 보내주세요.
                </p>
                <p className="mt-3 break-all rounded-xl border border-primary/20 bg-background/90 px-3 py-2 font-semibold text-primary dark:border-[#2997ff]/30 dark:text-[#8bc3ff]">
                  {APP_CONFIG.supportEmail}
                </p>
                <div className="mt-3 rounded-xl border border-border/60 bg-background/80 px-3 py-3 text-xs leading-5 text-muted-foreground">
                  <p className="font-semibold text-foreground">메일 제목 예시</p>
                  <p className="mt-1 break-all">
                    [음반심의 파일] {artistName.trim() || "아티스트명"} / {title.trim() || "앨범명"} / {applicantName.trim() || "신청자명"}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4">
                  <label
                    className="relative block"
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setIsDraggingOver(true);
                    }}
                    onDragEnter={() => setIsDraggingOver(true)}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setIsDraggingOver(false);
                    }}
                    onDrop={(event) => {
                      setIsDraggingOver(false);
                      onDropFiles(event);
                    }}
                  >
                    <span className="sr-only">파일 첨부</span>
                    <input
                      type="file"
                      multiple
                      accept=".wav,.mp3,.zip,.hwp,.doc,.docx,audio/wav,audio/mpeg,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={onFileChange}
                      className="hidden"
                      disabled={!currentSubmissionId || isPreparingDraft}
                    />
                    <div className="flex min-h-[120px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-6 text-sm font-semibold text-foreground transition hover:border-foreground">
                      <span>
                        {currentSubmissionId
                          ? "파일 첨부 (드래그 앤 드롭 가능)"
                          : isPreparingDraft
                            ? "접수 ID 준비 중... 잠시 후 첨부 가능"
                            : draftError || "접수 ID 준비 중... 다시 시도해주세요."}
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-full border border-black bg-gradient-to-br from-black to-slate-900 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white shadow-sm">
                        허용 형식: <span className="font-mono text-[12px]">WAV/MP3/ZIP/HWP/DOC/DOCX</span>
                        <span className="text-white/70">·</span>
                        최대 <span className="font-mono text-[12px]">{uploadMaxLabel}</span>
                      </span>
                      <span className="text-center text-[11px] font-normal text-muted-foreground">
                        * 수록곡이 많은 경우 ZIP으로 압축한 하나의 파일로 업로드해주세요.
                      </span>
                      {!currentSubmissionId && !isPreparingDraft ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void createDraft({ force: true });
                          }}
                          className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-[12px] font-semibold tracking-[0.16em] text-primary-foreground transition hover:bg-[#0077ed] dark:bg-[#2997ff] dark:text-[#00101f] dark:hover:bg-[#45a6ff]"
                        >
                          다시 시도
                        </button>
                      ) : null}
                    </div>
                    {isDraggingOver && (
                      <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-[#f6d64a] bg-black/10 backdrop-blur-[1px]" />
                    )}
                  </label>
                </div>
                <div className="mt-4 space-y-3">
                  {uploads.map((upload, index) => (
                    <div
                      key={`${upload.name}-${index}`}
                      className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-foreground">
                          {upload.name}
                        </span>
                        <div className="flex items-center gap-3">
                          {upload.status === "done" ? (
                            <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
                              첨부 완료
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {upload.status === "uploading"
                                ? `업로드 중 · ${upload.progress}%`
                                : upload.status === "error"
                                  ? "실패"
                                  : "대기"}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const nextFiles = [...files];
                              nextFiles.splice(index, 1);
                              const nextUploads = [...uploads];
                              nextUploads.splice(index, 1);
                              setFiles(nextFiles);
                              setUploads(nextUploads);
                              setUploadedFiles((prev) =>
                                prev.filter((_, idx) => idx !== index),
                              );
                              setFileDigest("");
                            }}
                            className="rounded-full border border-border/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:border-rose-400 hover:text-rose-500"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-foreground transition-all"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {uploads.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-center text-xs text-muted-foreground">
                      <p className="font-semibold text-foreground">
                        선택된 파일이 없습니다.
                      </p>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        파일 첨부 없이 다음 단계로 진행하려면 이메일 제출을 선택하세요.
                      </p>
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => selectUploadDeliveryMode("email")}
                          className="rounded-full border border-border/70 bg-background px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
                        >
                          파일 없이 진행
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              <p>
                음원 파일 첨부가 정상적으로 완료되지 않는 경우, 파일 없이 다음 단계로 진행하거나 예전 온사이드 사이트에서 접수해주세요.
              </p>
              {isOneClick && (
                <p>원클릭 접수도 동일하게 파일 없이 다음 단계로 진행할 수 있습니다.</p>
              )}
              {!emailSubmitConfirmed ? (
                <p className="font-semibold text-foreground">
                  {APP_CONFIG.supportEmail}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                CD 제작 등 실물 앨범을 발표한 경우{" "}
                <button
                  type="button"
                  onClick={() => setShowCdInfo(true)}
                  className="font-semibold text-primary transition hover:text-primary/80"
                >
                  자세히 보기 →
                </button>
              </p>
            </div>
          </div>

          {notice.error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600">
              {notice.error}
            </div>
          )}
          {notice.submissionId && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-600">
              임시 저장이 완료되었습니다.
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setStep(hasTrackStep ? 3 : 2)}
              disabled={isSaving || isAddingAlbum}
              className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
            >
              이전 단계
            </button>
            {!isGuest && (
              <button
                type="button"
                onClick={async () => {
                  const draftsForUpload = resolveUploadDrafts();
                  if (!draftsForUpload) return;
                  const uploadsReady =
                    uploads.length > 0 &&
                    uploads.every((upload) => upload.status === "done");
                  const includeFiles = uploadsReady || emailSubmitConfirmed;
                  await saveAlbumDrafts(draftsForUpload, { includeFiles });
                }}
                disabled={isSaving || isAddingAlbum}
                className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
              >
                임시 저장
              </button>
            )}
            <button
              type="button"
              onClick={handleStep3Next}
              disabled={isSaving || isAddingAlbum}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
            >
              다음 단계
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-8">
          <h2 className="font-display text-2xl text-foreground">신청 내용 확인</h2>

          {albumPaymentBlockers.length > 0 ? (
            <div
              role="alert"
              className="rounded-[28px] border-2 border-[#f2cf27] bg-[rgba(242,207,39,0.18)] p-5 shadow-[4px_4px_0_rgba(17,17,17,0.2)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground">
                확인 필요
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {albumPaymentBlockers.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-[#111111] bg-background px-4 py-3 text-sm text-foreground"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">
                        {item.label}
                      </p>
                      <span
                        aria-hidden="true"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-[5px] border border-[#111111] bg-[#f2cf27] text-[11px] font-black text-[#111111]"
                      >
                        !
                      </span>
                    </div>
                    <p className="mt-2 font-semibold leading-5">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                선택 상품
              </p>
              {selectedPackageSummary ? (
                <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-black text-foreground">
                      {getPackageDisplayName(
                        selectedPackageSummary,
                        isOneClick,
                      )}
                    </p>
                    {totalAlbumCount > 1 ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        총 {totalAlbumCount}건
                      </p>
                    ) : null}
                  </div>
                  {isOneClick ? (
                    <span className="inline-flex rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      원클릭 접수
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  선택된 패키지가 없습니다.
                </p>
              )}
            </div>

            <div className="rounded-[28px] border border-border/60 bg-card/80 p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                결제 금액
              </p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">정상가</span>
                  <span
                    className={
                      hasPaymentSummaryDiscount
                        ? "font-semibold text-muted-foreground line-through"
                        : "font-black text-foreground"
                    }
                  >
                    {formatCurrency(originalTotalPriceKrw)}원
                  </span>
                </div>
                {hasPaymentSummaryDiscount ? (
                  <>
                    {albumEventDiscountTotalKrw > 0 ? (
                      <div className="flex items-center justify-between gap-4 text-[#1556a4] dark:text-[#8bc3ff]">
                        <span>오픈 기념 할인</span>
                        <span className="font-black">
                          -{formatCurrency(albumEventDiscountTotalKrw)}원
                        </span>
                      </div>
                    ) : null}
                    {hasAdditionalAlbumDiscount ? (
                      <div className="flex items-center justify-between gap-4 text-[#1556a4] dark:text-[#8bc3ff]">
                        <span>2번째 앨범부터 50% 할인</span>
                        <span className="font-black">
                          -{formatCurrency(additionalAlbumDiscountTotalKrw)}원
                        </span>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div className="mt-5 rounded-[18px] border-2 border-[#111111] bg-background px-4 py-4 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27] sm:flex sm:items-end sm:justify-between sm:gap-4">
                <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
                  최종 결제 금액
                </p>
                <p className="mt-2 text-right text-[28px] font-black leading-none tracking-tight text-foreground sm:mt-0 sm:text-[34px]">
                  {formatCurrency(totalPriceKrw)}원
                </p>
              </div>
            </div>

            <details className="rounded-[20px] border border-border/60 bg-background/70 px-5 py-4 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-semibold text-foreground">
                결제 전 안내
              </summary>
              <ul className="mt-3 grid gap-2 leading-5 sm:grid-cols-2">
                <li>예상 기간 · 영업일 기준 최대 3주</li>
                <li>부가세·증빙 서류 신청 가능</li>
                <li>접수 전 취소 조건 확인</li>
                <li>누락 자료는 보완 후 진행</li>
              </ul>
            </details>
          </div>

          {isGuest && !usesSubmissionCartCheckout ? (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                결제 방식 선택
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("BANK")}
                  className={`rounded-2xl border p-4 text-left transition ${paymentMethod === "BANK"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-background text-foreground hover:border-foreground"
                    }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                    무통장
                  </p>
                  <p className="mt-2 text-sm font-semibold">무통장 입금</p>
                  <p className="mt-2 text-xs opacity-80">
                    입금 확인 후 진행이 시작됩니다.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("CARD")}
                  className={`rounded-2xl border p-4 text-left transition ${paymentMethod === "CARD"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-background text-foreground hover:border-foreground"
                    }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                    카드
                  </p>
                  <p className="mt-2 text-sm font-semibold">카드 결제</p>
                  <p className="mt-2 text-xs opacity-80">
                    {additionalAlbumCount > 0
                      ? "추가 앨범 할인 금액까지 합산해 카드 결제합니다."
                      : "카드 결제로 진행할 수 있습니다."}
                  </p>
                </button>
              </div>
            </div>
          ) : null}

          {isGuest && !usesSubmissionCartCheckout && paymentMethod === "BANK" && (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                무통장 입금 안내
              </p>
              <div className="mt-4 grid gap-4 text-sm text-foreground md:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">은행</p>
                  <p className="mt-1 font-semibold">{APP_CONFIG.bankName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">계좌번호</p>
                  <p className="mt-1 font-semibold">{APP_CONFIG.bankAccount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">예금주</p>
                  <p className="mt-1 font-semibold">{APP_CONFIG.bankHolder}</p>
                </div>
              </div>
              <div className="mt-6 space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  입금자명
                </label>
                <input
                  value={bankDepositorName}
                  onChange={(event) => setBankDepositorName(event.target.value)}
                  placeholder="입금자명을 입력해주세요."
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="mt-5 rounded-2xl border border-border/60 bg-background/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  결제 서류 옵션
                </p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (paymentDocumentType === "CASH_RECEIPT") {
                        setPaymentDocumentType("");
                        setCashReceiptPurpose("");
                        setCashReceiptPhone("");
                        setCashReceiptBusinessNumber("");
                        return;
                      }
                      setPaymentDocumentType("CASH_RECEIPT");
                      setTaxInvoiceBusinessNumber("");
                      clearTaxInvoiceCertificate();
                    }}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${paymentDocumentType === "CASH_RECEIPT"
                      ? "border-foreground bg-foreground/5 text-foreground"
                      : "border-border/70 bg-background text-muted-foreground hover:border-foreground"
                      }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px] font-black ${paymentDocumentType === "CASH_RECEIPT"
                        ? "border-foreground bg-foreground text-background"
                        : "border-current"
                        }`}
                    >
                      {paymentDocumentType === "CASH_RECEIPT" ? "✓" : ""}
                    </span>
                    현금 영수증 발급
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (paymentDocumentType === "TAX_INVOICE") {
                        setPaymentDocumentType("");
                        setTaxInvoiceBusinessNumber("");
                        clearTaxInvoiceCertificate();
                        return;
                      }
                      setPaymentDocumentType("TAX_INVOICE");
                      setCashReceiptPurpose("");
                      setCashReceiptPhone("");
                      setCashReceiptBusinessNumber("");
                    }}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${paymentDocumentType === "TAX_INVOICE"
                      ? "border-foreground bg-foreground/5 text-foreground"
                      : "border-border/70 bg-background text-muted-foreground hover:border-foreground"
                      }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px] font-black ${paymentDocumentType === "TAX_INVOICE"
                        ? "border-foreground bg-foreground text-background"
                        : "border-current"
                        }`}
                    >
                      {paymentDocumentType === "TAX_INVOICE" ? "✓" : ""}
                    </span>
                    세금계산서 발급
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  * 결제 연관 서류는 기재해주신 이메일로 전송됩니다.
                </p>
                {paymentDocumentType === "CASH_RECEIPT" && (
                  <div className="mt-4 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION"
                          ? "border-foreground bg-foreground/5 text-foreground"
                          : "border-border/70 bg-background text-muted-foreground hover:border-foreground"
                          }`}
                      >
                        <input
                          type="radio"
                          name="album-cash-receipt-purpose"
                          checked={
                            cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION"
                          }
                          onChange={() => {
                            setCashReceiptPurpose("PERSONAL_INCOME_DEDUCTION");
                            setCashReceiptBusinessNumber("");
                          }}
                          className="h-4 w-4 accent-foreground"
                        />
                        개인소득공제용
                      </label>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
                          ? "border-foreground bg-foreground/5 text-foreground"
                          : "border-border/70 bg-background text-muted-foreground hover:border-foreground"
                          }`}
                      >
                        <input
                          type="radio"
                          name="album-cash-receipt-purpose"
                          checked={
                            cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
                          }
                          onChange={() => {
                            setCashReceiptPurpose("BUSINESS_EXPENSE_PROOF");
                            setCashReceiptPhone("");
                          }}
                          className="h-4 w-4 accent-foreground"
                        />
                        사업자지출증빙용
                      </label>
                    </div>
                    {cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION" && (
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          휴대폰 번호
                        </label>
                        <input
                          value={cashReceiptPhone}
                          onChange={(event) =>
                            setCashReceiptPhone(event.target.value)
                          }
                          placeholder="휴대폰 번호를 입력해주세요."
                          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                        />
                      </div>
                    )}
                    {cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF" && (
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          사업자번호
                        </label>
                        <input
                          value={cashReceiptBusinessNumber}
                          onChange={(event) =>
                            setCashReceiptBusinessNumber(event.target.value)
                          }
                          placeholder="사업자번호 10자리를 입력해주세요."
                          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                        />
                      </div>
                    )}
                  </div>
                )}
                {paymentDocumentType === "TAX_INVOICE" && (
                  <div className="mt-4 space-y-3">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      사업자번호
                    </label>
                    <input
                      value={taxInvoiceBusinessNumber}
                      onChange={(event) =>
                        setTaxInvoiceBusinessNumber(event.target.value)
                      }
                      placeholder="사업자번호 10자리를 입력해주세요."
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                    />
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        사업자등록증 첨부
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <label className="flex min-h-[48px] flex-1 cursor-pointer items-center justify-between rounded-2xl border border-dashed border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground transition hover:border-foreground hover:text-foreground">
                          <span className="truncate">
                            {taxInvoiceCertificateFile?.name ??
                              "PDF, JPG, PNG 파일 선택"}
                          </span>
                          <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.2em]">
                            첨부
                          </span>
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                            className="sr-only"
                            onChange={handleTaxInvoiceCertificateChange}
                          />
                        </label>
                        {taxInvoiceCertificateFile ? (
                          <button
                            type="button"
                            onClick={clearTaxInvoiceCertificate}
                            className="rounded-2xl border border-border/70 px-4 py-3 text-xs font-semibold text-muted-foreground transition hover:border-foreground hover:text-foreground"
                          >
                            삭제
                          </button>
                        ) : null}
                      </div>
                      {taxInvoiceCertificateUpload ? (
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          {taxInvoiceCertificateUpload.status === "uploading"
                            ? `업로드 중 ${taxInvoiceCertificateUpload.progress}%`
                            : taxInvoiceCertificateUpload.status === "done"
                              ? "사업자등록증 첨부 완료"
                              : taxInvoiceCertificateUpload.status === "error"
                                ? "사업자등록증 업로드 실패"
                                : "선택된 파일은 제출 시 업로드됩니다."}
                        </p>
                      ) : (
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          세금계산서 발급을 위해 사업자등록증을 첨부해주세요.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {isGuest && !usesSubmissionCartCheckout && paymentMethod === "CARD" && (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm text-muted-foreground">
              카드 결제 선택 시 이니시스 결제 모듈이 열립니다. 팝업이 차단된 경우 팝업 해제 후 다시 시도해주세요.
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setStep(4)}
              className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white"
            >
              이전 단계
            </button>
            <button
              type="button"
              onClick={() => handleSave("SUBMITTED", { deferPayment: true })}
              disabled={isSaving || isAddingAlbum || !albumPaymentReady}
              className="rounded-full border border-border/70 bg-background px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              장바구니에 담기
            </button>
            <button
              type="button"
              onClick={() =>
                handleSave("SUBMITTED", {
                  deferPayment: true,
                  redirectToCart: true,
                })
              }
              disabled={isSaving || isAddingAlbum || !albumPaymentReady}
              className="rounded-full border-2 border-[#111111] bg-[var(--bauhaus-red)] px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-white shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#b92d25] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0 dark:border-[#f2cf27] dark:text-[#06111f] dark:shadow-[2px_2px_0_#f2cf27] dark:hover:bg-[#ff7a72]"
            >
              담고 결제하기
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-center sm:rounded-[32px] sm:p-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/12 text-2xl text-emerald-600">
            ✓
          </div>
          <h2 className="font-display mt-4 text-3xl text-foreground">접수 완료</h2>
          {notice.emailNotice ? (
            <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm text-primary dark:border-[#2997ff]/30 dark:bg-[#2997ff]/12 dark:text-[#8bc3ff]">
              {notice.emailNotice}
            </div>
          ) : null}
          {completionId && !shouldShowGuestLookup && (
            <button
              type="button"
              onClick={() =>
                router.push(`${localePrefix}/dashboard?tab=album&refresh=1`)
              }
              className="mt-6 rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5"
            >
              진행 상황 보기
            </button>
          )}
          {completionCodesToShow.length > 0 && (
            <div className="mt-6 space-y-3">
              <p className="text-xs text-muted-foreground">조회 코드</p>
              <div className="space-y-2">
                {completionCodesToShow.map((item, index) => (
                  <div
                    key={`${item.token}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs"
                  >
                    <span className="font-semibold text-foreground">
                      {item.title || `앨범 ${index + 1}`}
                    </span>
                    <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
                      <span className="max-w-full break-all font-mono text-foreground">
                        {item.token}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(item.token)
                            .catch(() => null)
                        }
                        className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-black hover:bg-black hover:text-white"
                      >
                        코드 복사
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `${localePrefix}/track/${encodeURIComponent(item.token)}`,
                          )
                        }
                        className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-black hover:bg-black hover:text-white"
                      >
                        조회
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {packageConfirmTarget && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4 py-4"
          onClick={handleCancelPackage}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="패키지 선택 확인"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-border/60 bg-background p-5 shadow-xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              확인
            </p>
            <p className="mt-2 text-lg font-semibold">
              {`${getPackageDisplayName(
                packageConfirmTarget,
                isOneClick,
              )}로 진행할까요?`}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              선택을 확정하면 기본 정보 단계로 이동합니다.
            </p>
            {(packageGuidance[packageConfirmTarget.stationCount]?.conditional ?? [])
              .length > 0 ? (
              <div className="mt-4 rounded-xl border border-[#f2cf27] bg-[#f2cf27]/15 p-3">
                <p className="text-xs font-black">선택 조건</p>
                {(packageGuidance[packageConfirmTarget.stationCount]?.conditional ?? []).map(
                  (item) => (
                    <p
                      key={item}
                      className="mt-1 text-xs font-semibold leading-5 text-muted-foreground"
                    >
                      {item}
                    </p>
                  ),
                )}
              </div>
            ) : null}
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={handleCancelPackage}
                className="flex-1 rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:text-slate-900 dark:hover:text-foreground"
              >
                아니오
              </button>
              <button
                type="button"
                onClick={handleConfirmPackage}
                className="flex-1 rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-[#f6d64a] hover:text-black"
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}

      {notice.error && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4 py-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="입력 확인"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-border/60 bg-background p-5 shadow-xl sm:p-6"
          >
            <p className="text-sm font-semibold text-foreground">
              입력 확인이 필요합니다.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {notice.error}
            </p>
            <button
              type="button"
              onClick={() =>
                setNotice((prev) => ({ ...prev, error: undefined }))
              }
              className="mt-6 w-full rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-[#f6d64a] hover:text-black"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {showCdInfo && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4 py-4"
          onClick={() => setShowCdInfo(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="CD 발송 및 제작 안내"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border/60 bg-background p-5 shadow-xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-foreground">
              CD 발송, CD 제작
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              디지털 발매 음반은 심의용 CD와 가사집을 무료 제작해드립니다.
              반면 오프라인 정식 발매 음반은 실제 음반으로 심의를 진행합니다.
            </p>
            <p className="mt-4 text-xs font-semibold text-foreground">
              보내실 주소
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {APP_CONFIG.businessAddress}
            </p>
            <p className="mt-4 text-xs font-semibold text-foreground">
              보내실 CD 장수
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>옵션 1 (7개 방송국) — 18장</li>
              <li>옵션 2 (10개 방송국) — 23장</li>
              <li>옵션 3 (13개 방송국) — 30장</li>
            </ul>
            <button
              type="button"
              onClick={() => setShowCdInfo(false)}
              className="mt-6 w-full rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-[#f6d64a] hover:text-black"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {showOneclickNotice && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4 py-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="원클릭 접수 안내"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-border/60 bg-background p-5 shadow-xl sm:p-6"
          >
            <p className="text-sm font-semibold text-foreground">
              원클릭 접수는 이미 발매된 앨범만 진행 가능합니다. 확인하셨나요?
            </p>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsOneClick(false);
                  setShowOneclickNotice(false);
                }}
                className="flex-1 rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:text-slate-900 dark:hover:text-foreground"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => setShowOneclickNotice(false)}
                className="flex-1 rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-[#f6d64a] hover:text-black"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
