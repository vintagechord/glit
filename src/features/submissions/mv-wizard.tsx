"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PendingOverlay } from "@/components/ui/pending-overlay";
import { showCenteredConfirm } from "@/lib/centered-dialog";
import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import { addGuestSubmissionCartEntries } from "@/lib/guest-submission-cart";
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
  requestLyricsTranslations,
} from "@/lib/lyrics-tools";
import {
  isApplicationFormFile,
  isApplicationFormMime,
  isVideoUploadFile,
  mvApplicationForms,
} from "@/lib/submission-files";
import {
  buildMvSubmissionPreflight,
  type ExistingMvCartSubmissionSnapshot,
  type SubmissionPreflightTarget,
} from "@/lib/submission-preflight";
import { getSubmissionCheckpointStorageKey } from "@/lib/submission-checkpoint";
import {
  areSubmissionUploadMetadataEqual,
  mergeSubmissionUploadMetadata,
} from "@/lib/submission-upload-metadata";
import { runProfanityCheck } from "@/lib/profanity/check";
import {
  buildProfanityExtraRules,
  buildLegacyProfanityMatchers,
  extractProfanityWords,
  type ProfanityTerm,
} from "@/lib/profanity/legacy";
import { safeRandomUUID } from "@/lib/uuid";

import {
  saveMvSubmissionAction,
  type SubmissionActionState,
} from "./actions";
import { AiUsageSelector } from "./ai-usage-selector";
import { ApplicationFormModeTabs } from "./application-form-mode-tabs";
import { SubmissionPreflightPanel } from "./submission-preflight-panel";
import { SubmissionProgress } from "./submission-progress";
import { SubmissionSaveIndicator } from "./submission-save-indicator";
import { useSubmissionCheckpoint } from "./use-submission-checkpoint";

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

type UploadItem = {
  name: string;
  size: number;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  path?: string;
  mime?: string;
  localKey?: string;
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

const stripCheckpointAccessUrl = (file: UploadResult): UploadResult => {
  const safeFile = { ...file };
  delete safeFile.accessUrl;
  return safeFile;
};

type ApplicationFormMode = "online" | "upload";

type MvCheckpointSnapshot = {
  step: number;
  applicationFormMode: ApplicationFormMode | null;
  mvType: "MV_DISTRIBUTION" | "MV_BROADCAST";
  tvStations: string[];
  onlineOptions: string[];
  onlineBaseSelected: boolean;
  title: string;
  artistName: string;
  artistNameOfficial: string;
  director: string;
  leadActor: string;
  storyline: string;
  productionCompany: string;
  agency: string;
  albumTitle: string;
  distributionCompany: string;
  usage: string;
  desiredRating: string;
  memo: string;
  songTitleKr: string;
  songTitleEn: string;
  songTitleOfficial: string;
  composer: string;
  lyricist: string;
  arranger: string;
  songMemo: string;
  lyrics: string;
  releaseDate: string;
  genre: string;
  runtime: string;
  format: string;
  aiUsed: boolean | null;
  guestName: string;
  guestCompany: string;
  guestEmail: string;
  guestPhone: string;
  paymentMethod: "CARD" | "BANK";
  bankDepositorName: string;
  paymentDocumentType: PaymentDocumentType;
  cashReceiptPurpose: CashReceiptPurpose;
  uploadedFiles: UploadResult[];
  emailSubmitConfirmed: boolean;
  existingCartSubmission: ExistingMvCartSubmissionSnapshot | null;
};

type MvCheckpointController = {
  runExclusive: <T>(task: () => Promise<T>) => Promise<T>;
  markSaved: (snapshot?: MvCheckpointSnapshot, savedAt?: number) => void;
  clear: () => void;
};

type PaymentDocumentType = "" | "CASH_RECEIPT" | "TAX_INVOICE";
type CashReceiptPurpose =
  | ""
  | "PERSONAL_INCOME_DEDUCTION"
  | "BUSINESS_EXPENSE_PROOF";
type MvValidationField =
  | "title"
  | "artistName"
  | "artistNameOfficial"
  | "releaseDate"
  | "director"
  | "leadActor"
  | "productionCompany"
  | "agency"
  | "albumTitle"
  | "distributionCompany"
  | "usage"
  | "songTitleKr"
  | "songTitleEn"
  | "songTitleOfficial"
  | "composer"
  | "storyline"
  | "lyrics"
  | "aiUsed"
  | "guestName"
  | "guestEmail"
  | "guestPhone";

const steps = [
  "목적 선택",
  "작성 방식 선택",
  "신청서 작성",
  "파일 업로드",
  "최종 점검",
  "접수 완료",
];

const deferredPaymentNotice = "신청서를 장바구니에 담았습니다.";
const paymentFailureStorageNotice = "신청서는 장바구니에 보관됩니다.";
const paymentFailureDraftNotice =
  `결제에 실패했습니다. ${paymentFailureStorageNotice}`;

const getLocalUploadKey = (file: File) =>
  `${file.name}\u0000${file.size}\u0000${file.lastModified}`;

const selectedBadgeClass =
  "inline-flex items-center rounded-full border-2 border-[#111111] bg-[#111111] px-3 py-1 text-[11px] font-black tracking-normal text-[#f2cf27] shadow-[2px_2px_0_rgba(0,0,0,0.24)] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]";

const uploadMaxMb = Number(
  process.env.NEXT_PUBLIC_VIDEO_UPLOAD_MAX_MB ??
  process.env.NEXT_PUBLIC_UPLOAD_MAX_MB ??
  "4096",
);
const uploadMaxBytes = uploadMaxMb * 1024 * 1024;
const uploadMaxLabel =
  uploadMaxMb >= 1024
    ? `${Math.round(uploadMaxMb / 1024)}GB`
    : `${uploadMaxMb}MB`;
const adminReviewEmail =
  process.env.NEXT_PUBLIC_ADMIN_REVIEW_EMAIL ?? APP_CONFIG.supportEmail;
const draftDeleteTimeoutMs = 8000;
const usesSubmissionCartCheckout = true;
const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");

const multipartThresholdMbRaw = Number(
  process.env.NEXT_PUBLIC_UPLOAD_MULTIPART_THRESHOLD_MB ?? "200",
);
const multipartThresholdMb = Number.isFinite(multipartThresholdMbRaw)
  ? Math.max(5, Math.min(128, multipartThresholdMbRaw))
  : 128;
const multipartThresholdBytes = multipartThresholdMb * 1024 * 1024;

const baseOnlinePrice = 30000;
const etnOptionPrice = 30000;
const stationPriceMap: Record<string, number> = {
  KBS: 50000,
  MBC: 30000,
  SBS: 30000,
  ETN: etnOptionPrice,
  MNET: 30000,
};
const tvStationCodes = ["KBS", "MBC", "SBS", "ETN"];
const onlineOptionCodes = ["MBC", "MNET", "ETN"];
const tvStationDetails: Record<string, { title: string; note: string }> = {
  KBS: {
    title: "KBS 뮤직비디오 심의",
    note: "KBS는 1분 30초 편집본 제출이 필요합니다.",
  },
  MBC: {
    title: "MBC 뮤직비디오 심의",
    note: "심의 완료 후 MBC 방송 송출이 가능합니다.",
  },
  SBS: {
    title: "SBS 뮤직비디오 심의",
    note: "심의 완료 후 SBS 방송 송출이 가능합니다.",
  },
  ETN: {
    title: "ETN 뮤직비디오 입고",
    note: "온라인 심의 완료 후 ETN 방송 입고 가능합니다.",
  },
};
const onlineOptionDetails: Record<string, { title: string; note: string }> = {
  MBC: {
    title: "MBC 뮤직비디오 심의",
    note: "MBC M 방송 아티스트에 한해 심의 가능합니다.",
  },
  MNET: {
    title: "Mnet 뮤직비디오 심의",
    note: "방송 일정이 있는 경우에만 문의해주세요.",
  },
  ETN: {
    title: "ETN 입고 옵션",
    note: "온라인 심의 완료된 영상에 한하여 ETN 방송 '입고'만 가능합니다.",
  },
};
const conditionalOnlineOptions = new Set(["MBC", "MNET", "ETN"]);

const onlineOptionConfirmDetails: Record<
  string,
  { title: string; lines: string[] }
> = {
  MBC: {
    title: "MBC 뮤직비디오 심의 안내",
    lines: [
      "2020.06.25부터 MBC M (<쇼챔피언>, <주간아이돌> 등) 방송되는 아티스트 뮤직비디오에 한해 심의 가능.",
      "심의 영상은 온라인용으로 사용 가능합니다.",
      "심의 완료 후 등급분류 + MBC 로고 삽입본 사용 가능.",
      "파일 용량 2GB 미만.",
    ],
  },
  MNET: {
    title: "Mnet 뮤직비디오 심의 안내",
    lines: [
      "자사 편성 계획 뮤직비디오 외 등급심의가 불가합니다. 방송 일정이 있는 경우만 문의 주세요.",
      "심의 완료 시 등급분류 + Mnet 로고를 삽입하여 온라인 유통이 가능합니다.",
      "제출 규격: WMV 또는 MPG",
      "파일 용량 1GB 미만.",
    ],
  },
  ETN: {
    title: "ETN 입고 옵션 안내",
    lines: [
      "온라인 심의 완료된 영상에 한하여 ETN 방송 '입고'만 가능합니다.",
    ],
  },
};
const onlineOptionConfirmNote =
  "위 내용을 확인하셨다면 [확인]을 눌러주세요.";

const mvOptionToneClasses = [
  "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[6px_6px_0_#f2cf27]",
  "border-[#111111] bg-[#1556a4] text-white shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f] dark:shadow-[6px_6px_0_#f2cf27]",
  "border-[#111111] bg-[#d9362c] text-white shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#ff6258] dark:text-[#111111] dark:shadow-[6px_6px_0_#f2cf27]",
  "border-[#111111] bg-white text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[6px_6px_0_#f2cf27]",
];

type BroadcastSpecFields = {
  format?: string[];
  codec?: string[];
  resolution?: string;
  fps?: string;
  maxSize?: string;
  duration?: string;
  note?: string;
};

type BroadcastSpec = {
  id: string;
  title: string;
  summaryBadges: string[];
  fields: BroadcastSpecFields;
};

const broadcastSpecs: BroadcastSpec[] = [
  {
    id: "KBS",
    title: "KBS",
    summaryBadges: ["MOV", "≤1.5GB", "30초 편집본", "ProRes LT/422"],
    fields: {
      format: ["MOV"],
      codec: ["Apple ProRes (ProRes LT / 422)"],
      maxSize: "1.5GB 이하",
      duration: "30초 편집본 제출",
    },
  },
  {
    id: "MBC",
    title: "MBC",
    summaryBadges: ["MOV", "1920×1080", "29.97fps", "≤4GB"],
    fields: {
      format: ["MOV"],
      resolution: "1920×1080",
      fps: "29.97fps",
      maxSize: "4GB 이하",
    },
  },
  {
    id: "SBS",
    title: "SBS",
    summaryBadges: ["MOV/MP4/WMV", "1920×1080", "29.97fps"],
    fields: {
      format: ["MOV", "MP4", "WMV"],
      resolution: "1920×1080",
      fps: "29.97fps",
    },
  },
];

const broadcastFieldLabels: Array<{
  key: keyof BroadcastSpecFields;
  label: string;
}> = [
    { key: "format", label: "파일 형식(컨테이너)" },
    { key: "codec", label: "코덱/프로파일" },
    { key: "resolution", label: "해상도" },
    { key: "fps", label: "프레임레이트" },
    { key: "maxSize", label: "최대 용량" },
    { key: "duration", label: "길이 제한" },
    { key: "note", label: "비고/추가 조건" },
  ];

export function MvWizard({
  stations,
  userId,
  userEmail,
  profanityTerms = [],
  profanityFilterV2Enabled = false,
}: {
  stations: StationOption[];
  userId?: string | null;
  userEmail?: string | null;
  profanityTerms?: ProfanityTerm[];
  profanityFilterV2Enabled?: boolean;
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
  const [applicationFormMode, setApplicationFormMode] =
    React.useState<ApplicationFormMode | null>(null);
  const requestedType = searchParams?.get("type");
  const [mvType, setMvType] = React.useState<"MV_DISTRIBUTION" | "MV_BROADCAST">(
    requestedType === "broadcast" ? "MV_BROADCAST" : "MV_DISTRIBUTION",
  );
  const [tvStations, setTvStations] = React.useState<string[]>([]);
  const [onlineOptions, setOnlineOptions] = React.useState<string[]>([]);
  const [onlineBaseSelected, setOnlineBaseSelected] = React.useState(true);
  const [title, setTitle] = React.useState("");
  const [artistName, setArtistName] = React.useState("");
  const [artistNameOfficial, setArtistNameOfficial] = React.useState("");
  const [director, setDirector] = React.useState("");
  const [leadActor, setLeadActor] = React.useState("");
  const [storyline, setStoryline] = React.useState("");
  const [productionCompany, setProductionCompany] = React.useState("");
  const [agency, setAgency] = React.useState("");
  const [albumTitle, setAlbumTitle] = React.useState("");
  const [distributionCompany, setDistributionCompany] = React.useState("");
  const [usage, setUsage] = React.useState("");
  const [desiredRating, setDesiredRating] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [songTitleKr, setSongTitleKr] = React.useState("");
  const [songTitleEn, setSongTitleEn] = React.useState("");
  const [songTitleOfficial, setSongTitleOfficial] = React.useState("");
  const [composer, setComposer] = React.useState("");
  const [lyricist, setLyricist] = React.useState("");
  const [arranger, setArranger] = React.useState("");
  const [songMemo, setSongMemo] = React.useState("");
  const [lyrics, setLyrics] = React.useState("");
  const [releaseDate, setReleaseDate] = React.useState("");
  const [genre, setGenre] = React.useState("");
  const [runtime, setRuntime] = React.useState("");
  const [format, setFormat] = React.useState("");
  const [aiUsed, setAiUsed] = React.useState<boolean | null>(null);
  const [guestName, setGuestName] = React.useState("");
  const [guestCompany, setGuestCompany] = React.useState("");
  const [guestEmail, setGuestEmail] = React.useState("");
  const [guestPhone, setGuestPhone] = React.useState("");
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
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);
  const uploadInProgress = uploads.some((upload) => upload.status === "uploading");
  const [isSaving, setIsSaving] = React.useState(false);
  const [resumeChecked, setResumeChecked] = React.useState(false);
  const [resumePrompt, setResumePrompt] = React.useState<{
    draft: Record<string, unknown>;
    stored: {
      id?: string;
      updatedAt?: number;
      guestToken?: string;
      mvType?: string;
      tvStations?: string[];
      onlineOptions?: string[];
      onlineBaseSelected?: boolean;
      emailSubmitConfirmed?: boolean;
      applicationFormMode?: ApplicationFormMode;
      existingCartSubmission?: ExistingMvCartSubmissionSnapshot;
    } | null;
    storedGuestToken?: string | null;
  } | null>(null);
  const [isClearingResumeDrafts, setIsClearingResumeDrafts] = React.useState(false);
  const resumePromptHandledRef = React.useRef(false);
  const draftInitAttemptedRef = React.useRef(false);
  const draftCreationPromiseRef = React.useRef<Promise<string | null> | null>(
    null,
  );
  const [isPreparingDraft, setIsPreparingDraft] = React.useState(false);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [currentServerUpdatedAt, setCurrentServerUpdatedAt] =
    React.useState<string | null>(null);
  const [checkpointSeed, setCheckpointSeed] = React.useState<{
    submissionId: string;
    initialDataIsServerState: boolean;
  } | null>(null);
  const [resumeDeleteError, setResumeDeleteError] = React.useState<string | null>(
    null,
  );
  const [openBroadcastSpec, setOpenBroadcastSpec] =
    React.useState<string | null>(null);
  const mvCheckpointControllerRef =
    React.useRef<MvCheckpointController | null>(null);
  const draftSaveInFlightRef = React.useRef(false);
  const submitInFlightRef = React.useRef(false);
  const serverUploadedFilesRef = React.useRef<UploadResult[]>([]);
  const checkpointRestoreSourceRef = React.useRef<"recovery" | "previous">(
    "recovery",
  );

  const [notice, setNotice] = React.useState<SubmissionActionState>({});
  const [existingCartSubmission, setExistingCartSubmission] =
    React.useState<ExistingMvCartSubmissionSnapshot | null>(null);
  const [priceChangeAcknowledged, setPriceChangeAcknowledged] =
    React.useState(false);
  const [invalidField, setInvalidField] =
    React.useState<MvValidationField | null>(null);
  const lyricsOverlayRef = React.useRef<HTMLDivElement | null>(null);
  const lyricsTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [lyricsToolApplied, setLyricsToolApplied] = React.useState(false);
  const [profanityChecked, setProfanityChecked] = React.useState(false);
  const [profanityHighlight, setProfanityHighlight] = React.useState(false);
  const [lyricsToolNotice, setLyricsToolNotice] = React.useState<{
    type: "error" | "info" | "success";
    message: string;
  } | null>(null);
  const [isTranslatingLyrics, setIsTranslatingLyrics] = React.useState(false);
  const [isCheckingProfanity, setIsCheckingProfanity] = React.useState(false);
  const [loadedProfanityTerms, setLoadedProfanityTerms] =
    React.useState<ProfanityTerm[]>(profanityTerms);
  const [profanityTermsLoaded, setProfanityTermsLoaded] = React.useState(
    profanityTerms.length > 0,
  );
  const profanityTermsRef = React.useRef<ProfanityTerm[]>(profanityTerms);
  const profanityTermsRequestRef = React.useRef<Promise<ProfanityTerm[]> | null>(
    null,
  );
  const [confirmModal, setConfirmModal] = React.useState<{
    code: string;
    title: string;
    lines: string[];
  } | null>(null);
  const [completionId, setCompletionId] = React.useState<string | null>(null);
  const [completionGuestToken, setCompletionGuestToken] = React.useState<
    string | null
  >(null);
  const submissionIdRef = React.useRef<string | null>(null);
  const guestTokenRef = React.useRef<string | null>(null);
  const draftStorageKey = React.useMemo(
    () => `onside:draft:mv:${userId ?? "guest"}`,
    [userId],
  );
  const guestTokenStorageKey = React.useMemo(
    () => `onside:guest-token:mv:${userId ?? "guest"}`,
    [userId],
  );
  const profanityMatchers = React.useMemo(
    () => buildLegacyProfanityMatchers(loadedProfanityTerms),
    [loadedProfanityTerms],
  );
  const isProfanityFilterV2Enabled = Boolean(profanityFilterV2Enabled);
  const profanityPattern = profanityMatchers?.pattern ?? null;
  const profanityTestPattern = profanityMatchers?.testPattern ?? null;
  const profanityWords = extractProfanityWords(lyrics, profanityPattern);
  const showLyricsToolNotice = lyricsToolApplied;
  const showProfanityOverlay =
    profanityChecked && profanityHighlight && profanityWords.length > 0;

  React.useEffect(() => {
    const nextType =
      requestedType === "broadcast" ? "MV_BROADCAST" : "MV_DISTRIBUTION";
    setMvType((current) => {
      if (current === nextType) return current;
      return nextType;
    });
    if (nextType === "MV_BROADCAST") {
      setOnlineOptions([]);
      setOnlineBaseSelected(true);
      setDesiredRating("");
    } else {
      setTvStations([]);
    }
  }, [requestedType]);

  React.useEffect(() => {
    profanityTermsRef.current = loadedProfanityTerms;
  }, [loadedProfanityTerms]);

  React.useEffect(() => {
    if (profanityTerms.length === 0) return;
    setLoadedProfanityTerms(profanityTerms);
    setProfanityTermsLoaded(true);
    profanityTermsRef.current = profanityTerms;
  }, [profanityTerms]);

  const ensureProfanityTerms = React.useCallback(async () => {
    if (profanityTermsLoaded) {
      return profanityTermsRef.current;
    }
    if (!profanityTermsRequestRef.current) {
      profanityTermsRequestRef.current = fetch("/api/profanity/terms", {
        cache: "force-cache",
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as
            | { terms?: ProfanityTerm[]; error?: string }
            | null;
          if (!res.ok || json?.error) {
            throw new Error(json?.error || "PROFANITY_TERMS_QUERY_FAILED");
          }
          return Array.isArray(json?.terms) ? json.terms : [];
        })
        .finally(() => {
          profanityTermsRequestRef.current = null;
        });
    }

    const terms = await profanityTermsRequestRef.current;
    setLoadedProfanityTerms(terms);
    setProfanityTermsLoaded(true);
    profanityTermsRef.current = terms;
    return terms;
  }, [profanityTermsLoaded]);
  const clearInvalidField = React.useCallback((field: MvValidationField) => {
    setInvalidField((current) => (current === field ? null : current));
  }, []);
  const markInvalidField = React.useCallback(
    (field: MvValidationField, message: string) => {
      setInvalidField(field);
      setNotice({ error: message });
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          const element = document.querySelector<HTMLElement>(
            `[data-mv-field="${field}"]`,
          );
          element?.scrollIntoView({ behavior: "smooth", block: "center" });
          element?.focus({ preventScroll: true });
        });
      }
      return false;
    },
    [],
  );
  const requiredFieldClass = React.useCallback(
    (field: MvValidationField) =>
      `w-full rounded-2xl border bg-background px-4 py-3 text-sm text-foreground outline-none transition ${invalidField === field
        ? "border-red-500 ring-2 ring-red-500/20 focus:border-red-500"
        : "border-border/70 focus:border-foreground"
      }`,
    [invalidField],
  );

  if (!guestTokenRef.current) {
    guestTokenRef.current = safeRandomUUID();
  }

  const readDraftStorage = React.useCallback(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        id?: string;
        updatedAt?: number;
        guestToken?: string;
        mvType?: string;
        tvStations?: string[];
        onlineOptions?: string[];
        onlineBaseSelected?: boolean;
        emailSubmitConfirmed?: boolean;
        applicationFormMode?: ApplicationFormMode;
        existingCartSubmission?: ExistingMvCartSubmissionSnapshot;
      };
    } catch {
      return null;
    }
  }, [draftStorageKey]);

  const writeDraftStorage = React.useCallback((payload: {
    id: string;
    guestToken?: string | null;
    mvType?: string;
    tvStations?: string[];
    onlineOptions?: string[];
    onlineBaseSelected?: boolean;
    emailSubmitConfirmed?: boolean;
    applicationFormMode?: ApplicationFormMode;
    existingCartSubmission?: ExistingMvCartSubmissionSnapshot | null;
  }) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          id: payload.id,
          guestToken: payload.guestToken ?? null,
          mvType: payload.mvType,
          tvStations: payload.tvStations ?? [],
          onlineOptions: payload.onlineOptions ?? [],
          onlineBaseSelected: payload.onlineBaseSelected ?? true,
          emailSubmitConfirmed: payload.emailSubmitConfirmed ?? false,
          applicationFormMode: payload.applicationFormMode,
          existingCartSubmission: payload.existingCartSubmission ?? null,
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // ignore
    }
  }, [draftStorageKey]);

  const clearDraftStorageForSubmission = React.useCallback(
    (submissionId: string) => {
      if (typeof window === "undefined" || !submissionId) return;
      try {
        const raw = window.localStorage.getItem(draftStorageKey);
        if (raw) {
          const stored = JSON.parse(raw) as { id?: unknown };
          if (stored.id === submissionId) {
            window.localStorage.removeItem(draftStorageKey);
          }
        }
      } catch {
        // Ignore a malformed locator without widening the cleanup scope.
      }
      try {
        window.localStorage.removeItem(
          getSubmissionCheckpointStorageKey(draftStorageKey, submissionId),
        );
      } catch {
        // A successful server deletion remains authoritative. Exact checkpoint
        // cleanup is best effort when browser storage is unavailable.
      }
    },
    [draftStorageKey],
  );

  const clearServerDrafts = React.useCallback(async (options: {
    ids: string[];
    guestToken?: string | null;
  }) => {
    const ids = Array.from(new Set(options.ids.filter(Boolean)));
    if (ids.length === 0) {
      throw new Error("삭제할 임시저장 신청서를 확인하지 못했습니다.");
    }
    const payload: {
      type: "MV";
      ids: string[];
      guestToken?: string;
    } = {
      type: "MV",
      ids,
    };
    if (isGuest) {
      const guestToken = options.guestToken ?? guestTokenRef.current;
      if (guestToken) payload.guestToken = guestToken;
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
  }, [isGuest]);

  const clearCartSubmission = React.useCallback(async (
    submissionId: string,
    guestToken?: string | null,
  ) => {
    const res = await fetch("/api/cart/items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionIds: [submissionId],
        guestTokensBySubmissionId:
          isGuest && guestToken ? { [submissionId]: guestToken } : undefined,
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(json?.error || "장바구니 신청서를 삭제하지 못했습니다.");
    }
  }, [isGuest]);

  React.useEffect(() => {
    if (!isGuest || typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(guestTokenStorageKey);
      if (stored) {
        guestTokenRef.current = stored;
      } else if (guestTokenRef.current) {
        window.localStorage.setItem(guestTokenStorageKey, guestTokenRef.current);
      }
    } catch {
      // ignore
    }
  }, [guestTokenStorageKey, isGuest]);

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
      const submissionFromMsg = (payload.submissionId as string | undefined) || submissionIdRef.current;
      const guestTokenFromMsg = payload.guestToken as string | undefined;
      const guestPaymentToken = isGuest
        ? guestTokenFromMsg || guestTokenRef.current
        : guestTokenFromMsg;
      if (status === "SUCCESS") {
        if (submissionFromMsg) {
          clearDraftStorageForSubmission(submissionFromMsg);
        }
        if (guestPaymentToken) {
          window.location.href = `${localePrefix}/track/${encodeURIComponent(guestPaymentToken)}?payment=success`;
          return;
        }
        if (submissionFromMsg) {
          window.location.href = `${localePrefix}/dashboard/submissions/${encodeURIComponent(submissionFromMsg)}?payment=success`;
          return;
        }
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
        if (submissionFromMsg) {
          window.location.href = `${localePrefix}/dashboard/submissions/${encodeURIComponent(submissionFromMsg)}?payment=${paymentState}`;
          return;
        }
        setNotice({ error: message });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [clearDraftStorageForSubmission, isGuest, localePrefix]);

  const requireSubmissionId = React.useCallback(() => {
    if (submissionIdRef.current) return submissionIdRef.current;
    throw new Error("접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }, []);

  const createDraft = React.useCallback(async (options?: { force?: boolean }) => {
    if (submissionIdRef.current) return submissionIdRef.current;
    if (draftCreationPromiseRef.current) {
      return draftCreationPromiseRef.current;
    }
    if (!options?.force && draftInitAttemptedRef.current) {
      return submissionIdRef.current || null;
    }
    draftInitAttemptedRef.current = true;
    const draftPromise = (async () => {
      setIsPreparingDraft(true);
      setDraftError(null);
      try {
        const res = await fetch("/api/submissions/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: mvType,
            guestToken: isGuest ? guestTokenRef.current : undefined,
          }),
        });
        const json = (await res.json().catch(() => null)) as {
          submissionId?: string;
          guestToken?: string;
          error?: string;
        };
        if (res.ok && json?.submissionId) {
          if (isGuest && json.guestToken) {
            guestTokenRef.current = json.guestToken;
            if (typeof window !== "undefined") {
              try {
                window.localStorage.setItem(guestTokenStorageKey, json.guestToken);
              } catch {
                // ignore storage errors
              }
            }
          }
          submissionIdRef.current = json.submissionId;
          setCheckpointSeed({
            submissionId: json.submissionId,
            initialDataIsServerState: false,
          });
          serverUploadedFilesRef.current = [];
          writeDraftStorage({
            id: json.submissionId,
            guestToken: isGuest ? guestTokenRef.current : null,
            mvType,
            tvStations,
            onlineOptions,
            onlineBaseSelected,
            emailSubmitConfirmed,
            applicationFormMode: applicationFormMode ?? undefined,
            existingCartSubmission,
          });
          return json.submissionId;
        }
        setDraftError(
          json?.error ||
          "접수 초안을 생성하지 못했습니다. 새로고침 후 다시 시도해주세요.",
        );
      } catch (error) {
        setDraftError(
          error instanceof Error
            ? error.message
            : "접수 초안을 생성하지 못했습니다. 새로고침 후 다시 시도해주세요.",
        );
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
  }, [
    applicationFormMode,
    emailSubmitConfirmed,
    existingCartSubmission,
    guestTokenStorageKey,
    isGuest,
    mvType,
    onlineBaseSelected,
    onlineOptions,
    tvStations,
    writeDraftStorage,
  ]);

  React.useEffect(() => {
    if (!resumeChecked) return;
    if (submissionIdRef.current || isPreparingDraft) return;
    void createDraft();
  }, [createDraft, isPreparingDraft, resumeChecked]);

  const guestToken = guestTokenRef.current;
  const shouldShowGuestLookup = isGuest || Boolean(completionGuestToken);
  const guestLookupCode = completionGuestToken ?? guestToken ?? completionId;
  const stationMap = React.useMemo(
    () => new Map(stations.map((station) => [station.code, station])),
    [stations],
  );
  const selectedCodes = mvType === "MV_BROADCAST" ? tvStations : onlineOptions;
  const selectedStationIds = selectedCodes
    .map((code) => stationMap.get(code)?.id)
    .filter(Boolean) as string[];
  const selectedStationCodes = selectedCodes;
  const baseAmount =
    mvType === "MV_DISTRIBUTION" && onlineBaseSelected ? baseOnlinePrice : 0;
  const totalAmount =
    mvType === "MV_BROADCAST"
      ? selectedCodes.reduce(
        (sum, code) => sum + (stationPriceMap[code] ?? 0),
        0,
      )
      : baseAmount +
      selectedCodes.reduce(
        (sum, code) => sum + (stationPriceMap[code] ?? 0),
        0,
      );
  const canProceed =
    mvType === "MV_BROADCAST"
      ? tvStations.length > 0
      : onlineBaseSelected || onlineOptions.length > 0;
  const isDownloadedApplicationFlow = applicationFormMode === "upload";
  const selectApplicationFormMode = (mode: ApplicationFormMode) => {
    // Keep files when the user changes their mind. Validation and the final
    // payload are mode-aware, while switching back restores the exact work.
    setApplicationFormMode(mode);
    setNotice({});
  };
  const uploadChips = React.useMemo(() => {
    const chips: string[] = [];

    if (mvType === "MV_DISTRIBUTION") {
      chips.push(
        "권장 형식: MOV 또는 MP4",
        "해상도: 1920×1080 권장",
        "프레임: 29.97fps 권장",
        "편집 완료된 최종본만 접수",
      );
      if (onlineOptions.includes("MBC")) {
        chips.push("MBC: 파일 용량 2GB 미만");
      }
      if (onlineOptions.includes("MNET")) {
        chips.push("Mnet: WMV 또는 MPG", "Mnet: 파일 용량 1GB 미만");
      }
      return chips;
    }
    return [];
  }, [mvType, onlineOptions]);

  const paymentItems = React.useMemo(() => {
    const items: Array<{ title: string; amount: number }> = [];

    if (mvType === "MV_DISTRIBUTION") {
      if (onlineBaseSelected) {
        items.push({ title: "일반 뮤직비디오 심의", amount: baseOnlinePrice });
      }
      onlineOptions.forEach((code) => {
        const stationName = stationMap.get(code)?.name ?? code;
        const title =
          onlineOptionDetails[code]?.title ?? `${stationName} 옵션`;
        items.push({ title, amount: stationPriceMap[code] ?? 0 });
      });
      return items;
    }

    tvStations.forEach((code) => {
      const stationName = stationMap.get(code)?.name ?? code;
      const title = tvStationDetails[code]?.title ?? `${stationName} 심의`;
      items.push({ title, amount: stationPriceMap[code] ?? 0 });
    });

    return items;
  }, [mvType, onlineBaseSelected, onlineOptions, tvStations, stationMap]);
  const currentSubmissionId = submissionIdRef.current;
  const mvPreflight = React.useMemo(
    () =>
      buildMvSubmissionPreflight({
        submissionId: currentSubmissionId,
        mvType,
        applicationFormMode,
        selectedOptionCodes:
          mvType === "MV_BROADCAST" ? tvStations : onlineOptions,
        onlineBaseSelected,
        amountKrw: totalAmount,
        existingCartSubmission,
        priceChangeAcknowledged,
        isAdminReviewer,
        isGuest,
        title,
        artistName,
        artistNameOfficial,
        releaseDate,
        director,
        leadActor,
        productionCompany,
        agency,
        albumTitle,
        distributionCompany,
        usage,
        songTitleKr,
        songTitleEn,
        songTitleOfficial,
        composer,
        storyline,
        lyrics,
        aiUsed,
        guestName,
        guestEmail,
        guestPhone,
        files: uploadedFiles,
        uploads,
        filesSubmittedByEmail: emailSubmitConfirmed,
      }),
    [
      agency,
      aiUsed,
      albumTitle,
      applicationFormMode,
      artistName,
      artistNameOfficial,
      composer,
      currentSubmissionId,
      director,
      distributionCompany,
      emailSubmitConfirmed,
      existingCartSubmission,
      guestEmail,
      guestName,
      guestPhone,
      isAdminReviewer,
      isGuest,
      leadActor,
      lyrics,
      mvType,
      onlineBaseSelected,
      productionCompany,
      priceChangeAcknowledged,
      releaseDate,
      songTitleEn,
      songTitleKr,
      songTitleOfficial,
      storyline,
      title,
      totalAmount,
      tvStations,
      uploadedFiles,
      uploads,
      usage,
      onlineOptions,
    ],
  );
  React.useEffect(() => {
    setPriceChangeAcknowledged(false);
  }, [mvType, onlineBaseSelected, onlineOptions, totalAmount, tvStations]);
  const navigateFromPreflight = React.useCallback(
    (target: SubmissionPreflightTarget) => {
      setNotice({});
      setStep(target.step);
      if (typeof window === "undefined") return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const element = document.querySelector<HTMLElement>(
            `[data-preflight-field="${target.field}"], [data-mv-field="${target.field}"]`,
          );
          element?.scrollIntoView({ behavior: "smooth", block: "center" });
          element?.focus({ preventScroll: true });
        });
      });
    },
    [],
  );

  const stepLabels = <SubmissionProgress steps={steps} currentStep={step} />;

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";
    addFiles(selected);
  };

  const addFiles = (selected: File[]) => {
    if (uploads.some((upload) => upload.status === "uploading")) {
      setNotice({ error: "현재 파일 업로드가 끝난 뒤 추가해주세요." });
      return;
    }
    if (!submissionIdRef.current) {
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
      const isVideoFile = isVideoUploadFile(file.name, file.type);
      const isFormFile =
        isApplicationFormFile(file.name) || isApplicationFormMime(file.type);
      const isAllowed = isVideoFile || (isDownloadedApplicationFlow && isFormFile);
      if (!isAllowed) {
        invalidNotice = isDownloadedApplicationFlow
          ? "영상 파일(MP4/MOV/WMV/MPG) 또는 신청서 파일(HWP/DOC/DOCX)만 업로드할 수 있습니다."
          : "영상 파일(MP4/MOV/WMV/MPG)만 업로드할 수 있습니다.";
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

    const nextFileEntries = [...files];
    const seenLocalKeys = new Set(files.map(getLocalUploadKey));
    const nextUploads = uploads.map((upload) => ({ ...upload }));
    filtered.forEach((file) => {
      const localKey = getLocalUploadKey(file);
      if (seenLocalKeys.has(localKey)) return;
      seenLocalKeys.add(localKey);
      nextFileEntries.push(file);
      nextUploads.push({
        name: file.name,
        size: file.size,
        progress: 0,
        status: "pending",
        mime: file.type,
        localKey,
      });
    });
    setNotice({});
    setFiles(nextFileEntries);
    setUploads(nextUploads);
    setFileDigest("");
    setEmailSubmitConfirmed(false);
    void uploadFiles(nextFileEntries, nextUploads).catch((error: unknown) => {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "파일 업로드 중 오류가 발생했습니다.";
      console.error("[MvUpload] upload failed", error);
      setNotice({ error: message });
    });
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

  const uploadTaxInvoiceCertificate = async (
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
        guestToken: isGuest ? guestTokenRef.current ?? undefined : undefined,
        title: `${titleForUpload || "mv-tax-invoice"}-business-registration`,
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

  const isMobileDevice = () => {
    if (typeof navigator === "undefined") return false;
    return /iphone|ipad|ipod|android|mobile/i.test(navigator.userAgent);
  };

  const getMultipartConcurrency = () => {
    if (isMobileDevice()) return 3;
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 8 : 8;
    if (cores >= 12) return 8;
    if (cores >= 8) return 7;
    return 6;
  };

  const getVideoDuration = (file: File) =>
    new Promise<number | null>((resolve) => {
      if (typeof window === "undefined") {
        resolve(null);
        return;
      }
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const duration =
          Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : null;
        URL.revokeObjectURL(url);
        resolve(duration);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      video.src = url;
    });

  const putBlobWithProgress = async (
    url: string,
    blob: Blob,
    onProgress: (loaded: number, total: number) => void,
    options?: { contentType?: string },
  ) =>
    new Promise<string | null>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        onProgress(event.loaded, event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader("ETag");
          resolve(etag);
        } else {
          reject(new Error(`Upload failed (status ${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed (network/CORS)"));
      xhr.open("PUT", url);
      if (options?.contentType) {
        xhr.setRequestHeader("Content-Type", options.contentType);
      }
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

  const buildResumeKey = (submissionId: string, file: File) =>
    `mv-multipart:${submissionId}:${file.name}:${file.size}:${file.lastModified}`;

  const loadResumeState = (resumeKey: string): MultipartResumeState | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(resumeKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MultipartResumeState;
      if (!parsed.grantId || !parsed.uploadId || !parsed.key || !parsed.partSize) {
        window.localStorage.removeItem(resumeKey);
        return null;
      }
      const age = Date.now() - (parsed.createdAt ?? 0);
      if (age > 1000 * 60 * 60 * 24) {
        window.localStorage.removeItem(resumeKey);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const saveResumeState = (resumeKey: string, state: MultipartResumeState) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(resumeKey, JSON.stringify(state));
    } catch {
      // ignore storage errors
    }
  };

  const clearResumeState = (resumeKey: string) => {
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
    const chunkSize = 100;
    const urlMap = new Map<number, string>();
    for (let i = 0; i < params.partNumbers.length; i += chunkSize) {
      const chunk = params.partNumbers.slice(i, i + chunkSize);
      const res = await fetch("/api/uploads/multipart/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grantId: params.grantId,
          submissionId: params.submissionId,
          key: params.key,
          uploadId: params.uploadId,
          partNumbers: chunk,
          guestToken: isGuest ? guestToken : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        urls?: Array<{ partNumber: number; url: string }>;
        error?: string;
      };
      if (!res.ok || !json.urls) {
        if ([400, 403, 409, 410].includes(res.status)) {
          clearResumeState(params.resumeKey);
        }
        throw new Error(json.error || "업로드 URL을 생성할 수 없습니다.");
      }
      json.urls.forEach((item) => {
        urlMap.set(item.partNumber, item.url);
      });
    }
    return urlMap;
  };

  const uploadSingleFile = async (
    file: File,
    onProgress: (percent: number) => void,
    durationSeconds?: number | null,
  ) => {
    const submissionId = requireSubmissionId();
    const initRes = await fetch("/api/uploads/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId,
        kind: "video",
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        guestToken: isGuest ? guestToken : undefined,
        title: title.trim() || undefined,
      }),
    });

    const initJson = (await initRes.json().catch(() => ({}))) as {
      key?: string;
      uploadUrl?: string;
      headers?: Record<string, string>;
      error?: string;
    };
    if (!initRes.ok || !initJson.key || !initJson.uploadUrl) {
      throw new Error(initJson.error || "업로드 URL을 생성할 수 없습니다.");
    }

    const { key, uploadUrl, headers } = initJson;
    const contentType =
      headers?.["Content-Type"] || file.type || "application/octet-stream";

    await putBlobWithProgress(
      uploadUrl,
      file,
      (loaded, total) => {
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        onProgress(percent);
      },
      { contentType },
    );

    const completeRes = await fetch("/api/uploads/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId,
        kind: "VIDEO",
        key,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        durationSeconds: durationSeconds ?? undefined,
        guestToken: isGuest ? guestToken : undefined,
      }),
    });
    const completeJson = (await completeRes.json().catch(() => ({}))) as {
      key?: string;
      accessUrl?: string | null;
      error?: string;
    };
    if (!completeRes.ok || !completeJson.key) {
      throw new Error(completeJson.error || "업로드 확인에 실패했습니다.");
    }

    return {
      objectKey: completeJson.key,
      accessUrl: completeJson.accessUrl ?? undefined,
      durationSeconds: durationSeconds ?? undefined,
    };
  };

  const uploadMultipartFile = async (
    file: File,
    onProgress: (percent: number) => void,
    durationSeconds?: number | null,
  ) => {
    const submissionId = requireSubmissionId();
    const resumeKey = buildResumeKey(submissionId, file);
    const resumeState = loadResumeState(resumeKey);

    let uploadId = resumeState?.uploadId ?? null;
    let grantId = resumeState?.grantId ?? null;
    let key = resumeState?.key ?? null;
    let partSize = resumeState?.partSize ?? null;

    if (!grantId || !uploadId || !key || !partSize) {
      const initRes = await fetch("/api/uploads/multipart/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          kind: "video",
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          guestToken: isGuest ? guestToken : undefined,
          title: title.trim() || undefined,
        }),
      });
      const initJson = (await initRes.json().catch(() => ({}))) as {
        grantId?: string;
        key?: string;
        uploadId?: string;
        partSize?: number;
        error?: string;
      };
      if (
        !initRes.ok ||
        !initJson.grantId ||
        !initJson.key ||
        !initJson.uploadId ||
        !initJson.partSize
      ) {
        throw new Error(initJson.error || "멀티파트 업로드를 시작할 수 없습니다.");
      }
      grantId = initJson.grantId;
      uploadId = initJson.uploadId;
      key = initJson.key;
      partSize = initJson.partSize;
      saveResumeState(resumeKey, {
        grantId,
        uploadId,
        key,
        partSize,
        parts: {},
        createdAt: Date.now(),
      });
    }

    const totalSize = file.size;
    const partCount = Math.ceil(totalSize / partSize);
    const existingParts: Record<number, string> = resumeState?.parts ?? {};
    const uploadedParts: Record<number, string> = { ...existingParts };
    const partsToUpload: number[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      if (!uploadedParts[partNumber]) {
        partsToUpload.push(partNumber);
      }
    }

    let totalLoaded = 0;
    if (Object.keys(uploadedParts).length > 0) {
      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        if (!uploadedParts[partNumber]) continue;
        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, totalSize);
        totalLoaded += end - start;
      }
      const initialPercent = Math.min(
        100,
        Math.round((totalLoaded / totalSize) * 100),
      );
      onProgress(initialPercent);
    }

    const urlMap =
      partsToUpload.length > 0
        ? await presignMultipartParts({
          grantId: grantId!,
          resumeKey,
          submissionId,
          key: key!,
          uploadId: uploadId!,
          partNumbers: partsToUpload,
        })
        : new Map<number, string>();

    const partProgress = new Map<number, number>();
    const updateProgress = (partNumber: number, loaded: number) => {
      const prev = partProgress.get(partNumber) ?? 0;
      partProgress.set(partNumber, loaded);
      totalLoaded += loaded - prev;
      const percent = Math.min(
        100,
        Math.round((totalLoaded / totalSize) * 100),
      );
      onProgress(percent);
    };

    const partsResult: Array<{ partNumber: number; etag: string } | null> =
      Array.from({ length: partCount }, () => null);
    Object.entries(uploadedParts).forEach(([partNumber, etag]) => {
      const index = Number(partNumber) - 1;
      if (index >= 0 && index < partsResult.length) {
        partsResult[index] = { partNumber: Number(partNumber), etag };
      }
    });

    const maxRetries = 5;
    const concurrency = getMultipartConcurrency();
    let cursor = 0;

    const uploadPart = async (partNumber: number) => {
      const start = (partNumber - 1) * partSize!;
      const end = Math.min(start + partSize!, totalSize);
      const blob = file.slice(start, end);

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        let url = urlMap.get(partNumber);
        if (!url) {
          const refreshed = await presignMultipartParts({
            grantId: grantId!,
            resumeKey,
            submissionId,
            key: key!,
            uploadId: uploadId!,
            partNumbers: [partNumber],
          });
          url = refreshed.get(partNumber);
          if (url) {
            urlMap.set(partNumber, url);
          }
        }
        if (!url) {
          throw new Error("업로드 URL을 생성할 수 없습니다.");
        }
        try {
          const etagRaw = await putBlobWithProgress(url, blob, (loaded, total) => {
            updateProgress(partNumber, Math.min(loaded, total));
          });
          const etag = etagRaw?.replace(/\"/g, "") ?? "";
          if (!etag) {
            throw new Error("ETag를 확인할 수 없습니다. CORS 설정을 확인해주세요.");
          }
          uploadedParts[partNumber] = etag;
          partsResult[partNumber - 1] = { partNumber, etag };
          saveResumeState(resumeKey, {
            grantId: grantId!,
            uploadId: uploadId!,
            key: key!,
            partSize: partSize!,
            parts: uploadedParts,
            createdAt: Date.now(),
          });
          return;
        } catch (error) {
          if (attempt >= maxRetries) {
            throw error;
          }
          const backoff = Math.min(2000, 400 * 2 ** attempt);
          await sleep(backoff);
        }
      }
    };

    if (partsToUpload.length > 0) {
      const workers = Array.from({ length: concurrency }, async () => {
        while (cursor < partsToUpload.length) {
          const partNumber = partsToUpload[cursor];
          cursor += 1;
          await uploadPart(partNumber);
        }
      });

      await Promise.all(workers);
    }

    const finalParts = partsResult.filter(
      (part): part is { partNumber: number; etag: string } => Boolean(part),
    );

    const completeRes = await fetch("/api/uploads/multipart/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grantId,
        submissionId,
        key,
        uploadId,
        parts: finalParts,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        kind: "VIDEO",
        durationSeconds: durationSeconds ?? undefined,
        guestToken: isGuest ? guestToken : undefined,
      }),
    });
    const completeJson = (await completeRes.json().catch(() => ({}))) as {
      key?: string;
      accessUrl?: string | null;
      error?: string;
    };
    if (!completeRes.ok || !completeJson.key) {
      if ([400, 403, 409, 410].includes(completeRes.status)) {
        clearResumeState(resumeKey);
      }
      throw new Error(completeJson.error || "업로드 확인에 실패했습니다.");
    }

    clearResumeState(resumeKey);

    return {
      objectKey: completeJson.key,
      accessUrl: completeJson.accessUrl ?? undefined,
      durationSeconds: durationSeconds ?? undefined,
    };
  };

  const uploadWithProgress = async (
    file: File,
    onProgress: (percent: number) => void,
  ) => {
    const durationPromise = getVideoDuration(file);
    const durationSeconds = await durationPromise.catch(() => null);
    if (file.size >= multipartThresholdBytes) {
      return uploadMultipartFile(file, onProgress, durationSeconds);
    }
    return uploadSingleFile(file, onProgress, durationSeconds);
  };

  const toggleTvStation = (code: string) => {
    setTvStations((prev) =>
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
    );
  };

  const toggleOnlineOption = (code: string) => {
    if (onlineOptions.includes(code)) {
      setOnlineOptions((prev) => prev.filter((item) => item !== code));
      return;
    }
    const details = onlineOptionConfirmDetails[code];
    if (!details) {
      setOnlineOptions((prev) => [...prev, code]);
      return;
    }
    setConfirmModal({ code, title: details.title, lines: details.lines });
  };

  const handleConfirmOnlineOption = () => {
    if (!confirmModal) return;
    const nextCode = confirmModal.code;
    setOnlineOptions((prev) =>
      prev.includes(nextCode) ? prev : [...prev, nextCode],
    );
    setConfirmModal(null);
  };

  const handleCancelOnlineOption = () => {
    setConfirmModal(null);
  };

  const uploadFiles = async (
    targetFiles: File[] = files,
    initialUploads: UploadItem[] = uploads,
  ) => {
    if (targetFiles.length === 0) return uploadedFiles;

    const digest = targetFiles
      .map((file) => `${file.name}-${file.size}-${file.lastModified}`)
      .join("|");
    if (digest === fileDigest && uploadedFiles.length > 0) {
      return uploadedFiles;
    }

    let results = uploadedFiles.map((file) => ({ ...file }));
    const nextUploads = initialUploads.map((upload) => ({ ...upload }));

    for (let index = 0; index < targetFiles.length; index += 1) {
      const file = targetFiles[index];
      const localKey = getLocalUploadKey(file);
      let uploadIndex = nextUploads.findIndex(
        (upload) => upload.localKey === localKey,
      );
      if (uploadIndex < 0) {
        uploadIndex = nextUploads.length;
        nextUploads.push({
          name: file.name,
          size: file.size,
          progress: 0,
          status: "pending",
          mime: file.type,
          localKey,
        });
      }
      const existingUpload = nextUploads[uploadIndex];

      if (
        existingUpload.status === "done" &&
        existingUpload.path &&
        results.some((result) => result.path === existingUpload.path)
      ) {
        continue;
      }

      nextUploads[uploadIndex] = {
        ...existingUpload,
        status: "uploading",
      };
      setUploads([...nextUploads]);

      let path: string;
      let accessUrl: string | undefined;
      let durationSeconds: number | undefined;
      try {
        const uploadResult = await uploadWithProgress(file, (progress) => {
          nextUploads[uploadIndex] = {
            ...nextUploads[uploadIndex],
            progress,
          };
          setUploads([...nextUploads]);
        });
        path = uploadResult.objectKey;
        accessUrl = uploadResult.accessUrl;
        durationSeconds = uploadResult.durationSeconds;
      } catch (error) {
        nextUploads[uploadIndex] = {
          ...nextUploads[uploadIndex],
          status: "error",
        };
        setUploads([...nextUploads]);
        const message =
          error instanceof Error && error.message
            ? error.message
            : "파일 업로드 중 오류가 발생했습니다.";
        console.error("[MvUpload] upload failed", error);
        setNotice({ error: message });
        throw new Error(message);
      }

      nextUploads[uploadIndex] = {
        ...nextUploads[uploadIndex],
        status: "done",
        progress: 100,
        path,
      };
      setUploads([...nextUploads]);

      results = mergeSubmissionUploadMetadata(results, [
        {
          path,
          originalName: file.name,
          mime: file.type || undefined,
          size: file.size,
          accessUrl,
          durationSeconds,
        },
      ]);
    }

    setUploadedFiles(results);
    setFileDigest(digest);
    return results;
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

  const selectUploadDeliveryMode = React.useCallback(
    (mode: "upload" | "email") => {
      if (uploads.some((upload) => upload.status === "uploading")) {
        setNotice({ error: "현재 파일 업로드가 끝난 뒤 변경해주세요." });
        return;
      }
      if (mode === "upload") {
        setEmailSubmitConfirmed(false);
        setNotice({});
        return;
      }
      if (emailSubmitConfirmed) {
        setNotice({});
        return;
      }
      setEmailSubmitConfirmed(true);
      setNotice({});
    },
    [emailSubmitConfirmed, uploads],
  );

  const applyStoredDraft = React.useCallback((
    draft: Record<string, unknown>,
    storedSelection?: {
      mvType?: string;
      tvStations?: string[];
      onlineOptions?: string[];
      onlineBaseSelected?: boolean;
      emailSubmitConfirmed?: boolean;
      applicationFormMode?: ApplicationFormMode;
      existingCartSubmission?: ExistingMvCartSubmissionSnapshot;
    } | null,
  ) => {
    const draftType =
      draft.type === "MV_BROADCAST" ? "MV_BROADCAST" : "MV_DISTRIBUTION";
    const restoredApplicationFormMode =
      draft.application_form_mode === "online" ||
      draft.application_form_mode === "upload"
        ? draft.application_form_mode
        : storedSelection?.applicationFormMode === "online" ||
            storedSelection?.applicationFormMode === "upload"
          ? storedSelection.applicationFormMode
          : null;
    setApplicationFormMode(restoredApplicationFormMode);
    setMvType(draftType);
    setTitle(String(draft.title ?? ""));
    setArtistName(String(draft.artist_name ?? ""));
    setArtistNameOfficial(String(draft.artist_name_kr ?? ""));
    setDirector(String(draft.mv_director ?? ""));
    setLeadActor(String(draft.mv_lead_actor ?? ""));
    setStoryline(String(draft.mv_storyline ?? ""));
    setProductionCompany(String(draft.mv_production_company ?? ""));
    setAgency(String(draft.mv_agency ?? ""));
    setAlbumTitle(String(draft.mv_album_title ?? ""));
    setDistributionCompany(String(draft.mv_distribution_company ?? ""));
    setUsage(String(draft.mv_usage ?? ""));
    setDesiredRating(
      draftType === "MV_DISTRIBUTION" ? String(draft.mv_desired_rating ?? "") : "",
    );
    setMemo(String(draft.mv_memo ?? ""));
    setSongTitleKr(String(draft.mv_song_title_kr ?? ""));
    setSongTitleEn(String(draft.mv_song_title_en ?? ""));
    setSongTitleOfficial(String(draft.mv_song_title_official ?? ""));
    setComposer(String(draft.mv_composer ?? ""));
    setLyricist(String(draft.mv_lyricist ?? ""));
    setArranger(String(draft.mv_arranger ?? ""));
    setSongMemo(String(draft.mv_song_memo ?? ""));
    setLyrics(String(draft.mv_lyrics ?? ""));
    setReleaseDate(
      normalizeDateValue(draft.release_date ?? draft.mv_production_date),
    );
    setGenre(String(draft.genre ?? ""));
    setRuntime(String(draft.mv_runtime ?? ""));
    setFormat(String(draft.mv_format ?? ""));
    setAiUsed(typeof draft.ai_used === "boolean" ? draft.ai_used : null);

    if (draft.payment_method === "CARD" || draft.payment_method === "BANK") {
      setPaymentMethod(draft.payment_method);
    }
    setBankDepositorName(String(draft.bank_depositor_name ?? ""));
    setPaymentDocumentType(
      draft.payment_document_type === "CASH_RECEIPT" ||
        draft.payment_document_type === "TAX_INVOICE"
        ? draft.payment_document_type
        : "",
    );
    setCashReceiptPurpose(
      draft.cash_receipt_purpose === "PERSONAL_INCOME_DEDUCTION" ||
        draft.cash_receipt_purpose === "BUSINESS_EXPENSE_PROOF"
        ? draft.cash_receipt_purpose
        : "",
    );
    setCashReceiptPhone(String(draft.cash_receipt_phone ?? ""));
    setCashReceiptBusinessNumber(String(draft.cash_receipt_business_number ?? ""));
    setTaxInvoiceBusinessNumber(String(draft.tax_invoice_business_number ?? ""));

    if (isGuest) {
      setGuestName(String(draft.guest_name ?? ""));
      setGuestCompany(String(draft.guest_company ?? ""));
      setGuestEmail(String(draft.guest_email ?? ""));
      setGuestPhone(String(draft.guest_phone ?? ""));
    }

    const selection = storedSelection?.mvType === draftType ? storedSelection : null;
    const persistedStationCodes = Array.isArray(
      draft.mv_selected_station_codes,
    )
      ? draft.mv_selected_station_codes.filter(
          (code): code is string => typeof code === "string" && Boolean(code.trim()),
        )
      : [];
    const reviewStationCodes = (
      Array.isArray(draft.station_reviews)
        ? (draft.station_reviews as Array<Record<string, unknown>>)
        : []
    )
      .map((review) => {
        const station = review.station;
        const normalizedStation = Array.isArray(station)
          ? station[0]
          : station;
        if (!normalizedStation || typeof normalizedStation !== "object") {
          return null;
        }
        const code = (normalizedStation as { code?: unknown }).code;
        return typeof code === "string" && code.trim() ? code.trim() : null;
      })
      .filter((code): code is string => Boolean(code));
    const draftStationCodes =
      persistedStationCodes.length > 0
        ? persistedStationCodes
        : reviewStationCodes;
    const serverOnlineBaseSelected =
      draftType === "MV_DISTRIBUTION"
        ? typeof draft.mv_base_selected === "boolean"
          ? draft.mv_base_selected
          : true
        : false;

    if (draftType === "MV_BROADCAST") {
      setTvStations(
        Array.isArray(selection?.tvStations)
          ? selection!.tvStations
          : draftStationCodes,
      );
      setOnlineOptions([]);
      setOnlineBaseSelected(false);
    } else {
      setTvStations([]);
      setOnlineOptions(
        Array.isArray(selection?.onlineOptions)
          ? selection!.onlineOptions
          : draftStationCodes,
      );
      const baseSelected =
        typeof selection?.onlineBaseSelected === "boolean"
          ? selection.onlineBaseSelected
          : serverOnlineBaseSelected;
      setOnlineBaseSelected(baseSelected);
    }

    const restoredStatus = String(draft.status ?? "");
    const serverCartSubmission: ExistingMvCartSubmissionSnapshot | null =
      restoredStatus === "SUBMITTED" || restoredStatus === "WAITING_PAYMENT"
        ? {
            submissionId: String(draft.id ?? ""),
            amountKrw: Number(draft.amount_krw ?? 0),
            selectedOptionCodes: draftStationCodes,
            onlineBaseSelected: serverOnlineBaseSelected,
          }
        : null;
    const storedCartCandidate = storedSelection?.existingCartSubmission;
    const storedCartSubmission =
      storedCartCandidate?.submissionId === String(draft.id ?? "") &&
      Array.isArray(storedCartCandidate.selectedOptionCodes) &&
      typeof storedCartCandidate.onlineBaseSelected === "boolean"
        ? {
            submissionId: storedCartCandidate.submissionId,
            amountKrw: Number(storedCartCandidate.amountKrw ?? 0),
            selectedOptionCodes: storedCartCandidate.selectedOptionCodes.filter(
              (code): code is string => typeof code === "string",
            ),
            onlineBaseSelected: storedCartCandidate.onlineBaseSelected,
          }
        : null;
    const restoredCartSubmission =
      serverCartSubmission ?? storedCartSubmission;
    setExistingCartSubmission(restoredCartSubmission);
    setPriceChangeAcknowledged(false);

    const files = mapDraftFiles(
      Array.isArray(draft.files) ? (draft.files as Array<Record<string, unknown>>) : [],
    );
    serverUploadedFilesRef.current = files.map((file) => ({ ...file }));
    setUploadedFiles(files);
    setUploads(files.length > 0 ? buildUploadsFromFiles(files) : []);
    setFiles([]);
    setFileDigest("");
    setEmailSubmitConfirmed(
      Boolean(draft.files_submitted_by_email) ||
        (Boolean(storedSelection?.emailSubmitConfirmed) && files.length === 0),
    );
    setCurrentServerUpdatedAt(
      typeof draft.updated_at === "string" ? draft.updated_at : null,
    );

    const restoredSubmissionId = String(draft.id ?? "");
    submissionIdRef.current = restoredSubmissionId;
    if (restoredSubmissionId) {
      setCheckpointSeed({
        submissionId: restoredSubmissionId,
        initialDataIsServerState: true,
      });
    }
    if (isGuest && typeof draft.guest_token === "string") {
      guestTokenRef.current = draft.guest_token;
    }

    setNotice({});
    setStep(restoredApplicationFormMode ? 3 : 2);
    return restoredCartSubmission;
  }, [buildUploadsFromFiles, isGuest, mapDraftFiles, normalizeDateValue]);

  const handleResumeDraftConfirm = React.useCallback(() => {
    if (!resumePrompt) return;
    resumePromptHandledRef.current = true;
    setResumeDeleteError(null);
    const restoredCartSubmission = applyStoredDraft(
      resumePrompt.draft,
      resumePrompt.stored ?? null,
    );
    const draftId = String(resumePrompt.draft.id ?? "");
    if (draftId) {
      writeDraftStorage({
        id: draftId,
        guestToken: isGuest ? (resumePrompt.storedGuestToken ?? null) : null,
        mvType:
          resumePrompt.draft.type === "MV_BROADCAST"
            ? "MV_BROADCAST"
            : "MV_DISTRIBUTION",
        tvStations: Array.isArray(resumePrompt.stored?.tvStations)
          ? resumePrompt.stored.tvStations
          : [],
        onlineOptions: Array.isArray(resumePrompt.stored?.onlineOptions)
          ? resumePrompt.stored.onlineOptions
          : [],
        onlineBaseSelected: resumePrompt.stored?.onlineBaseSelected ?? true,
        emailSubmitConfirmed: resumePrompt.stored?.emailSubmitConfirmed ?? false,
        applicationFormMode: resumePrompt.stored?.applicationFormMode,
        existingCartSubmission: restoredCartSubmission,
      });
    }
    setResumePrompt(null);
    setResumeChecked(true);
  }, [applyStoredDraft, isGuest, resumePrompt, writeDraftStorage]);

  const handleResumeDraftCancel = React.useCallback(async () => {
    if (!resumePrompt || isClearingResumeDrafts) return;
    const draftId = String(resumePrompt.draft.id ?? "");
    if (!draftId) {
      setResumeDeleteError(
        "삭제할 임시저장 신청서를 확인하지 못했습니다. 다시 시도해주세요.",
      );
      return;
    }
    setIsClearingResumeDrafts(true);
    setResumeDeleteError(null);
    const guestToken = resumePrompt.storedGuestToken ?? guestTokenRef.current;
    try {
      const status = String(resumePrompt.draft.status ?? "");
      if (status === "DRAFT" || status === "PRE_REVIEW") {
        await clearServerDrafts({ ids: [draftId], guestToken });
      } else if (status === "SUBMITTED" || status === "WAITING_PAYMENT") {
        await clearCartSubmission(draftId, guestToken);
      } else {
        throw new Error("현재 상태에서는 삭제할 수 없는 신청서입니다.");
      }
      clearDraftStorageForSubmission(draftId);
      if (submissionIdRef.current === draftId) {
        mvCheckpointControllerRef.current?.clear();
        submissionIdRef.current = null;
        setCheckpointSeed(null);
      }
      resumePromptHandledRef.current = true;
      setResumePrompt(null);
      setResumeChecked(true);
    } catch (error) {
      console.warn("[MvDraft][resume-clear] failed", error);
      setResumeDeleteError(
        error instanceof Error && error.message
          ? error.message
          : "임시저장 삭제에 실패했습니다. 다시 시도해주세요.",
      );
    } finally {
      setIsClearingResumeDrafts(false);
    }
  }, [
    clearDraftStorageForSubmission,
    clearCartSubmission,
    clearServerDrafts,
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
      if (!isFromDraftsTab && !stored?.id) {
        setResumeChecked(true);
        return;
      }
      const storedGuestToken =
        stored?.guestToken ?? (isGuest ? guestTokenRef.current : null);
      try {
        const res = await fetch("/api/submissions/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "MV",
            ids: stored?.id ? [stored.id] : undefined,
            guestToken: isGuest ? storedGuestToken : undefined,
          }),
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
          draft: drafts[0],
          stored: stored ?? null,
          storedGuestToken: storedGuestToken ?? null,
        });
      } catch (error) {
        if (cancelled) return;
        console.warn("[MvDraft][resume] failed", error);
        setResumeChecked(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    applyStoredDraft,
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

  const resolveSongTitleValues = () => {
    const songTitleKrValue = songTitleKr.trim();
    const songTitleEnValue = songTitleEn.trim();
    const songTitleOfficialValue =
      songTitleOfficial.trim() || songTitleKrValue || songTitleEnValue;
    return { songTitleKrValue, songTitleEnValue, songTitleOfficialValue };
  };

  const markLyricsToolApplied = () => {
    setLyricsToolApplied(true);
  };

  const handleLyricsScroll = React.useCallback(
    (event: React.UIEvent<HTMLTextAreaElement>) => {
      if (lyricsOverlayRef.current) {
        lyricsOverlayRef.current.scrollTop = event.currentTarget.scrollTop;
      }
    },
    [],
  );

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
    const currentLyrics = lyricsTextareaRef.current?.value ?? lyrics;
    if (!currentLyrics.trim()) {
      setLyricsToolNotice({
        type: "error",
        message: "가사를 입력한 뒤 욕설 체크를 실행해주세요.",
      });
      return;
    }
    if (currentLyrics !== lyrics) {
      setLyrics(currentLyrics);
    }

    setIsCheckingProfanity(true);
    try {
      const terms = await ensureProfanityTerms();
      const matchers = buildLegacyProfanityMatchers(terms);
      const extraRules = buildProfanityExtraRules(terms);
      const currentTestPattern = matchers?.testPattern ?? null;
      const v1HasProfanity = currentTestPattern
        ? currentTestPattern.test(currentLyrics)
        : false;
      const { hasProfanity } = runProfanityCheck(currentLyrics, {
        v1HasProfanity,
        enableV2: isProfanityFilterV2Enabled,
        preferV2: isProfanityFilterV2Enabled,
        v2Options: { extraRules },
      });
      if (hasProfanity) {
        const shouldProceed = await showCenteredConfirm(
          "욕설이 감지되었습니다. 욕설이 있는 경우 심의 부적격 가능성이 높습니다",
        );
        if (!shouldProceed) return;
      }

      setProfanityChecked(true);
      setProfanityHighlight(hasProfanity);
      markLyricsToolApplied();
      setLyricsToolNotice({
        type: hasProfanity ? "error" : "success",
        message: hasProfanity
          ? "욕설 또는 회피 패턴이 감지되었습니다."
          : "욕설이 감지되지 않았습니다.",
      });
    } catch (error) {
      console.warn("[MvProfanity] failed to load terms", error);
      setLyricsToolNotice({
        type: "error",
        message: "욕설 체크 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsCheckingProfanity(false);
    }
  };

  const handleTranslateLyrics = async () => {
    const currentLyrics = lyricsTextareaRef.current?.value ?? lyrics;
    if (!currentLyrics.trim()) {
      setLyricsToolNotice({
        type: "error",
        message: "번역할 가사를 먼저 입력해주세요.",
      });
      return;
    }

    const { lines, segmentMap, sentencesToTranslate } =
      collectForeignLyricsSegments(currentLyrics);
    if (!sentencesToTranslate.length) {
      setLyricsToolNotice({
        type: "error",
        message: "한국어 외 언어 가사를 찾지 못했습니다. 번역 대상을 확인해주세요.",
      });
      return;
    }

    setIsTranslatingLyrics(true);
    setLyricsToolNotice({
      type: "info",
      message: "자동번역을 적용하는 중입니다.",
    });
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

      setLyrics(translatedLines.join("\n"));
      setProfanityChecked(false);
      setProfanityHighlight(false);
      markLyricsToolApplied();
      setLyricsToolNotice({
        type: "success",
        message: "가사 입력란에 자동번역 결과를 적용했습니다.",
      });
    } catch (error) {
      console.error(error);
      setLyricsToolNotice({
        type: "error",
        message: "자동번역 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsTranslatingLyrics(false);
    }
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

  const validateMvForm = (options?: { requirePayment?: boolean }) => {
    const { songTitleKrValue, songTitleEnValue } = resolveSongTitleValues();
    const requirePayment = options?.requirePayment ?? false;
    const titleValue = title.trim();
    const artistNameValue = artistName.trim();
    const guestNameValue = guestName.trim();
    const guestEmailValue = guestEmail.trim();
    const guestPhoneValue = guestPhone.trim();
    const isValidEmail = (value: string) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

    if (isAdminReviewer) {
      setInvalidField(null);
      return true;
    }

    if (isDownloadedApplicationFlow) {
      if (mvType === "MV_BROADCAST" && tvStations.length === 0) {
        setNotice({ error: "TV 송출 심의를 원하는 방송국을 선택해주세요." });
        return false;
      }
      if (
        mvType === "MV_DISTRIBUTION" &&
        !onlineBaseSelected &&
        onlineOptions.length === 0
      ) {
        setNotice({ error: "온라인 심의 옵션을 선택해주세요." });
        return false;
      }
      if (
        requirePayment &&
        paymentMethod === "BANK" &&
        !bankDepositorName.trim()
      ) {
        setNotice({ error: "입금자명을 입력해주세요." });
        return false;
      }
      if (
        requirePayment &&
        paymentMethod === "BANK" &&
        !validatePaymentDocument()
      ) {
        return false;
      }
      if (aiUsed === null) {
        return markInvalidField("aiUsed", "AI 활용 여부를 선택해주세요.");
      }
      return true;
    }

    if (!titleValue) {
      return markInvalidField("title", "뮤직비디오 제목을 입력해주세요.");
    }
    if (!artistNameValue) {
      return markInvalidField("artistName", "아티스트명을 입력해주세요.");
    }
    if (!artistNameOfficial.trim()) {
      return markInvalidField(
        "artistNameOfficial",
        "아티스트명 공식 표기를 입력해주세요.",
      );
    }
    if (!releaseDate) {
      return markInvalidField("releaseDate", "영상 공개일자를 입력해주세요.");
    }
    if (!director.trim()) {
      return markInvalidField("director", "감독 정보를 입력해주세요.");
    }
    if (!leadActor.trim()) {
      return markInvalidField("leadActor", "주연 정보를 입력해주세요.");
    }
    if (!productionCompany.trim()) {
      return markInvalidField(
        "productionCompany",
        "뮤직비디오 제작사를 입력해주세요.",
      );
    }
    if (!agency.trim()) {
      return markInvalidField("agency", "소속사를 입력해주세요.");
    }
    if (!albumTitle.trim()) {
      return markInvalidField("albumTitle", "앨범명을 입력해주세요.");
    }
    if (!distributionCompany.trim()) {
      return markInvalidField("distributionCompany", "유통사를 입력해주세요.");
    }
    if (!usage.trim()) {
      return markInvalidField("usage", "용도를 입력해주세요.");
    }
    if (!songTitleKrValue) {
      return markInvalidField("songTitleKr", "곡명(한글)을 입력해주세요.");
    }
    if (!songTitleEnValue) {
      return markInvalidField("songTitleEn", "곡명(영문)을 입력해주세요.");
    }
    if (!songTitleOfficial.trim()) {
      return markInvalidField(
        "songTitleOfficial",
        "곡 정보 공식 표기를 입력해주세요.",
      );
    }
    if (!composer.trim()) {
      return markInvalidField("composer", "작곡자 정보를 입력해주세요.");
    }
    if (!storyline.trim()) {
      return markInvalidField("storyline", "줄거리 정보를 입력해주세요.");
    }
    if (!lyrics.trim()) {
      return markInvalidField("lyrics", "가사를 입력해주세요.");
    }
    if (aiUsed === null) {
      return markInvalidField("aiUsed", "AI 활용 여부를 선택해주세요.");
    }
    if (mvType === "MV_BROADCAST" && tvStations.length === 0) {
      setNotice({ error: "TV 송출 심의를 원하는 방송국을 선택해주세요." });
      return false;
    }
    if (
      mvType === "MV_DISTRIBUTION" &&
      !onlineBaseSelected &&
      onlineOptions.length === 0
    ) {
      setNotice({ error: "온라인 심의 옵션을 선택해주세요." });
      return false;
    }
    if (isGuest && !guestNameValue) {
      return markInvalidField("guestName", "비회원 담당자명을 입력해주세요.");
    }
    if (isGuest && !guestEmailValue) {
      return markInvalidField("guestEmail", "비회원 이메일을 입력해주세요.");
    }
    if (isGuest && !guestPhoneValue) {
      return markInvalidField("guestPhone", "비회원 연락처를 입력해주세요.");
    }
    if (isGuest && guestEmailValue && !isValidEmail(guestEmailValue)) {
      return markInvalidField("guestEmail", "비회원 이메일 형식을 확인해주세요.");
    }
    if (
      requirePayment &&
      paymentMethod === "BANK" &&
      !bankDepositorName.trim()
    ) {
      setNotice({ error: "입금자명을 입력해주세요." });
      return false;
    }
    if (requirePayment && paymentMethod === "BANK" && !validatePaymentDocument()) {
      return false;
    }
    setInvalidField(null);
    return true;
  };

  const validateMvUploads = () => {
    if (isAdminReviewer) return true;
    if (uploads.some((upload) => upload.status === "error")) {
      setNotice({ error: "업로드에 실패한 파일이 있습니다." });
      return false;
    }
    if (uploads.some((upload) => upload.status !== "done")) {
      setNotice({ error: "파일 업로드가 완료될 때까지 기다려주세요." });
      return false;
    }
    if (emailSubmitConfirmed) return true;
    if (uploads.length === 0) {
      setNotice({
        error: isDownloadedApplicationFlow
          ? "작성한 신청서 파일(HWP/DOC/DOCX)과 영상 파일을 업로드해주세요."
          : "영상 파일을 업로드해주세요.",
      });
      return false;
    }
    if (
      !uploadedFiles.some((file) => isVideoUploadFile(file.originalName, file.mime))
    ) {
      setNotice({ error: "영상 파일을 업로드해주세요." });
      return false;
    }
    if (
      isDownloadedApplicationFlow &&
      !uploadedFiles.some((file) => isApplicationFormFile(file.originalName))
    ) {
      setNotice({
        error: "작성한 신청서 파일(HWP/DOC/DOCX)을 함께 업로드해주세요.",
      });
      return false;
    }
    return true;
  };

  const buildMvCheckpointSnapshot = (): MvCheckpointSnapshot => ({
    step,
    applicationFormMode,
    mvType,
    tvStations: [...tvStations],
    onlineOptions: [...onlineOptions],
    onlineBaseSelected,
    title,
    artistName,
    artistNameOfficial,
    director,
    leadActor,
    storyline,
    productionCompany,
    agency,
    albumTitle,
    distributionCompany,
    usage,
    desiredRating,
    memo,
    songTitleKr,
    songTitleEn,
    songTitleOfficial,
    composer,
    lyricist,
    arranger,
    songMemo,
    lyrics,
    releaseDate,
    genre,
    runtime,
    format,
    aiUsed,
    guestName,
    guestCompany,
    guestEmail,
    guestPhone,
    paymentMethod,
    bankDepositorName,
    paymentDocumentType,
    cashReceiptPurpose,
    uploadedFiles: uploadedFiles.map(stripCheckpointAccessUrl),
    emailSubmitConfirmed,
    existingCartSubmission: existingCartSubmission
      ? {
          ...existingCartSubmission,
          selectedOptionCodes: [
            ...existingCartSubmission.selectedOptionCodes,
          ],
        }
      : null,
  });

  const saveMvDraft = async (options: {
    includeFiles: boolean;
    background?: boolean;
    snapshot?: MvCheckpointSnapshot;
  }) => {
    const foreground = options.background !== true;
    if (foreground) {
      if (draftSaveInFlightRef.current) return false;
      draftSaveInFlightRef.current = true;
      // Lock the form before waiting for a queued background save. Otherwise
      // edits made during that wait can be omitted by the click-time snapshot.
      setIsSaving(true);
      setNotice({});
    }
    const executeSave = async () => {
      const source = options.snapshot ?? buildMvCheckpointSnapshot();
      const sourceSelectedCodes =
        source.mvType === "MV_BROADCAST"
          ? source.tvStations
          : source.onlineOptions;
      const sourceStationIds = sourceSelectedCodes
        .map((code) => stationMap.get(code)?.id)
        .filter(Boolean) as string[];
      const sourceAmount =
        source.mvType === "MV_BROADCAST"
          ? sourceSelectedCodes.reduce(
              (sum, code) => sum + (stationPriceMap[code] ?? 0),
              0,
            )
          : (source.onlineBaseSelected ? baseOnlinePrice : 0) +
            sourceSelectedCodes.reduce(
              (sum, code) => sum + (stationPriceMap[code] ?? 0),
              0,
            );
      const songTitleKrValue = source.songTitleKr.trim();
      const songTitleEnValue = source.songTitleEn.trim();
      const songTitleOfficialValue =
        source.songTitleOfficial.trim() ||
        songTitleKrValue ||
        songTitleEnValue;
      const titleValue = source.title.trim();
      const artistNameValue = source.artistName.trim();
      const artistNameOfficialValue = source.artistNameOfficial.trim();
      const guestNameValue = source.guestName.trim();
      const guestCompanyValue = source.guestCompany.trim();
      const guestEmailValue = source.guestEmail.trim();
      const guestPhoneValue = source.guestPhone.trim();
      let submissionId: string;
      try {
        submissionId = requireSubmissionId();
      } catch (error) {
        if (foreground) {
          setNotice({
            error:
              draftError ||
              (error instanceof Error
                ? error.message
                : "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요."),
          });
          void createDraft();
        }
        return false;
      }

      if (source.existingCartSubmission?.submissionId === submissionId) {
        // Editing a payable cart row must not downgrade its server lifecycle
        // to DRAFT. Keep the exact edit in the local checkpoint and update the
        // existing submission only from the final exclusive SUBMITTED action.
        writeDraftStorage({
          id: submissionId,
          guestToken: isGuest ? guestTokenRef.current : null,
          mvType: source.mvType,
          tvStations: source.tvStations,
          onlineOptions: source.onlineOptions,
          onlineBaseSelected: source.onlineBaseSelected,
          emailSubmitConfirmed: source.emailSubmitConfirmed,
          applicationFormMode: source.applicationFormMode ?? undefined,
          existingCartSubmission: source.existingCartSubmission,
        });
        if (foreground) setNotice({});
        return true;
      }

      try {
        const uploaded = options.includeFiles
          ? options.snapshot
            ? source.uploadedFiles
            : await uploadFiles()
          : undefined;
        const savedSnapshot: MvCheckpointSnapshot = uploaded
          ? { ...source, uploadedFiles: uploaded.map((file) => ({ ...file })) }
          : source;
        const result = await saveMvSubmissionAction({
          submissionId,
          amountKrw: sourceAmount,
          selectedStationIds: sourceStationIds,
          selectedStationCodes: sourceSelectedCodes,
          title: titleValue || undefined,
          artistName: artistNameValue || undefined,
          director: source.director.trim() || undefined,
          leadActor: source.leadActor.trim() || undefined,
          storyline: source.storyline.trim() || undefined,
          productionCompany: source.productionCompany.trim() || undefined,
          agency: source.agency.trim() || undefined,
          albumTitle: source.albumTitle.trim() || undefined,
          distributionCompany: source.distributionCompany.trim() || undefined,
          usage: source.usage.trim() || undefined,
          desiredRating:
            source.mvType === "MV_DISTRIBUTION"
              ? source.desiredRating.trim() || undefined
              : undefined,
          memo: source.memo.trim() || undefined,
          songTitle: songTitleOfficialValue || undefined,
          songTitleKr: songTitleKrValue || undefined,
          songTitleEn: songTitleEnValue || undefined,
          songTitleOfficial: source.songTitleOfficial.trim() || undefined,
          composer: source.composer.trim() || undefined,
          lyricist: source.lyricist.trim() || undefined,
          arranger: source.arranger.trim() || undefined,
          songMemo: source.songMemo.trim() || undefined,
          lyrics: source.lyrics.trim() || undefined,
          artistNameOfficial: artistNameOfficialValue || undefined,
          releaseDate: source.releaseDate || undefined,
          genre: source.genre || undefined,
          mvType: source.mvType,
          runtime: source.runtime || undefined,
          format: source.format || undefined,
          mvBaseSelected:
            source.mvType === "MV_DISTRIBUTION"
              ? source.onlineBaseSelected
              : false,
          aiUsed: source.aiUsed ?? undefined,
          guestToken: isGuest ? guestToken : undefined,
          guestName: isGuest ? guestNameValue || undefined : undefined,
          guestCompany: isGuest ? guestCompanyValue || undefined : undefined,
          guestEmail: isGuest ? guestEmailValue || undefined : undefined,
          guestPhone: isGuest ? guestPhoneValue || undefined : undefined,
          paymentMethod: source.paymentMethod,
          bankDepositorName:
            source.paymentMethod === "BANK"
              ? source.bankDepositorName.trim() || undefined
              : undefined,
          paymentDocumentType: source.paymentDocumentType || undefined,
          cashReceiptPurpose:
            source.paymentDocumentType === "CASH_RECEIPT"
              ? source.cashReceiptPurpose || undefined
              : undefined,
          cashReceiptPhone:
            source.paymentDocumentType === "CASH_RECEIPT" &&
            source.cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION"
              ? cashReceiptPhone.trim() || undefined
              : undefined,
          cashReceiptBusinessNumber:
            source.paymentDocumentType === "CASH_RECEIPT" &&
            source.cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
              ? cashReceiptBusinessNumber.trim() || undefined
              : undefined,
          taxInvoiceBusinessNumber:
            source.paymentDocumentType === "TAX_INVOICE"
              ? taxInvoiceBusinessNumber.trim() || undefined
              : undefined,
          status: "DRAFT",
          files: uploaded,
          filesSubmittedByEmail: source.emailSubmitConfirmed,
          applicationFormMode: source.applicationFormMode,
          externalApplicationForm: source.applicationFormMode === "upload",
        });

        if (result.error) {
          if (foreground) setNotice({ error: result.error });
          return false;
        }

        if (uploaded) {
          serverUploadedFilesRef.current = uploaded.map((file) => ({ ...file }));
        }
        writeDraftStorage({
          id: submissionId,
          guestToken: isGuest ? guestTokenRef.current : null,
          mvType: source.mvType,
          tvStations: source.tvStations,
          onlineOptions: source.onlineOptions,
          onlineBaseSelected: source.onlineBaseSelected,
          emailSubmitConfirmed: source.emailSubmitConfirmed,
          applicationFormMode: source.applicationFormMode ?? undefined,
          existingCartSubmission: source.existingCartSubmission,
        });
        if (foreground) {
          mvCheckpointControllerRef.current?.markSaved(savedSnapshot);
          setNotice({ submissionId: result.submissionId });
        }
        return true;
      } catch {
        if (foreground) setNotice({ error: "저장 중 오류가 발생했습니다." });
        return false;
      }
    };

    try {
      if (options.background || !mvCheckpointControllerRef.current) {
        return await executeSave();
      }
      return await mvCheckpointControllerRef.current.runExclusive(executeSave);
    } finally {
      if (foreground) {
        setIsSaving(false);
        draftSaveInFlightRef.current = false;
      }
    }
  };

  const handleSubmit = async (
    options?: { deferPayment?: boolean; redirectToCart?: boolean },
  ) => {
    const deferPayment = options?.deferPayment === true;
    if (isSaving || submitInFlightRef.current) return;
    if (!validateMvForm({ requirePayment: !deferPayment })) return;
    if (!validateMvUploads()) return;
    submitInFlightRef.current = true;
    setIsSaving(true);
    setNotice({});

    const executeSubmit = async () => {
    const { songTitleKrValue, songTitleEnValue, songTitleOfficialValue } =
      resolveSongTitleValues();
    const titleValue = title.trim();
    const artistNameValue = artistName.trim();
    const artistNameOfficialValue = artistNameOfficial.trim();
    const guestNameValue = guestName.trim();
    const guestCompanyValue = guestCompany.trim();
    const guestEmailValue = guestEmail.trim();
    const guestPhoneValue = guestPhone.trim();

    let submissionId: string;
    try {
      submissionId = requireSubmissionId();
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

    try {
      const uploaded = uploads.length > 0 ? await uploadFiles() : [];
      const submissionPaymentMethod = deferPayment ? "BANK" : paymentMethod;
      if (
        !deferPayment &&
        submissionPaymentMethod === "BANK" &&
        paymentDocumentType === "TAX_INVOICE"
      ) {
        await uploadTaxInvoiceCertificate(
          submissionId,
          titleValue || songTitleOfficialValue || "mv",
        );
      }
      const result = await saveMvSubmissionAction({
        submissionId,
        amountKrw: totalAmount,
        selectedStationIds,
        selectedStationCodes,
        title: titleValue || undefined,
        artistName: artistNameValue || undefined,
        director: director.trim() || undefined,
        leadActor: leadActor.trim() || undefined,
        storyline: storyline.trim() || undefined,
        productionCompany: productionCompany.trim() || undefined,
        agency: agency.trim() || undefined,
        albumTitle: albumTitle.trim() || undefined,
        distributionCompany: distributionCompany.trim() || undefined,
        usage: usage.trim() || undefined,
        desiredRating:
          mvType === "MV_DISTRIBUTION" ? desiredRating.trim() || undefined : undefined,
        memo: memo.trim() || undefined,
        songTitle: songTitleOfficialValue || undefined,
        songTitleKr: songTitleKrValue || undefined,
        songTitleEn: songTitleEnValue || undefined,
        songTitleOfficial: songTitleOfficial.trim() || undefined,
        composer: composer.trim() || undefined,
        lyricist: lyricist.trim() || undefined,
        arranger: arranger.trim() || undefined,
        songMemo: songMemo.trim() || undefined,
        lyrics: lyrics.trim() || undefined,
        artistNameOfficial: artistNameOfficialValue || undefined,
        releaseDate: releaseDate || undefined,
        genre: genre || undefined,
        mvType,
        runtime: runtime || undefined,
        format: format || undefined,
        mvBaseSelected:
          mvType === "MV_DISTRIBUTION" ? onlineBaseSelected : false,
        aiUsed: aiUsed ?? undefined,
        guestToken: isGuest ? guestToken : undefined,
        guestName: isGuest ? guestNameValue || undefined : undefined,
        guestCompany: isGuest ? guestCompanyValue || undefined : undefined,
        guestEmail: isGuest ? guestEmailValue || undefined : undefined,
        guestPhone: isGuest ? guestPhoneValue || undefined : undefined,
        paymentMethod: submissionPaymentMethod,
        bankDepositorName:
          submissionPaymentMethod === "BANK" && !deferPayment
            ? bankDepositorName.trim()
            : undefined,
        paymentDocumentType:
          !deferPayment ? paymentDocumentType || undefined : undefined,
        cashReceiptPurpose:
          !deferPayment && paymentDocumentType === "CASH_RECEIPT"
            ? cashReceiptPurpose || undefined
            : undefined,
        cashReceiptPhone:
          !deferPayment &&
            paymentDocumentType === "CASH_RECEIPT" &&
            cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION"
            ? cashReceiptPhone.trim() || undefined
            : undefined,
        cashReceiptBusinessNumber:
          !deferPayment &&
            paymentDocumentType === "CASH_RECEIPT" &&
            cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
            ? cashReceiptBusinessNumber.trim() || undefined
            : undefined,
        taxInvoiceBusinessNumber:
          !deferPayment && paymentDocumentType === "TAX_INVOICE"
            ? taxInvoiceBusinessNumber.trim() || undefined
            : undefined,
        deferPayment,
        status: "SUBMITTED",
        files: uploaded,
        filesSubmittedByEmail: emailSubmitConfirmed,
        applicationFormMode,
        externalApplicationForm: isDownloadedApplicationFlow,
      });

      if (result.error) {
        setNotice({ error: result.error });
        return;
      }

      if (result.submissionId) {
        serverUploadedFilesRef.current = uploaded.map((file) => ({ ...file }));
        // The final server write already contains the latest form and uploaded
        // file metadata. Mark that exact snapshot as synchronized so leaving
        // the exclusive section cannot enqueue a stale DRAFT write while the
        // card-payment popup is open.
        mvCheckpointControllerRef.current?.markSaved({
          ...buildMvCheckpointSnapshot(),
          uploadedFiles: uploaded.map((file) => ({ ...file })),
        });
        if (deferPayment) {
          mvCheckpointControllerRef.current?.clear();
          clearDraftStorageForSubmission(result.submissionId);
          if (isGuest) {
            const savedGuestToken = result.guestToken ?? guestToken;
            if (!savedGuestToken) {
              setNotice({
                error: "비회원 장바구니 조회 코드를 확인하지 못했습니다.",
              });
              return;
            }
            addGuestSubmissionCartEntries([
              { submissionId: result.submissionId, guestToken: savedGuestToken },
            ]);
          }
          if (options?.redirectToCart) {
            router.push(
              `${localePrefix}/mypage/cart?added=${encodeURIComponent(result.submissionId)}`,
            );
            return;
          }
          setNotice({
            emailNotice: result.emailNotice
              ? `${deferredPaymentNotice} ${result.emailNotice}`
              : deferredPaymentNotice,
          });
          setCompletionId(result.submissionId);
          if (result.guestToken) {
            setCompletionGuestToken(result.guestToken);
          } else if (isGuest) {
            setCompletionGuestToken(guestToken);
          }
          setStep(6);
          return;
        }
        if (paymentMethod === "CARD") {
          setNotice(result.emailNotice ? { emailNotice: result.emailNotice } : {});
          const { ok, error } = await openInicisCardPopup({
            context: "mv",
            submissionId: result.submissionId,
            guestToken: result.guestToken ?? (isGuest ? guestToken : undefined),
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
        }
        if (paymentMethod === "BANK") {
          mvCheckpointControllerRef.current?.clear();
          clearDraftStorageForSubmission(result.submissionId);
          setNotice(result.emailNotice ? { emailNotice: result.emailNotice } : {});
          setCompletionId(result.submissionId);
          if (result.guestToken) {
            setCompletionGuestToken(result.guestToken);
          } else if (isGuest) {
            setCompletionGuestToken(guestToken);
          }
          setStep(6);
          return;
        }
        console.warn(
          "[Inicis][STDPay][init][client] unknown payment method",
          paymentMethod,
        );
        setNotice({ error: "지원하지 않는 결제 수단입니다." });
        return;
      }
    } catch {
      setNotice({ error: "저장 중 오류가 발생했습니다." });
    }
    };

    try {
      if (!mvCheckpointControllerRef.current) {
        return await executeSubmit();
      }
      return await mvCheckpointControllerRef.current.runExclusive(executeSubmit);
    } finally {
      submitInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const handleStep2Next = async () => {
    if (isDownloadedApplicationFlow) {
      await handleDownloadedApplicationContinue();
      return;
    }
    if (!validateMvForm()) return;
    const saved = await saveMvDraft({ includeFiles: false });
    if (saved) {
      setStep(4);
    }
  };

  const handleDownloadedApplicationContinue = async () => {
    if (!canProceed) {
      setNotice({
        error:
          mvType === "MV_BROADCAST"
            ? "TV 송출 심의를 원하는 방송국을 선택해주세요."
            : "온라인 심의 옵션을 선택해주세요.",
      });
      return;
    }
    if (!validateMvForm()) return;
    const submissionId =
      submissionIdRef.current ?? (await createDraft({ force: true }));
    if (!submissionId) {
      setNotice({
        error:
          draftError ||
          "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
      return;
    }
    submissionIdRef.current = submissionId;
    const saved = await saveMvDraft({ includeFiles: false });
    if (saved) {
      setStep(4);
    }
  };

  const handleStep3Next = async () => {
    if (!validateMvUploads()) return;
    const uploadsReady =
      uploads.length > 0 && uploads.every((upload) => upload.status === "done");
    const saved = await saveMvDraft({ includeFiles: uploadsReady });
    if (saved) {
      setStep(5);
    }
  };

  const mvCheckpointSnapshot = buildMvCheckpointSnapshot();
  const restoreMvCheckpoint = React.useCallback(
    (snapshot: MvCheckpointSnapshot) => {
      setApplicationFormMode(snapshot.applicationFormMode);
      setMvType(snapshot.mvType);
      setTvStations([...snapshot.tvStations]);
      setOnlineOptions([...snapshot.onlineOptions]);
      setOnlineBaseSelected(snapshot.onlineBaseSelected);
      setTitle(snapshot.title);
      setArtistName(snapshot.artistName);
      setArtistNameOfficial(snapshot.artistNameOfficial);
      setDirector(snapshot.director);
      setLeadActor(snapshot.leadActor);
      setStoryline(snapshot.storyline);
      setProductionCompany(snapshot.productionCompany);
      setAgency(snapshot.agency);
      setAlbumTitle(snapshot.albumTitle);
      setDistributionCompany(snapshot.distributionCompany);
      setUsage(snapshot.usage);
      setDesiredRating(
        snapshot.mvType === "MV_DISTRIBUTION"
          ? snapshot.desiredRating
          : "",
      );
      setMemo(snapshot.memo);
      setSongTitleKr(snapshot.songTitleKr);
      setSongTitleEn(snapshot.songTitleEn);
      setSongTitleOfficial(snapshot.songTitleOfficial);
      setComposer(snapshot.composer);
      setLyricist(snapshot.lyricist);
      setArranger(snapshot.arranger);
      setSongMemo(snapshot.songMemo);
      setLyrics(snapshot.lyrics);
      setReleaseDate(snapshot.releaseDate);
      setGenre(snapshot.genre);
      setRuntime(snapshot.runtime);
      setFormat(snapshot.format);
      setAiUsed(snapshot.aiUsed);
      setGuestName(snapshot.guestName);
      setGuestCompany(snapshot.guestCompany);
      setGuestEmail(snapshot.guestEmail);
      setGuestPhone(snapshot.guestPhone);
      setPaymentMethod(snapshot.paymentMethod);
      setBankDepositorName(snapshot.bankDepositorName);
      setPaymentDocumentType(snapshot.paymentDocumentType);
      setCashReceiptPurpose(snapshot.cashReceiptPurpose);
      setExistingCartSubmission(
        snapshot.existingCartSubmission
          ? {
              ...snapshot.existingCartSubmission,
              selectedOptionCodes: [
                ...snapshot.existingCartSubmission.selectedOptionCodes,
              ],
            }
          : null,
      );
      const restoredFiles =
        checkpointRestoreSourceRef.current === "previous"
          ? serverUploadedFilesRef.current.map((file) => ({ ...file }))
          : snapshot.uploadedFiles.map((file) => ({ ...file }));
      setUploadedFiles(restoredFiles);
      setUploads(
        restoredFiles.length > 0 ? buildUploadsFromFiles(restoredFiles) : [],
      );
      setFiles([]);
      setFileDigest("");
      setEmailSubmitConfirmed(snapshot.emailSubmitConfirmed);
      setInvalidField(null);
      setNotice({});
      setStep(Math.max(1, Math.min(5, snapshot.step)));
    },
    [buildUploadsFromFiles],
  );
  const mvCheckpoint = useSubmissionCheckpoint<MvCheckpointSnapshot>({
    kind: "MV",
    storageKey: currentSubmissionId
      ? getSubmissionCheckpointStorageKey(
          draftStorageKey,
          currentSubmissionId,
        )
      : null,
    submissionId: currentSubmissionId,
    snapshot: mvCheckpointSnapshot,
    enabled:
      resumeChecked &&
      Boolean(currentSubmissionId) &&
      !completionId,
    debounceMs: 1_800,
    serverUpdatedAt: currentServerUpdatedAt,
    initialDataIsServerState:
      checkpointSeed?.submissionId === currentSubmissionId
        ? checkpointSeed.initialDataIsServerState
        : false,
    onRecover: restoreMvCheckpoint,
    save: async (snapshot) => {
      if (snapshot.existingCartSubmission) {
        return { ok: true, serverSaved: false };
      }
      const saved = await saveMvDraft({
        includeFiles: false,
        background: true,
        snapshot,
      });
      if (!saved) {
        return {
            ok: false,
            error:
              "서버 저장이 지연되고 있습니다. 입력은 이 기기에 보관했습니다.",
          };
      }
      if (
        !areSubmissionUploadMetadataEqual(
          snapshot.uploadedFiles,
          serverUploadedFilesRef.current,
        )
      ) {
        return { ok: true, serverSaved: false };
      }
      return { ok: true, savedAt: Date.now() };
    },
  });
  mvCheckpointControllerRef.current = mvCheckpoint;
  const recoverMvCheckpoint = React.useCallback(() => {
    checkpointRestoreSourceRef.current = "recovery";
    try {
      mvCheckpoint.recover();
    } finally {
      checkpointRestoreSourceRef.current = "recovery";
    }
  }, [mvCheckpoint]);
  const revertMvCheckpointToSaved = React.useCallback(() => {
    checkpointRestoreSourceRef.current = "previous";
    try {
      return mvCheckpoint.revertToSaved();
    } finally {
      checkpointRestoreSourceRef.current = "recovery";
    }
  }, [mvCheckpoint]);

  const renderBroadcastSpecs = () => {
    if (broadcastSpecs.length === 0) return null;
    return (
      <div className="broadcast-specs mt-3 space-y-3">
        {broadcastSpecs.map((spec) => {
          const isOpen = openBroadcastSpec === spec.id;
          const panelId = `broadcast-spec-${spec.id}`;
          return (
            <div
              key={spec.id}
              className="broadcast-card rounded-2xl border border-border/60 bg-background/70"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() =>
                  setOpenBroadcastSpec((prev) => (prev === spec.id ? null : spec.id))
                }
                className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition hover:bg-foreground/5"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {spec.title}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {spec.summaryBadges.map((badge) => (
                      <span
                        key={`${spec.id}-${badge}`}
                        className="rounded-full border border-border/60 bg-background/80 px-2.5 py-0.5"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="mt-1 text-xs font-semibold text-muted-foreground">
                  {isOpen ? "닫기" : "열기"}
                </span>
              </button>
              {isOpen ? (
                <div
                  id={panelId}
                  className="border-t border-border/60 px-4 py-4 text-sm text-foreground"
                >
                  <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                    {broadcastFieldLabels.map(({ key, label }) => {
                      const value = spec.fields[key];
                      if (!value || (Array.isArray(value) && value.length === 0)) {
                        return null;
                      }
                      const rendered = Array.isArray(value) ? value.join(" / ") : value;
                      return (
                        <div key={`${spec.id}-${key}`} className="grid gap-1">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            {label}
                          </p>
                          <p className="text-sm font-medium text-foreground">
                            {rendered}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-8 text-[15px] leading-relaxed sm:text-base [&_input]:text-base [&_textarea]:text-base [&_select]:text-base [&_label]:text-sm">
      <PendingOverlay
        show={isSaving}
        label={step <= 4 ? "신청서 저장 중..." : "심의 저장/결제 처리 중..."}
      />

      {isDraggingOver && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]" />
      )}
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
            {resumeDeleteError ? (
              <p
                role="alert"
                className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600"
              >
                {resumeDeleteError}
              </p>
            ) : null}
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
      {confirmModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={handleCancelOnlineOption}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={confirmModal.title}
            className="max-h-[calc(100dvh-3rem)] w-full max-w-xl overflow-y-auto rounded-[24px] border border-border/60 bg-background p-5 text-foreground shadow-xl sm:rounded-[28px] sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              안내
            </p>
            <h3 className="mt-2 text-lg font-semibold">
              {confirmModal.title}
            </h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {confirmModal.lines.map((line) => (
                <li
                  key={line}
                  className="grid grid-cols-[12px_1fr] items-start gap-2 pl-2 leading-relaxed"
                >
                  <span
                    aria-hidden="true"
                    className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/80"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs font-semibold text-foreground">
              {onlineOptionConfirmNote}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelOnlineOption}
                className="rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold text-foreground transition hover:border-foreground"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmOnlineOption}
                className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
      {stepLabels}
      {mvCheckpoint.status === "recovery" && mvCheckpoint.recovery ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[115] bg-black/50 backdrop-blur-[1px]"
        />
      ) : null}
      <SubmissionSaveIndicator
        status={mvCheckpoint.status}
        lastSavedAt={mvCheckpoint.lastSavedAt}
        error={mvCheckpoint.error}
        hasRecovery={Boolean(mvCheckpoint.recovery)}
        hasPrevious={Boolean(mvCheckpoint.previous)}
        onRetry={mvCheckpoint.retry}
        onRecover={recoverMvCheckpoint}
        onDiscardRecovery={mvCheckpoint.discardRecovery}
        onRevertToSaved={revertMvCheckpointToSaved}
        className={
          mvCheckpoint.status === "recovery" && mvCheckpoint.recovery
            ? "fixed left-1/2 top-1/2 z-[120] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 p-5"
            : undefined
        }
      />

      {step === 1 && (
        <div
          data-preflight-field="mvPurpose"
          tabIndex={-1}
          className="space-y-6 outline-none"
        >
          <h2 className="font-display text-2xl text-foreground">심의 목적 선택</h2>

          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                value: "MV_DISTRIBUTION",
                label: "유통사 제출 & 온라인 업로드",
                description: "멜론·지니·유튜브 등 온라인 유통",
              },
              {
                value: "MV_BROADCAST",
                label: "TV 송출 목적의 심의",
                description: "음원 심의 완료 앨범만 신청 가능",
              },
            ].map((item) => {
              const active = mvType === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    const nextMvType = item.value as
                      | "MV_DISTRIBUTION"
                      | "MV_BROADCAST";
                    setMvType(nextMvType);
                    if (nextMvType === "MV_BROADCAST") {
                      setOnlineOptions([]);
                      setOnlineBaseSelected(true);
                      setDesiredRating("");
                    } else {
                      setTvStations([]);
                    }
                  }}
                  className={`text-left rounded-[28px] border p-6 transition ${active
                    ? "border-[#0071e3] bg-[#0071e3] text-white shadow-[0_20px_44px_rgba(0,113,227,0.24)] dark:border-[#2997ff] dark:bg-[#2997ff] dark:text-[#00101f]"
                    : "border-border/60 bg-card/80 text-foreground hover:border-primary/40"
                    }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">{item.label}</h3>
                    </div>
                    {active ? (
                      <span className={selectedBadgeClass}>
                        ✓ 선택됨
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs opacity-70">{item.description}</p>
                </button>
              );
            })}
          </div>

          {mvType === "MV_BROADCAST" ? (
            <div
              data-preflight-field="reviewOptions"
              tabIndex={-1}
              className="rounded-[28px] border border-border/60 bg-card/80 p-6 outline-none"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-foreground">방송국 선택</h3>
                <span className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold text-muted-foreground">
                  방송국별 개별 심의
                </span>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {tvStationCodes.map((code, index) => {
                  const active = tvStations.includes(code);
                  const stationName = stationMap.get(code)?.name ?? code;
                  const details = tvStationDetails[code];
                  const tone =
                    mvOptionToneClasses[index % mvOptionToneClasses.length];
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleTvStation(code)}
                      className={`text-left rounded-2xl border p-4 transition ${active
                        ? tone
                        : "border-border/60 bg-background text-foreground hover:border-primary/40"
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">
                            {details?.title ?? `${stationName} 심의`}
                          </p>
                          {active ? (
                            <span className={selectedBadgeClass}>
                              ✓ 선택됨
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs font-semibold">
                          {formatCurrency(stationPriceMap[code] ?? 0)}원
                        </span>
                      </div>
                      <p className="mt-2 text-xs opacity-80">
                        {details?.note}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              data-preflight-field="reviewOptions"
              tabIndex={-1}
              className="rounded-[28px] border border-border/60 bg-card/80 p-6 outline-none"
            >
              <h3 className="font-semibold text-foreground">옵션 선택</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setOnlineBaseSelected((prev) => !prev)}
                  className={`text-left rounded-2xl border p-4 transition ${onlineBaseSelected
                    ? mvOptionToneClasses[0]
                    : "border-border/60 bg-background text-foreground hover:border-primary/40"
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">일반 뮤직비디오 심의</p>
                        <span
                          className={`rounded-[6px] border px-2 py-0.5 text-[10px] font-black tracking-normal ${onlineBaseSelected ? "border-[#111111]/30 bg-white/45 text-[#111111]" : "border-[#1556a4]/40 bg-[#1556a4]/10 text-[#1556a4]"}`}
                        >
                          유통사 제출용
                        </span>
                      </div>
                      {onlineBaseSelected ? (
                        <span className={selectedBadgeClass}>
                          ✓ 선택됨
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs font-semibold">
                      {formatCurrency(baseOnlinePrice)}원
                    </span>
                  </div>
                  <p className="mt-2 text-xs opacity-80">
                    필증과 등급분류 파일이 제공되며, Melon, 지니, 유튜브 등 온라인 유통이 가능합니다.
                  </p>
                </button>
                {onlineOptionCodes.map((code, index) => {
                  const active = onlineOptions.includes(code);
                  const stationName = stationMap.get(code)?.name ?? code;
                  const details = onlineOptionDetails[code];
                  const tone =
                    mvOptionToneClasses[(index + 1) % mvOptionToneClasses.length];
                  const isConditional = conditionalOnlineOptions.has(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleOnlineOption(code)}
                      className={`text-left rounded-2xl border p-4 transition ${active
                        ? tone
                        : "border-border/60 bg-background text-foreground hover:border-primary/40"
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">
                            {details?.title ?? `${stationName} 입고 옵션`}
                          </p>
                          {isConditional ? (
                            <span className="inline-flex w-fit rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-2.5 py-1 text-[10px] font-black tracking-normal text-[#111111] shadow-[2px_2px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[2px_2px_0_#111111]">
                              문의 필요
                            </span>
                          ) : null}
                          {active ? (
                            <span className={selectedBadgeClass}>
                              ✓ 선택됨
                            </span>
                          ) : null}
                        </div>
                        <span className="text-right text-xs font-semibold">
                          {formatCurrency(stationPriceMap[code] ?? 0)}원
                        </span>
                      </div>
                      <p className="mt-2 text-xs opacity-80">
                        {details?.note}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
            <div className="flex flex-wrap items-center justify-end gap-3 text-right">
              <div className="flex flex-col items-end">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  총 결제 금액
                </p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                  {formatCurrency(totalAmount)}원
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!canProceed}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
            >
              다음 단계
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div
            data-preflight-field="applicationFormMode"
            tabIndex={-1}
            className="outline-none"
          >
            <ApplicationFormModeTabs
              mode={applicationFormMode}
              onModeChange={selectApplicationFormMode}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white"
            >
              이전 단계
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!applicationFormMode}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
            >
              선택하고 계속
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-8">
          <h2 className="font-display text-2xl text-foreground">
            {isDownloadedApplicationFlow ? "신청서 양식" : "신청서 작성"}
          </h2>

          {isDownloadedApplicationFlow ? (
            <div className="rounded-[28px] border-2 border-[#111111] bg-card p-6 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]">
              <div className="flex flex-wrap gap-3">
                {mvApplicationForms.map((form) => (
                  <a
                    key={form.href}
                    href={form.href}
                    download={form.downloadName}
                    onClick={() => {
                      void handleDownloadedApplicationContinue();
                    }}
                    className="inline-flex rounded-[8px] border-2 border-[#111111] bg-white px-5 py-3 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27] hover:shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27]"
                  >
                    {form.label} 다운로드
                  </a>
                ))}
              </div>
              <div
                data-mv-field="aiUsed"
                data-preflight-field="aiUsed"
                tabIndex={-1}
                className="mt-5"
              >
                <AiUsageSelector
                  value={aiUsed}
                  onChange={(nextValue) => {
                    setAiUsed(nextValue);
                    clearInvalidField("aiUsed");
                    setNotice({});
                  }}
                  context="mv"
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
                  onClick={() => setStep(2)}
                  disabled={isSaving}
                  className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
                >
                  이전 단계
                </button>
                <button
                  type="button"
                  onClick={handleDownloadedApplicationContinue}
                  disabled={isSaving}
                  className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
                >
                  파일 업로드로 이동
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  뮤직비디오 기본 정보
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      뮤직비디오 제목 *
                    </label>
                    <input
                      data-mv-field="title"
                      data-preflight-field="title"
                      aria-invalid={invalidField === "title"}
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value);
                        clearInvalidField("title");
                      }}
                      className={requiredFieldClass("title")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      아티스트명 (한글/영문) *
                    </label>
                    <input
                      data-mv-field="artistName"
                      data-preflight-field="artistName"
                      aria-invalid={invalidField === "artistName"}
                      value={artistName}
                      onChange={(event) => {
                        setArtistName(event.target.value);
                        clearInvalidField("artistName");
                      }}
                      className={requiredFieldClass("artistName")}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      아티스트명과 국문표기용 영문도 써주세요. 예: 싸이(PSY) / PSY
                      · 아이유 / IU
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      아티스트명 공식 표기 *
                    </label>
                    <input
                      data-mv-field="artistNameOfficial"
                      data-preflight-field="artistNameOfficial"
                      aria-invalid={invalidField === "artistNameOfficial"}
                      value={artistNameOfficial}
                      onChange={(event) => {
                        setArtistNameOfficial(event.target.value);
                        clearInvalidField("artistNameOfficial");
                      }}
                      className={requiredFieldClass("artistNameOfficial")}
                    />
                    <p className="text-[11px] text-muted-foreground whitespace-pre-line">
                      실제 음원사이트 표기법을 적용한 공식 표기를 적어주세요.
                      {"\n"}예) SOLE (쏠), 윤하 (YOUNHA), Bakehour, 김장훈
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      영상 공개일자 *
                    </label>
                    <input
                      data-mv-field="releaseDate"
                      data-preflight-field="releaseDate"
                      aria-invalid={invalidField === "releaseDate"}
                      type="date"
                      value={releaseDate}
                      onChange={(event) => {
                        setReleaseDate(event.target.value);
                        clearInvalidField("releaseDate");
                      }}
                      className={requiredFieldClass("releaseDate")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      장르
                    </label>
                    <input
                      value={genre}
                      onChange={(event) => setGenre(event.target.value)}
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      러닝타임
                    </label>
                    <input
                      placeholder="예: 03:25"
                      value={runtime}
                      onChange={(event) => setRuntime(event.target.value)}
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      파일 포맷
                    </label>
                    <input
                      placeholder="예: MP4 (H.264)"
                      value={format}
                      onChange={(event) => setFormat(event.target.value)}
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      감독 *
                    </label>
                    <input
                      data-mv-field="director"
                      data-preflight-field="director"
                      aria-invalid={invalidField === "director"}
                      value={director}
                      onChange={(event) => {
                        setDirector(event.target.value);
                        clearInvalidField("director");
                      }}
                      className={requiredFieldClass("director")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      주연 *
                    </label>
                    <input
                      data-mv-field="leadActor"
                      data-preflight-field="leadActor"
                      aria-invalid={invalidField === "leadActor"}
                      value={leadActor}
                      onChange={(event) => {
                        setLeadActor(event.target.value);
                        clearInvalidField("leadActor");
                      }}
                      className={requiredFieldClass("leadActor")}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  제작 정보
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      뮤직비디오 제작사 *
                    </label>
                    <input
                      data-mv-field="productionCompany"
                      data-preflight-field="productionCompany"
                      aria-invalid={invalidField === "productionCompany"}
                      value={productionCompany}
                      onChange={(event) => {
                        setProductionCompany(event.target.value);
                        clearInvalidField("productionCompany");
                      }}
                      className={requiredFieldClass("productionCompany")}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        소속사 *
                      </label>
                      <div className="group relative">
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-primary bg-primary text-sm font-black text-primary-foreground shadow-[0_8px_18px_rgba(0,113,227,0.22)] transition hover:-translate-y-0.5 hover:bg-[#0077ed] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:bg-[#2997ff] dark:text-[#00101f]"
                          aria-label="소속사 표기 안내"
                        >
                          ?
                        </button>
                        <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-2xl border border-border/70 bg-background px-4 py-3 text-[11px] font-medium leading-5 text-foreground shadow-[0_18px_40px_rgba(0,0,0,0.14)] group-hover:block group-focus-within:block">
                          공개되는 뮤직비디오 좌측 하단에 들어갈 소속사/기획사/로고 등과 동일한 명칭을 기입해주세요. 대소문자 및 한/영 표기 모두 동일해야합니다.
                        </div>
                      </div>
                    </div>
                    <input
                      data-mv-field="agency"
                      data-preflight-field="agency"
                      aria-invalid={invalidField === "agency"}
                      value={agency}
                      onChange={(event) => {
                        setAgency(event.target.value);
                        clearInvalidField("agency");
                      }}
                      className={requiredFieldClass("agency")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      앨범명 *
                    </label>
                    <input
                      data-mv-field="albumTitle"
                      data-preflight-field="albumTitle"
                      aria-invalid={invalidField === "albumTitle"}
                      value={albumTitle}
                      onChange={(event) => {
                        setAlbumTitle(event.target.value);
                        clearInvalidField("albumTitle");
                      }}
                      className={requiredFieldClass("albumTitle")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      유통사 *
                    </label>
                    <input
                      data-mv-field="distributionCompany"
                      data-preflight-field="distributionCompany"
                      aria-invalid={invalidField === "distributionCompany"}
                      value={distributionCompany}
                      onChange={(event) => {
                        setDistributionCompany(event.target.value);
                        clearInvalidField("distributionCompany");
                      }}
                      className={requiredFieldClass("distributionCompany")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      용도 *
                    </label>
                    <input
                      data-mv-field="usage"
                      data-preflight-field="usage"
                      aria-invalid={invalidField === "usage"}
                      placeholder="예: 음악사이트 기재"
                      value={usage}
                      onChange={(event) => {
                        setUsage(event.target.value);
                        clearInvalidField("usage");
                      }}
                      className={requiredFieldClass("usage")}
                    />
                  </div>
                  {mvType === "MV_DISTRIBUTION" ? (
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        희망등급 (선택)
                      </label>
                      <input
                        value={desiredRating}
                        onChange={(event) => setDesiredRating(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                  ) : null}
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      메모 (선택)
                    </label>
                    <textarea
                      value={memo}
                      onChange={(event) => setMemo(event.target.value)}
                      className="h-20 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                    />
                  </div>
                </div>
              </div>

              <div
                data-mv-field="aiUsed"
                data-preflight-field="aiUsed"
                tabIndex={-1}
              >
                <AiUsageSelector
                  value={aiUsed}
                  onChange={(nextValue) => {
                    setAiUsed(nextValue);
                    clearInvalidField("aiUsed");
                    setNotice({});
                  }}
                  context="mv"
                />
              </div>

              <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  곡 정보
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      곡명 (한글) *
                    </label>
                    <input
                      data-mv-field="songTitleKr"
                      data-preflight-field="songTitleKr"
                      aria-invalid={invalidField === "songTitleKr"}
                      value={songTitleKr}
                      onChange={(event) => {
                        setSongTitleKr(event.target.value);
                        clearInvalidField("songTitleKr");
                      }}
                      className={requiredFieldClass("songTitleKr")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      곡명 (영문) *
                    </label>
                    <input
                      data-mv-field="songTitleEn"
                      data-preflight-field="songTitleEn"
                      aria-invalid={invalidField === "songTitleEn"}
                      value={songTitleEn}
                      onChange={(event) => {
                        setSongTitleEn(event.target.value);
                        clearInvalidField("songTitleEn");
                      }}
                      className={requiredFieldClass("songTitleEn")}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      곡 정보 공식 표기 *
                    </label>
                    <input
                      data-mv-field="songTitleOfficial"
                      data-preflight-field="songTitleOfficial"
                      aria-invalid={invalidField === "songTitleOfficial"}
                      value={songTitleOfficial}
                      onChange={(event) => {
                        setSongTitleOfficial(event.target.value);
                        clearInvalidField("songTitleOfficial");
                      }}
                      className={requiredFieldClass("songTitleOfficial")}
                    />
                    <p className="text-[11px] text-muted-foreground whitespace-pre-line">
                      실제 공개되는 곡의 표기법을 적용한 공식 표기를 적어주세요.
                      {"\n"}예) 바람, 바람(Wish), Wish, Wish(바람), 바람(feat.ABC)
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      작곡자 *
                    </label>
                    <input
                      data-mv-field="composer"
                      data-preflight-field="composer"
                      aria-invalid={invalidField === "composer"}
                      value={composer}
                      onChange={(event) => {
                        setComposer(event.target.value);
                        clearInvalidField("composer");
                      }}
                      className={requiredFieldClass("composer")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      작사가 (선택)
                    </label>
                    <input
                      value={lyricist}
                      onChange={(event) => setLyricist(event.target.value)}
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      편곡자 (선택)
                    </label>
                    <input
                      value={arranger}
                      onChange={(event) => setArranger(event.target.value)}
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      메모 (선택)
                    </label>
                    <input
                      value={songMemo}
                      onChange={(event) => setSongMemo(event.target.value)}
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  줄거리 / 작품내용 *
                </p>
                <textarea
                  data-mv-field="storyline"
                  data-preflight-field="storyline"
                  aria-invalid={invalidField === "storyline"}
                  value={storyline}
                  onChange={(event) => {
                    setStoryline(event.target.value);
                    clearInvalidField("storyline");
                  }}
                  className={`${requiredFieldClass("storyline")} mt-4 h-32`}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  줄거리는 결말까지 작성하셔야 합니다.
                </p>
              </div>

              <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                    가사 *
                  </p>
                  <div className="group/lyrics-tools">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleProfanityCheck}
                        disabled={isCheckingProfanity}
                        className="rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5 active:translate-y-0 active:shadow-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        욕설 체크 {isCheckingProfanity ? "중..." : ""}
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
                </div>
                {lyricsToolNotice && (
                  <div
                    className={`mt-3 rounded-2xl border px-4 py-2 text-xs font-semibold ${lyricsToolNotice.type === "error"
                      ? "border-red-200/70 bg-red-50 text-red-700"
                      : lyricsToolNotice.type === "success"
                        ? "border-emerald-200/70 bg-emerald-50 text-emerald-800"
                        : "border-primary/20 bg-primary/8 text-primary dark:border-[#2997ff]/30 dark:bg-[#2997ff]/12 dark:text-[#8bc3ff]"
                      }`}
                  >
                    {lyricsToolNotice.message}
                  </div>
                )}
                <div
                  className={`relative isolate mt-4 overflow-hidden rounded-2xl border bg-background transition ${invalidField === "lyrics"
                      ? "border-red-500 ring-2 ring-red-500/20 focus-within:border-red-500"
                      : "border-border/70 focus-within:border-foreground"
                    }`}
                >
                  {showProfanityOverlay && (
                    <div
                      ref={lyricsOverlayRef}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 z-10 overflow-y-auto px-4 py-3 text-sm leading-relaxed text-foreground"
                    >
                      <div className="whitespace-pre-wrap">
                        {renderProfanityPreview(
                          lyrics,
                          profanityPattern,
                          profanityTestPattern,
                        )}
                      </div>
                    </div>
                  )}
                  <textarea
                    data-mv-field="lyrics"
                    data-preflight-field="lyrics"
                    aria-invalid={invalidField === "lyrics"}
                    ref={lyricsTextareaRef}
                    value={lyrics}
                    onChange={(event) => {
                      setLyrics(event.target.value);
                      clearInvalidField("lyrics");
                    }}
                    onScroll={handleLyricsScroll}
                    className={`relative z-0 min-h-[8rem] w-full resize-y overflow-y-auto bg-transparent px-4 py-3 text-sm leading-relaxed outline-none ${showProfanityOverlay
                      ? "text-transparent caret-foreground"
                      : "text-foreground"
                      }`}
                  />
                </div>
                {profanityChecked && (
                  <div className="mt-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs text-foreground">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      감지된 단어
                    </p>
                    <div className="mt-2 max-h-32 space-y-2 overflow-auto pr-1">
                      {profanityHighlight && profanityWords.length > 0 ? (
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
                          {profanityHighlight
                            ? "회피 패턴이 감지되었습니다."
                            : "욕설이 감지되지 않았습니다."}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  가사의 외국어는 반드시 번역이 있어야 합니다.
                </p>
              </div>

              {isGuest && (
                <div className="rounded-[28px] border border-border/60 bg-background/80 p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                    신청자 정보
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    이름과 이메일은 심의 조회시에 사용됩니다.
                  </p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        담당자명 *
                      </label>
                      <input
                        data-mv-field="guestName"
                        data-preflight-field="guestName"
                        aria-invalid={invalidField === "guestName"}
                        value={guestName}
                        onChange={(event) => {
                          setGuestName(event.target.value);
                          clearInvalidField("guestName");
                        }}
                        required
                        className={requiredFieldClass("guestName")}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        회사/기획사
                      </label>
                      <input
                        value={guestCompany}
                        onChange={(event) => setGuestCompany(event.target.value)}
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        이메일 *
                      </label>
                      <input
                        data-mv-field="guestEmail"
                        data-preflight-field="guestEmail"
                        aria-invalid={invalidField === "guestEmail"}
                        type="email"
                        value={guestEmail}
                        onChange={(event) => {
                          setGuestEmail(event.target.value);
                          clearInvalidField("guestEmail");
                        }}
                        required
                        className={requiredFieldClass("guestEmail")}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        연락처 *
                      </label>
                      <input
                        data-mv-field="guestPhone"
                        data-preflight-field="guestPhone"
                        aria-invalid={invalidField === "guestPhone"}
                        value={guestPhone}
                        onChange={(event) => {
                          setGuestPhone(event.target.value);
                          clearInvalidField("guestPhone");
                        }}
                        required
                        className={requiredFieldClass("guestPhone")}
                      />
                    </div>
                  </div>
                </div>
              )}

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
                  onClick={() => setStep(2)}
                  disabled={isSaving}
                  className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
                >
                  이전 단계
                </button>
                {!isGuest && (
                  <button
                    type="button"
                    onClick={async () => {
                      await saveMvDraft({ includeFiles: false });
                    }}
                    disabled={isSaving}
                    className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground hover:bg-foreground/10 dark:bg-transparent dark:hover:bg-white/10 disabled:cursor-not-allowed"
                  >
                    임시 저장
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleStep2Next}
                  className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black"
                >
                  다음 단계
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-8">
          <h2 className="font-display text-2xl text-foreground">파일 첨부</h2>

          <div
            data-preflight-field="files"
            tabIndex={-1}
            className="rounded-[28px] border border-border/60 bg-card/80 p-6 outline-none"
          >
            <p className="mt-1 text-xs font-semibold text-foreground">
              {isDownloadedApplicationFlow
                ? "허용 형식: MP4/MOV/WMV/MPG/MPEG/M4V + HWP/DOC/DOCX"
                : "허용 형식: MP4/MOV/WMV/MPG/MPEG/M4V"}
            </p>
            {mvType === "MV_BROADCAST" ? (
              renderBroadcastSpecs()
            ) : (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                {uploadChips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-border/60 bg-background/70 px-3 py-1"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4 grid gap-2 rounded-2xl border border-border/70 bg-background/70 p-1 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => selectUploadDeliveryMode("upload")}
                disabled={uploadInProgress}
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
                disabled={uploadInProgress}
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
                  아래 이메일 주소로 영상 파일을 보내주세요.
                </p>
                <p className="mt-3 break-all rounded-xl border border-primary/20 bg-background/90 px-3 py-2 text-base font-black text-primary dark:border-[#2997ff]/30 dark:text-[#8bc3ff]">
                  {APP_CONFIG.supportEmail}
                </p>
                <div className="mt-3 rounded-xl border border-border/60 bg-background/80 px-3 py-3 text-xs leading-5 text-muted-foreground">
                  <p className="font-semibold text-foreground">메일 제목 예시</p>
                  <p className="mt-1 break-all">
                    [MV심의 파일] {artistName.trim() || "아티스트명"} / {title.trim() || "곡명"} / {mvType === "MV_BROADCAST" ? "TV송출용" : "온라인용"}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4">
                  <label
                    className={`relative block ${uploadInProgress ? "cursor-wait opacity-70" : ""}`}
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
                    onDrop={onDropFiles}
                  >
                    <span className="sr-only">파일 첨부</span>
                    <input
                      type="file"
                      multiple
                      accept={
                        isDownloadedApplicationFlow
                          ? ".mp4,.mov,.wmv,.mpg,.mpeg,.m4v,.hwp,.doc,.docx,video/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          : ".mp4,.mov,.wmv,.mpg,.mpeg,.m4v,video/*"
                      }
                      onChange={onFileChange}
                      className="hidden"
                      disabled={uploadInProgress}
                    />
                    <span className="flex w-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-6 text-sm font-semibold text-foreground transition hover:border-foreground">
                      {submissionIdRef.current
                        ? "파일 첨부 (최대 2GB, 드래그 앤 드롭 가능)"
                        : isPreparingDraft
                          ? "접수 ID 준비 중... 잠시 후 첨부 가능"
                          : draftError || "접수 ID 준비 중... 다시 시도해주세요."}
                    </span>
                    {!submissionIdRef.current && !isPreparingDraft ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void createDraft({ force: true });
                        }}
                        className="mt-3 inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-[12px] font-semibold tracking-[0.16em] text-primary-foreground transition hover:bg-[#0077ed] dark:bg-[#2997ff] dark:text-[#00101f] dark:hover:bg-[#45a6ff]"
                      >
                        다시 시도
                      </button>
                    ) : null}
                    {isDraggingOver && (
                      <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-[#f6d64a] bg-black/10 backdrop-blur-[1px]" />
                    )}
                  </label>
                </div>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>
                    영상 파일 첨부가 정상적으로 완료되지 않는 경우, 파일 없이 다음 단계로 진행하거나 이메일로 파일을 전송해주세요.
                  </p>
                  {isDownloadedApplicationFlow ? (
                    <p>
                      다운로드한 신청서를 작성한 경우 신청서도 영상과 함께 첨부해주세요.
                    </p>
                  ) : null}
                  <p className="pt-1 text-sm font-black text-foreground sm:text-base">
                    {APP_CONFIG.supportEmail}
                  </p>
                </div>
                {uploads.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {uploads.map((upload, index) => (
                      <div
                        key={`${upload.name}-${index}`}
                        className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="min-w-0 flex-1 break-all font-semibold text-foreground">
                            {upload.name}
                          </span>
                          <div className="flex shrink-0 items-center gap-3">
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
                              disabled={upload.status === "uploading"}
                              onClick={() => {
                                const removedUpload = uploads[index];
                                setFiles((currentFiles) =>
                                  removedUpload?.localKey
                                    ? currentFiles.filter(
                                        (file) =>
                                          getLocalUploadKey(file) !==
                                          removedUpload.localKey,
                                      )
                                    : currentFiles,
                                );
                                setUploads((currentUploads) =>
                                  currentUploads.filter(
                                    (_, uploadIndex) => uploadIndex !== index,
                                  ),
                                );
                                setUploadedFiles((prev) =>
                                  prev.filter((file) =>
                                    removedUpload?.path
                                      ? file.path !== removedUpload.path
                                      : true,
                                  ),
                                );
                                setFileDigest("");
                              }}
                              className="min-h-11 rounded-full border border-border/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:border-rose-400 hover:text-rose-500 disabled:cursor-wait disabled:opacity-50"
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
                  </div>
                ) : null}
              </>
            )}
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
              onClick={() => setStep(3)}
              className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white"
            >
              이전 단계
            </button>
            {!isGuest && (
              <button
                type="button"
                onClick={async () => {
                  const uploadsReady =
                    uploads.length > 0 &&
                    uploads.every((upload) => upload.status === "done");
                  await saveMvDraft({ includeFiles: uploadsReady });
                }}
                disabled={isSaving}
                className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground hover:bg-foreground/10 dark:bg-transparent dark:hover:bg-white/10 disabled:cursor-not-allowed"
              >
                임시 저장
              </button>
            )}
            <button
              type="button"
              onClick={handleStep3Next}
              disabled={isSaving}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
            >
              다음 단계
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-8">
          <div className="rounded-[22px] border-2 border-[#111111] bg-card p-4 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                  결제 금액
                </p>
                <p className="mt-1 text-2xl font-black text-foreground">
                  {formatCurrency(totalAmount)}원
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-full border-2 border-[#111111] bg-background px-4 py-2 text-xs font-black text-foreground transition hover:-translate-y-0.5 hover:bg-[#111111] hover:text-white dark:border-[#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]"
              >
                옵션 수정
              </button>
            </div>
            <details className="mt-4 rounded-[14px] border border-border/70 bg-background/60 px-4 py-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-black text-foreground">
                선택 내역 {paymentItems.length}건
              </summary>
              <div className="mt-3 space-y-2">
                {paymentItems.length > 0 ? (
                  paymentItems.map((item) => (
                    <div
                      key={`${item.title}-${item.amount}`}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="font-semibold text-foreground">
                        {item.title}
                      </span>
                      <span>{formatCurrency(item.amount)}원</span>
                    </div>
                  ))
                ) : (
                  <p>선택된 옵션이 없습니다.</p>
                )}
              </div>
            </details>
          </div>

          <SubmissionPreflightPanel
            result={mvPreflight}
            criteria={[
              "심의 목적과 선택 옵션",
              "작성 방식에 맞는 필수 신청 정보",
              "영상·신청서 파일과 결제 금액",
            ]}
            onNavigate={navigateFromPreflight}
            onAcknowledge={(issue) => {
              if (issue.acknowledgementKey === "cart-price-change") {
                setPriceChangeAcknowledged(true);
              }
            }}
          />

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
                    KG이니시스 카드 결제 · 결제 모듈에서 즉시 진행
                  </p>
                </button>
              </div>
            </div>
          ) : null}

          {isGuest && !usesSubmissionCartCheckout && paymentMethod === "BANK" ? (
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
                          name="mv-cash-receipt-purpose"
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
                          name="mv-cash-receipt-purpose"
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
          ) : isGuest && !usesSubmissionCartCheckout ? (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm text-muted-foreground">
              카드 결제 선택 시 이니시스 결제 모듈이 열립니다. 팝업이 차단된 경우 팝업 해제 후 다시 시도해주세요.
            </div>
          ) : null}

          {notice.error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600">
              {notice.error}
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
              onClick={() => handleSubmit({ deferPayment: true })}
              disabled={isSaving || !mvPreflight.canSubmit}
              className="rounded-full border border-border/70 bg-background px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              장바구니에 담기
            </button>
            <button
              type="button"
              onClick={() =>
                handleSubmit({
                  deferPayment: true,
                  redirectToCart: true,
                })
              }
              disabled={isSaving || !mvPreflight.canSubmit}
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
                router.push(`${localePrefix}/dashboard?tab=mv&refresh=1`)
              }
              className="mt-6 rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5"
            >
              진행 상황 보기
            </button>
          )}
          {shouldShowGuestLookup && (
            <div className="mt-6 space-y-3">
              <p className="text-xs text-muted-foreground">
                조회 코드:{" "}
                <span className="break-all font-semibold text-foreground">
                  {guestLookupCode}
                </span>
              </p>
              <button
                type="button"
                onClick={() =>
                  router.push(
                    `${localePrefix}/track/${encodeURIComponent(guestLookupCode)}`,
                  )
                }
                className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5"
              >
                진행 상황 조회
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
