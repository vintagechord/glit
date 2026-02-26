"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PendingOverlay } from "@/components/ui/pending-overlay";
import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import { openInicisCardPopup } from "@/lib/inicis/popup";
import {
  buildLegacyProfanityMatchers,
  extractProfanityWords,
  type ProfanityTerm,
} from "@/lib/profanity/legacy";
import { runProfanityCheck } from "@/lib/profanity/check";

import {
  saveAlbumSubmissionAction,
  type SubmissionActionState,
} from "./actions";
import { safeRandomUUID } from "@/lib/uuid";

declare global {
  interface Window {
    INIStdPay?: {
      pay: (formId: string) => void;
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

type DraftSnapshot = {
  draft: AlbumDraft;
  emailSubmitConfirmed: boolean;
};

type SpellcheckSuggestion = {
  id?: string;
  start: number;
  end: number;
  before: string;
  after: string;
  reason?: string;
  source?: string;
  confidence?: number;
  type?: string;
};

type SpellcheckDiff = {
  op: "equal" | "insert" | "delete" | "replace";
  a: string;
  b: string;
  indexA: number;
  indexB: number;
};

const initialTrack: TrackInput = {
  trackTitle: "",
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

const steps = [
  "패키지 선택",
  "신청서 작성",
  "파일 업로드",
  "결제하기",
  "접수 완료",
];

const formatPackageName = (count: number, isOneClick = false) =>
  `${isOneClick ? "원클릭 " : ""}${count}개 패키지`;
const formatPackageBroadcastLabel = (count: number) => `${count}개 방송국`;
const formatPackageDescription = (
  description: string | null | undefined,
  count: number,
) => (description ? description.replace(`${count}곳`, `${count}개`) : "");

const packageToneClasses = [
  {
    card: "border-[#7ad97a] bg-[#8fe38f] text-black",
    chip: "border-black/30 text-black",
  },
  {
    card: "border-[#f6d64a] bg-[#f6d64a] text-black",
    chip: "border-black/30 text-black",
  },
  {
    card: "border-[#4f56d8] bg-[#4f56d8] text-[#ecf2ff]",
    chip: "border-white/40 text-[#ecf2ff]",
  },
  {
    card: "border-[#e49adf] bg-[#f3a7f2] text-black",
    chip: "border-black/30 text-black",
  },
];

const uploadMaxMb = Number(
  process.env.NEXT_PUBLIC_AUDIO_UPLOAD_MAX_MB ??
    process.env.NEXT_PUBLIC_UPLOAD_MAX_MB ??
    "1024",
);
const uploadMaxBytes = uploadMaxMb * 1024 * 1024;
const uploadMaxLabel =
  uploadMaxMb >= 1024
    ? `${Math.round(uploadMaxMb / 1024)}GB`
    : `${uploadMaxMb}MB`;
const draftDeleteTimeoutMs = 8000;
const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");

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
  "외국어 가사에는 반드시 번역을 나란히 기재해주세요.",
  "심의요청서의 곡 순서와 CD 순서는 반드시 일치해야 합니다.",
  "실제 발매 앨범과 동일한 음원·가사·트랙수가 필요합니다. (예: 2트랙 앨범—AR 1곡 + INST 1곡—의 경우 INST까지 제출)",
];

const koreanLetterPattern = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
const unicodeLetterPattern = /\p{L}/u;

const hasNonKoreanLyrics = (value: string) => {
  for (const char of value) {
    if (!unicodeLetterPattern.test(char)) continue;
    if (!koreanLetterPattern.test(char)) return true;
  }
  return false;
};

const splitForeignSentences = (value: string) => {
  const matches = value.match(/[^.!?]+[.!?]*/g);
  return matches?.map((item) => item.trim()).filter(Boolean) ?? [];
};

const isForeignLetter = (char: string) =>
  unicodeLetterPattern.test(char) && !koreanLetterPattern.test(char);

type ForeignSegment = {
  raw: string;
  start: number;
  end: number;
  sentences: string[];
};

const extractForeignSegments = (line: string): ForeignSegment[] => {
  const segments: ForeignSegment[] = [];
  let start = -1;
  let hasForeign = false;

  const pushSegment = (end: number) => {
    if (start < 0) return;
    const raw = line.slice(start, end);
    const trimmed = raw.trim();
    if (!hasForeign || !trimmed || trimmed.includes("번역:")) {
      start = -1;
      hasForeign = false;
      return;
    }
    const sentences = splitForeignSentences(trimmed);
    if (sentences.length > 0) {
      segments.push({
        raw,
        start,
        end,
        sentences,
      });
    }
    start = -1;
    hasForeign = false;
  };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const isKorean = koreanLetterPattern.test(char);
    if (isKorean) {
      pushSegment(index);
      continue;
    }
    if (start < 0 && isForeignLetter(char)) {
      start = index;
    }
    if (start >= 0 && isForeignLetter(char)) {
      hasForeign = true;
    }
  }

  pushSegment(line.length);
  return segments;
};

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
  tracks: TrackInput[];
  files: UploadResult[];
  emailSubmitConfirmed: boolean;
};

export function AlbumWizard({
  packages,
  userId,
  profanityTerms = [],
  profanityFilterV2Enabled = false,
}: {
  packages: PackageOption[];
  userId?: string | null;
  profanityTerms?: ProfanityTerm[];
  profanityFilterV2Enabled?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isGuest = !userId;
  const isFromDraftsTab = searchParams?.get("from") === "drafts";
  const [step, setStep] = React.useState(1);
  const [isOneClick, setIsOneClick] = React.useState(false);
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
  const [spellcheckChangesByTrack, setSpellcheckChangesByTrack] =
    React.useState<
      Record<number, Array<{ before: string; after: string; index?: number }>>
    >({});
  const [spellcheckAppliedMap, setSpellcheckAppliedMap] = React.useState<
    Record<number, boolean>
  >({});
  const [spellcheckNoticeMap, setSpellcheckNoticeMap] = React.useState<
    Record<
      number,
      { type: "success" | "error" | "info"; message: string }
    >
  >({});
  const [spellcheckSuggestionsByTrack, setSpellcheckSuggestionsByTrack] =
    React.useState<Record<number, SpellcheckSuggestion[]>>({});
  const [spellcheckOriginalByTrack, setSpellcheckOriginalByTrack] =
    React.useState<Record<number, string>>({});
  const [spellcheckCorrectedByTrack, setSpellcheckCorrectedByTrack] =
    React.useState<Record<number, string>>({});
  const [spellcheckDiffsByTrack, setSpellcheckDiffsByTrack] =
    React.useState<Record<number, SpellcheckDiff[]>>({});
  const [spellcheckModalOpen, setSpellcheckModalOpen] =
    React.useState(false);
  const [spellcheckPendingTrack, setSpellcheckPendingTrack] =
    React.useState<number | null>(null);
  const [isSpellchecking, setIsSpellchecking] = React.useState(false);
  const [isTranslatingLyrics, setIsTranslatingLyrics] = React.useState(false);
  const [translationPanelOpenMap, setTranslationPanelOpenMap] = React.useState<
    Record<number, boolean>
  >({});
  const [lyricsTab, setLyricsTab] = React.useState<"profanity" | "spellcheck">(
    "profanity",
  );
  const [isPreparingDraft, setIsPreparingDraft] = React.useState(false);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<SubmissionActionState>({});
  const [resumeChecked, setResumeChecked] = React.useState(false);
  const [resumePrompt, setResumePrompt] = React.useState<{
    drafts: Array<Record<string, unknown>>;
    storedGuestToken?: string;
  } | null>(null);
  const [isClearingResumeDrafts, setIsClearingResumeDrafts] = React.useState(false);
  const resumePromptHandledRef = React.useRef(false);

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
  const isProfanityFilterV2Enabled = Boolean(profanityFilterV2Enabled);
  const profanityPattern = profanityMatchers?.pattern ?? null;
  const profanityTestPattern = profanityMatchers?.testPattern ?? null;
  const activeTrack = tracks[activeTrackIndex] ?? tracks[0];
  const profanityWords = extractProfanityWords(
    activeTrack.lyrics,
    profanityPattern,
  );
  const showLyricsToolNotice = Boolean(lyricsToolApplied[activeTrackIndex]);
  const showProfanityPanel = Boolean(profanityCheckedMap[activeTrackIndex]);
  const showProfanityOverlay =
    showProfanityPanel &&
    lyricsTab === "profanity" &&
    Boolean(profanityHighlightMap[activeTrackIndex]) &&
    profanityWords.length > 0;
  const spellcheckChanges =
    spellcheckChangesByTrack[activeTrackIndex] ?? [];
  const spellcheckNotice = spellcheckNoticeMap[activeTrackIndex];
  const showSpellcheckPreview = Boolean(
    spellcheckAppliedMap[activeTrackIndex],
  );
  const hasSpellcheckChanges = spellcheckChanges.length > 0;
  const spellcheckSuggestions =
    spellcheckSuggestionsByTrack[activeTrackIndex] ?? [];
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
  const showLyricsTabs = showProfanityPanel || showSpellcheckPreview;
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
  const basePriceKrw = selectedPackage
    ? isOneClick
      ? oneClickPriceMap[selectedPackage.stationCount] ??
        selectedPackage.priceKrw
      : selectedPackage.priceKrw
    : 0;
  const additionalPriceKrw = Math.round(basePriceKrw * 0.5);
  const additionalAlbumCount = albumDrafts.length;
  const totalAlbumCount = additionalAlbumCount + 1;
  const totalPriceKrw =
    basePriceKrw + additionalAlbumCount * additionalPriceKrw;
  const selectionLocked = albumDrafts.length > 0;
  const selectedPackageSummary = selectedPackage
    ? {
        name: selectedPackage.name,
        stationCount: selectedPackage.stationCount,
        priceKrw: basePriceKrw,
      }
    : null;

  const readDraftStorage = React.useCallback(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        ids?: string[];
        updatedAt?: number;
        guestToken?: string;
      };
    } catch {
      return null;
    }
  }, [draftStorageKey]);

  const writeDraftStorage = React.useCallback((payload: {
    ids: string[];
    guestToken?: string | null;
  }) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          ids: payload.ids,
          guestToken: payload.guestToken ?? null,
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
  }) => {
    const ids = (options.ids ?? []).filter(Boolean);
    const payload: {
      type: "ALBUM";
      ids?: string[];
      guestToken?: string;
    } = {
      type: "ALBUM",
    };
    if (ids.length > 0) {
      payload.ids = ids;
    }
    if (isGuest) {
      const guestToken = options.guestToken ?? currentGuestToken;
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
  }, [currentGuestToken, isGuest]);

  const createDraft = React.useCallback(async () => {
    if (isPreparingDraft) return;
    setIsPreparingDraft(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/submissions/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ALBUM",
          guestToken: isGuest ? currentGuestToken : undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        submissionId?: string;
        error?: string;
      };
      if (res.ok && json?.submissionId) {
        setCurrentSubmissionId(json.submissionId);
        return;
      }
      setDraftError(json?.error || "접수 초안을 생성하지 못했습니다. 새로고침 후 다시 시도해주세요.");
    } catch (error) {
      setDraftError(
        error instanceof Error
          ? error.message
          : "접수 초안을 생성하지 못했습니다. 새로고침 후 다시 시도해주세요.",
      );
    } finally {
      setIsPreparingDraft(false);
    }
  }, [currentGuestToken, isGuest, isPreparingDraft]);

  React.useEffect(() => {
    if (!resumeChecked) return;
    if (currentSubmissionId || isPreparingDraft) return;
    void createDraft();
  }, [createDraft, currentSubmissionId, isPreparingDraft, resumeChecked]);

  React.useEffect(() => {
    if (spellcheckAppliedMap[activeTrackIndex]) {
      setLyricsTab("spellcheck");
      return;
    }
    if (profanityCheckedMap[activeTrackIndex]) {
      setLyricsTab("profanity");
    }
  }, [activeTrackIndex, profanityCheckedMap, spellcheckAppliedMap]);
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

  const selectedPackageIndex = React.useMemo(() => {
    if (!selectedPackage) return -1;
    return packages.findIndex((pkg) => pkg.id === selectedPackage.id);
  }, [packages, selectedPackage]);

  const selectedPackageTone =
    selectedPackageIndex >= 0
      ? packageToneClasses[selectedPackageIndex % packageToneClasses.length]
      : null;
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
      const submissionIdFromMsg = (payload.submissionId as string | undefined) || currentSubmissionId;
      const guestTokenFromMsg = payload.guestToken as string | undefined;
      if (status === "SUCCESS") {
        if (submissionIdFromMsg) {
          window.location.href = `/dashboard/submissions/${submissionIdFromMsg}?payment=success`;
        } else if (guestTokenFromMsg) {
          window.location.href = `/track/${guestTokenFromMsg}?payment=success`;
        }
        return;
      }
      if (status === "FAIL" || status === "CANCEL" || status === "ERROR") {
        const message =
          typeof payload.message === "string"
            ? payload.message
            : "결제가 완료되지 않았습니다. 다시 시도해주세요.";
        setNotice({ error: message });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [currentSubmissionId]);

  const stepLabels = (
    <div className="grid gap-3 md:grid-cols-5">
      {steps.map((label, index) => {
        const active = index + 1 <= step;
        const isPackageStep = index === 0;
        const packageLabel =
          isPackageStep && selectedPackage
            ? formatPackageBroadcastLabel(selectedPackage.stationCount)
            : label;
        const activeTone = selectedPackageTone
          ? selectedPackageTone.card
          : "border-[#f6d64a] bg-[#f6d64a] text-black";
        return (
          <div
            key={label}
            className={`rounded-2xl border px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] ${
              active
                ? activeTone
                : "border-border/60 bg-background text-muted-foreground"
            }`}
          >
            STEP {String(index + 1).padStart(2, "0")}
            <p className="mt-2 text-[11px] font-medium tracking-normal">
              {packageLabel}
            </p>
          </div>
        );
      })}
    </div>
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

  const handleProfanityCheck = () => {
    const lyrics = activeTrack.lyrics.trim();
    if (!lyrics) return;
    const v1HasProfanity = profanityTestPattern
      ? profanityTestPattern.test(lyrics)
      : false;
    const { hasProfanity } = runProfanityCheck(lyrics, {
      v1HasProfanity,
      enableV2: isProfanityFilterV2Enabled,
    });
    if (hasProfanity) {
      const shouldProceed = window.confirm(
        "욕설이 감지되었습니다. 욕설이 있는 경우 심의 불통과 확률이 높습니다",
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
    setLyricsTab("profanity");
    markLyricsToolApplied(activeTrackIndex);
  };

  const clearSpellcheckModal = () => {
    setSpellcheckModalOpen(false);
    setSpellcheckPendingTrack(null);
  };

  const buildChangesFromDiffs = (diffs: SpellcheckDiff[]) =>
    diffs
      .filter((diff) => diff.op !== "equal")
      .map((diff) => ({
        before: diff.a ?? "",
        after: diff.b ?? "",
        index: diff.indexA,
      }))
      .filter((change) => change.before || change.after);

  const applySpellcheckSuggestions = (
    trackIndex: number,
    suggestionsToApply: SpellcheckSuggestion[],
    options?: { closeModal?: boolean },
  ) => {
    if (!suggestionsToApply.length) return;
    const currentLyrics = tracks[trackIndex]?.lyrics ?? "";
    let nextLyrics = currentLyrics;
    const applied: SpellcheckSuggestion[] = [];
    const sorted = [...suggestionsToApply].sort((a, b) => b.start - a.start);

    sorted.forEach((suggestion) => {
      const start = Math.max(0, suggestion.start);
      const expectedEnd =
        typeof suggestion.end === "number"
          ? suggestion.end
          : suggestion.start + suggestion.before.length;
      const end = Math.max(start, expectedEnd);
      const before = suggestion.before ?? "";
      const after = suggestion.after ?? "";
      if (!before) return;
      const slice = nextLyrics.slice(start, end);
      if (slice === before) {
        nextLyrics =
          nextLyrics.slice(0, start) +
          after +
          nextLyrics.slice(end);
        applied.push({ ...suggestion, start, end });
        return;
      }
      const fallbackIndex = nextLyrics.indexOf(
        before,
        Math.max(0, start - 8),
      );
      if (fallbackIndex >= 0) {
        nextLyrics =
          nextLyrics.slice(0, fallbackIndex) +
          after +
          nextLyrics.slice(fallbackIndex + before.length);
        applied.push({
          ...suggestion,
          start: fallbackIndex,
          end: fallbackIndex + before.length,
        });
      }
    });

    if (!applied.length) {
      setSpellcheckNoticeMap((prev) => ({
        ...prev,
        [trackIndex]: {
          type: "error",
          message: "적용할 제안이 없습니다. 다시 시도해주세요.",
        },
      }));
      return;
    }

    updateTrack(trackIndex, "lyrics", nextLyrics);
    setSpellcheckChangesByTrack((prev) => ({
      ...prev,
      [trackIndex]: applied.map((item) => ({
        before: item.before,
        after: item.after,
        index: item.start,
      })),
    }));
    setSpellcheckAppliedMap((prev) => ({
      ...prev,
      [trackIndex]: true,
    }));
    setLyricsTab("spellcheck");
    markLyricsToolApplied(trackIndex);
    setSpellcheckNoticeMap((prev) => ({
      ...prev,
      [trackIndex]: {
        type: "success",
        message: `맞춤법이 적용되었습니다. (${applied.length}건)`,
      },
    }));
    if (options?.closeModal) {
      clearSpellcheckModal();
    }
  };

  const handleSpellcheckUndo = () => {
    const original = spellcheckOriginalByTrack[activeTrackIndex];
    if (typeof original !== "string") {
      setSpellcheckNoticeMap((prev) => ({
        ...prev,
        [activeTrackIndex]: {
          type: "error",
          message: "복원할 원문이 없습니다. 다시 맞춤법을 실행해주세요.",
        },
      }));
      return;
    }
    updateTrack(activeTrackIndex, "lyrics", original);
    setSpellcheckAppliedMap((prev) => ({
      ...prev,
      [activeTrackIndex]: false,
    }));
    setSpellcheckChangesByTrack((prev) => ({
      ...prev,
      [activeTrackIndex]: [],
    }));
    setSpellcheckCorrectedByTrack((prev) => ({
      ...prev,
      [activeTrackIndex]: original,
    }));
    setSpellcheckDiffsByTrack((prev) => ({
      ...prev,
      [activeTrackIndex]: [],
    }));
    setSpellcheckNoticeMap((prev) => ({
      ...prev,
      [activeTrackIndex]: {
        type: "info",
        message: "원문으로 복원했습니다.",
      },
    }));
    clearSpellcheckModal();
  };

  const handleSpellCheck = async () => {
    const lyricsFromState = activeTrack.lyrics;
    const lyricsFromDom = lyricsTextareaRef.current?.value ?? "";
    const lyrics = lyricsFromDom || lyricsFromState;
    const trimmedLyrics = lyrics.trim();
    if (!trimmedLyrics) {
      setSpellcheckNoticeMap((prev) => ({
        ...prev,
        [activeTrackIndex]: {
          type: "error",
          message: "가사를 입력한 뒤 맞춤법을 적용해주세요.",
        },
      }));
      return;
    }
    const textarea = lyricsTextareaRef.current;
    const selectionStart = textarea?.selectionStart ?? null;
    const selectionEnd = textarea?.selectionEnd ?? null;
    const scrollTop = textarea?.scrollTop ?? 0;
    setSpellcheckOriginalByTrack((prev) => ({
      ...prev,
      [activeTrackIndex]: lyrics,
    }));
    setSpellcheckChangesByTrack((prev) => ({
      ...prev,
      [activeTrackIndex]: [],
    }));
    setSpellcheckAppliedMap((prev) => ({
      ...prev,
      [activeTrackIndex]: false,
    }));
    setSpellcheckSuggestionsByTrack((prev) => ({
      ...prev,
      [activeTrackIndex]: [],
    }));

    setIsSpellchecking(true);
    setSpellcheckNoticeMap((prev) => ({
      ...prev,
      [activeTrackIndex]: {
        type: "info",
        message: "맞춤법을 적용하는 중입니다.",
      },
    }));
    try {
      console.info("[Spellcheck][request][start]", {
        length: lyrics.length,
        stateLength: lyricsFromState.length,
        domLength: lyricsFromDom.length,
        previewHead: lyrics.slice(0, 80),
        previewTail: lyrics.slice(Math.max(0, lyrics.length - 80)),
        trackIndex: activeTrackIndex,
      });
      const response = await fetch("/api/spellcheck", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: lyrics, mode: "strict", domain: "music" }),
      });
      const payload = await response.json().catch(() => null);
      console.info("[Spellcheck][request][done]", {
        status: response.status,
        ok: response.ok,
        keys: payload ? Object.keys(payload) : [],
        traceId: payload?.meta?.traceId ?? null,
      });
      type SpellcheckResponse = {
        originalText?: string;
        normalizedText?: string;
        correctedText?: string;
        corrected?: string;
        suggestions?: Array<{
          id?: unknown;
          start?: unknown;
          end?: unknown;
          original?: unknown;
          replacement?: unknown;
          type?: unknown;
          confidence?: unknown;
          message?: unknown;
          source?: unknown;
        }>;
        diffs?: Array<{
          op?: unknown;
          a?: unknown;
          b?: unknown;
          indexA?: unknown;
          indexB?: unknown;
        }>;
        meta?: { truncated?: boolean; reasonIfEmpty?: string; traceId?: string };
        error?: { message?: string };
      };
      const spellcheckPayload = payload as SpellcheckResponse | null;
      const rawSuggestions: SpellcheckSuggestion[] = Array.isArray(
        spellcheckPayload?.suggestions,
      )
        ? (spellcheckPayload?.suggestions ?? []).map((item) => ({
            id: typeof item?.id === "string" ? item.id : undefined,
            start:
              typeof item?.start === "number"
                ? item.start
                : Number(item?.start ?? -1),
            end:
              typeof item?.end === "number"
                ? item.end
                : Number(item?.end ?? -1),
            before:
              typeof item?.original === "string"
                ? item.original
                : String(item?.original ?? ""),
            after:
              typeof item?.replacement === "string"
                ? item.replacement
                : String(item?.replacement ?? ""),
            reason:
              typeof item?.message === "string"
                ? item.message
                : typeof item?.type === "string"
                  ? item.type
                  : undefined,
            source:
              typeof item?.source === "string" ? item.source : undefined,
            confidence:
              typeof item?.confidence === "number"
                ? item.confidence
                : undefined,
            type: typeof item?.type === "string" ? item.type : undefined,
          }))
        : [];
      const parsedSuggestions = rawSuggestions.filter(
        (item) =>
          Number.isFinite(item.start) &&
          Number.isFinite(item.end) &&
          typeof item.before === "string" &&
          item.before.length > 0 &&
          typeof item.after === "string" &&
          item.start >= 0 &&
          item.end >= item.start,
      );
      const diffs: SpellcheckDiff[] = Array.isArray(spellcheckPayload?.diffs)
        ? (spellcheckPayload?.diffs ?? [])
            .map((diff) => {
              const resolvedOp: SpellcheckDiff["op"] =
                diff?.op === "equal" ||
                diff?.op === "insert" ||
                diff?.op === "delete" ||
                diff?.op === "replace"
                  ? diff.op
                  : "equal";
              return {
                op: resolvedOp,
                a: typeof diff?.a === "string" ? diff.a : String(diff?.a ?? ""),
                b: typeof diff?.b === "string" ? diff.b : String(diff?.b ?? ""),
                indexA:
                  typeof diff?.indexA === "number"
                    ? diff.indexA
                    : Number(diff?.indexA ?? 0),
                indexB:
                  typeof diff?.indexB === "number"
                    ? diff.indexB
                    : Number(diff?.indexB ?? 0),
              };
            })
            .filter((diff) => Number.isFinite(diff.indexA) && Number.isFinite(diff.indexB))
        : [];
      const correctedText =
        typeof spellcheckPayload?.correctedText === "string"
          ? spellcheckPayload.correctedText
          : typeof spellcheckPayload?.corrected === "string"
            ? spellcheckPayload.corrected
            : lyrics;
      const originalText =
        typeof spellcheckPayload?.originalText === "string"
          ? spellcheckPayload.originalText
          : lyrics;
      const reasonIfEmpty = spellcheckPayload?.meta?.reasonIfEmpty;
      if (!response.ok) {
        const message =
          spellcheckPayload?.error?.message ??
          "일시적으로 맞춤법 적용에 실패했습니다. 잠시 후 다시 시도해주세요.";
        setSpellcheckNoticeMap((prev) => ({
          ...prev,
          [activeTrackIndex]: { type: "error", message },
        }));
        return;
      }

      setSpellcheckCorrectedByTrack((prev) => ({
        ...prev,
        [activeTrackIndex]: correctedText,
      }));
      setSpellcheckDiffsByTrack((prev) => ({
        ...prev,
        [activeTrackIndex]: diffs,
      }));

      if (!parsedSuggestions.length) {
        setSpellcheckNoticeMap((prev) => ({
          ...prev,
          [activeTrackIndex]: {
            type: "info",
            message: `맞춤법 제안이 없습니다.${
              reasonIfEmpty ? ` (사유: ${reasonIfEmpty})` : ""
            }`,
          },
        }));
        return;
      }

      setSpellcheckOriginalByTrack((prev) => ({
        ...prev,
        [activeTrackIndex]: originalText,
      }));
      setSpellcheckSuggestionsByTrack((prev) => ({
        ...prev,
        [activeTrackIndex]: parsedSuggestions,
      }));
      setSpellcheckNoticeMap((prev) => ({
        ...prev,
        [activeTrackIndex]: {
          type: "info",
          message: `맞춤법 제안 ${parsedSuggestions.length}건을 검토 후 적용하세요.`,
        },
      }));
      setSpellcheckPendingTrack(activeTrackIndex);
      setSpellcheckModalOpen(true);

      requestAnimationFrame(() => {
        const target = lyricsTextareaRef.current;
        if (target) {
          if (selectionStart !== null && selectionEnd !== null) {
            target.setSelectionRange(selectionStart, selectionEnd);
          }
          target.scrollTop = scrollTop;
        }
        if (lyricsOverlayRef.current) {
          lyricsOverlayRef.current.scrollTop = scrollTop;
        }
      });
    } catch (error) {
      console.error("[Spellcheck][request][error]", error);
      setSpellcheckNoticeMap((prev) => ({
        ...prev,
        [activeTrackIndex]: {
          type: "error",
          message:
            "일시적으로 맞춤법 적용에 실패했습니다. 잠시 후 다시 시도해주세요.",
        },
      }));
    } finally {
      setIsSpellchecking(false);
    }
  };

  const handleApplyAllSpellcheck = () => {
    const suggestions = spellcheckSuggestionsByTrack[activeTrackIndex] ?? [];
    const corrected = spellcheckCorrectedByTrack[activeTrackIndex];
    const diffs = spellcheckDiffsByTrack[activeTrackIndex] ?? [];
    if (typeof corrected === "string" && corrected.length > 0) {
      updateTrack(activeTrackIndex, "lyrics", corrected);
      const appliedChanges =
        diffs.length > 0 ? buildChangesFromDiffs(diffs) : suggestions.map((item) => ({
          before: item.before,
          after: item.after ?? "",
          index: item.start,
        }));
      setSpellcheckChangesByTrack((prev) => ({
        ...prev,
        [activeTrackIndex]: appliedChanges,
      }));
      setSpellcheckAppliedMap((prev) => ({
        ...prev,
        [activeTrackIndex]: true,
      }));
      setLyricsTab("spellcheck");
      markLyricsToolApplied(activeTrackIndex);
      setSpellcheckNoticeMap((prev) => ({
        ...prev,
        [activeTrackIndex]: {
          type: "success",
          message: `맞춤법이 적용되었습니다. (${appliedChanges.length}건)`,
        },
      }));
      clearSpellcheckModal();
      setSpellcheckSuggestionsByTrack((prev) => ({
        ...prev,
        [activeTrackIndex]: [],
      }));
      return;
    }

    applySpellcheckSuggestions(activeTrackIndex, suggestions, {
      closeModal: true,
    });
    setSpellcheckSuggestionsByTrack((prev) => ({
      ...prev,
      [activeTrackIndex]: [],
    }));
  };

  const handleApplySingleSuggestion = (index: number) => {
    const suggestions = spellcheckSuggestionsByTrack[activeTrackIndex] ?? [];
    const target = suggestions[index];
    if (!target) return;
    applySpellcheckSuggestions(activeTrackIndex, [target]);
    setSpellcheckSuggestionsByTrack((prev) => {
      const next = [...(prev[activeTrackIndex] ?? [])];
      next.splice(index, 1);
      return { ...prev, [activeTrackIndex]: next };
    });
  };

  const handleIgnoreSpellcheck = () => {
    clearSpellcheckModal();
    setSpellcheckSuggestionsByTrack((prev) => ({
      ...prev,
      [activeTrackIndex]: [],
    }));
    setSpellcheckNoticeMap((prev) => ({
      ...prev,
      [activeTrackIndex]: {
        type: "info",
        message: "맞춤법 제안을 닫았습니다. 필요 시 다시 실행하세요.",
      },
    }));
  };

  const handleTranslateLyrics = async () => {
    const lyrics = activeTrack.lyrics.trim();
    if (!lyrics) {
      setNotice({ error: "번역할 가사를 먼저 입력해주세요." });
      return;
    }
    const lines = lyrics.split("\n");
    const segmentMap = lines.map((line) => extractForeignSegments(line));
    const sentencesToTranslate = segmentMap.flatMap((segments) =>
      segments.flatMap((segment) => segment.sentences),
    );
    if (!sentencesToTranslate.length) {
      setNotice({
        error: "한국어 외 언어 가사를 찾지 못했습니다. 번역 대상을 확인해주세요.",
      });
      return;
    }
    setIsTranslatingLyrics(true);
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lines: sentencesToTranslate,
          source: "auto",
          target: "ko",
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Translation failed");
      }
      const translations: string[] = Array.isArray(payload?.translations)
        ? payload.translations
        : [];
      let translationIndex = 0;
      const translatedLines = lines.map((line, index) => {
        const segments = segmentMap[index];
        if (!segments.length) return line;

        let nextLine = line;
        const replacements = segments.map((segment) => {
          const translatedSentences = segment.sentences.map((sentence) => {
            const translation = translations[translationIndex] ?? "";
            translationIndex += 1;
            const translated = translation.trim() || "번역 실패";
            return `${sentence} (번역: ${translated})`;
          });
          const leading = segment.raw.match(/^\s*/)?.[0] ?? "";
          const trailing = segment.raw.match(/\s*$/)?.[0] ?? "";
          return {
            start: segment.start,
            end: segment.end,
            replacement: `${leading}${translatedSentences.join(" ")}${trailing}`,
          };
        });

        replacements
          .sort((a, b) => b.start - a.start)
          .forEach((segment) => {
            nextLine =
              nextLine.slice(0, segment.start) +
              segment.replacement +
              nextLine.slice(segment.end);
          });

        return nextLine;
      });
      updateTrack(activeTrackIndex, "translatedLyrics", translatedLines.join("\n"));
      setTranslationPanelOpenMap((prev) => ({
        ...prev,
        [activeTrackIndex]: true,
      }));
      markLyricsToolApplied(activeTrackIndex);
      setSpellcheckNoticeMap((prev) => ({
        ...prev,
        [activeTrackIndex]: {
          type: "info",
          message: "번역본 가사 탭에 자동 번역 결과를 적용했습니다.",
        },
      }));
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

  const addTrack = () => {
    setTracks((prev) => {
      const next = [...prev, { ...initialTrack }];
      setActiveTrackIndex(next.length - 1);
      return next;
    });
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
          "접수 초안을 준비하는 중입니다. 잠시 후 다시 시도하거나 다시 시도 버튼을 눌러주세요.",
      });
      return;
    }
    const allowedTypes = new Set([
      "audio/wav",
      "audio/x-wav",
      "application/zip",
      "application/x-zip-compressed",
    ]);
    let invalidNotice: string | null = null;
    const filtered = selected.filter((file) => {
      if (file.size > uploadMaxBytes) {
        invalidNotice = `파일 용량은 ${uploadMaxLabel} 이하만 가능합니다.`;
        return false;
      }
      if (file.type && !allowedTypes.has(file.type)) {
        invalidNotice = "WAV 또는 ZIP 파일만 업로드할 수 있습니다.";
        return false;
      }
      if (!file.type) {
        const lowerName = file.name.toLowerCase();
        if (!lowerName.endsWith(".wav") && !lowerName.endsWith(".zip")) {
          invalidNotice = "WAV 또는 ZIP 파일만 업로드할 수 있습니다.";
          return false;
        }
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

  const uploadWithProgress = async (
    file: File,
    onProgress: (percent: number) => void,
  ) => {
    const submissionId = requireSubmissionId();
    const directUploadFallback = () =>
      new Promise<{ objectKey: string }>((resolve, reject) => {
        const formData = new FormData();
        formData.append("submissionId", submissionId);
        formData.append("filename", file.name);
        formData.append("mimeType", file.type || "application/octet-stream");
        formData.append("sizeBytes", String(file.size));
        formData.append("kind", "audio");
        if (isGuest && currentGuestToken) formData.append("guestToken", currentGuestToken);
        if (title.trim()) formData.append("title", title.trim());
        formData.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const json = JSON.parse(xhr.responseText) as { objectKey?: string; error?: string };
              if (json.objectKey) {
                resolve({ objectKey: json.objectKey });
                return;
              }
              reject(new Error(json.error || "Upload failed"));
            } catch {
              reject(new Error("Upload failed (응답 해석 실패)"));
            }
          } else {
            reject(new Error(`Upload failed (status ${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed (network/CORS)"));
        xhr.open("POST", "/api/uploads/direct");
        xhr.send(formData);
      });

    const initRes = await fetch("/api/uploads/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId,
        kind: "audio",
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        guestToken: isGuest ? currentGuestToken : undefined,
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
      console.warn("[Upload][album] init failed, fallback to direct", {
        status: initRes.status,
        error: initJson.error,
      });
      const fallback = await directUploadFallback();
      await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          kind: "audio",
          key: fallback.objectKey,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          guestToken: isGuest ? currentGuestToken : undefined,
        }),
      }).catch(() => null);
      return { objectKey: fallback.objectKey };
    }

    const { key, uploadUrl, headers } = initJson;
    const contentType = headers?.["Content-Type"] || file.type || "application/octet-stream";

    try {
      await new Promise<void>((resolve, reject) => {
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
    } catch (error) {
      console.warn("[Upload][album] presigned PUT failed, fallback to direct", error);
      const fallback = await directUploadFallback();
      await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          kind: "audio",
          key: fallback.objectKey,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          guestToken: isGuest ? currentGuestToken : undefined,
        }),
      }).catch(() => null);
      return { objectKey: fallback.objectKey };
    }

    await fetch("/api/uploads/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId,
        kind: "audio",
        key,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        guestToken: isGuest ? currentGuestToken : undefined,
      }),
    }).catch(() => null);

    return { objectKey: key };
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
    setDraftError(null);
    void createDraft();
    setCurrentGuestToken(safeRandomUUID());
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

  const captureCurrentDraft = (): AlbumDraft => ({
    submissionId: requireSubmissionId(),
    guestToken: currentGuestToken,
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
    applyStoredDrafts(resumePrompt.drafts, fallbackGuestToken);
    writeDraftStorage({
      ids: resumePrompt.drafts
        .map((draft) => String(draft.id ?? ""))
        .filter(Boolean),
      guestToken: isGuest ? fallbackGuestToken : null,
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
    clearDraftStorage();
    try {
      await clearServerDrafts({ guestToken });
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
      const payload = {
        type: "ALBUM",
        ids: stored?.ids,
        guestToken: isGuest ? storedGuestToken : undefined,
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
      guestToken: currentGuestToken,
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
      tracks: tracks.map((track) => ({ ...track })),
      files: uploaded,
      emailSubmitConfirmed,
    };
  };

  const confirmEmailSubmission = React.useCallback(() => {
    const message =
      "음원을 이메일로 제출하시겠습니까?\n(파일 업로드 없이 다음 단계로 이동합니다)";
    const confirmed =
      typeof window !== "undefined" ? window.confirm(message) : false;
    if (confirmed) {
      setEmailSubmitConfirmed(true);
      setNotice({});
      setUploadDrafts((prev) => {
        if (!prev) return prev;
        return prev.map((draft, index) =>
          index === uploadDraftIndex
            ? { ...draft, emailSubmitConfirmed: true }
            : draft,
        );
      });
    }
    return confirmed;
  }, [uploadDraftIndex]);

  const getTrackDisplayTitle = (track: TrackInput) =>
    track.trackTitle.trim() || "제목 미입력";

  const mapTracksForSave = (trackList: TrackInput[]) => {
    const isSingleTrack = trackList.length === 1;
    return trackList.map((track) => ({
      ...track,
      trackTitle: track.trackTitle.trim(),
      isTitle: isSingleTrack ? true : Boolean(track.isTitle),
      titleRole: isSingleTrack
        ? "MAIN"
        : track.isTitle
          ? track.titleRole || "SUB"
          : undefined,
      broadcastSelected: track.broadcastSelected,
    }));
  };

  const validateFormStep = () => {
    if (!selectedPackage) {
      setNotice({ error: "패키지를 선택해주세요." });
      return false;
    }

    if (!applicantName.trim() || !applicantEmail.trim() || !applicantPhone.trim()) {
      setNotice({ error: "접수자 정보(이름/이메일/연락처)를 입력해주세요." });
      return false;
    }

    if (isOneClick) {
      if (!melonUrl.trim()) {
        setNotice({ error: "멜론 링크를 입력해주세요." });
        return false;
      }
      if (!artistName.trim()) {
        setNotice({ error: "아티스트명을 입력해주세요. (원클릭 필수)" });
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

      if (tracks.some((track) => !track.trackTitle.trim())) {
        setNotice({ error: "모든 트랙의 곡명을 입력해주세요." });
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
    }
    return true;
  };

  const validateTranslatedLyrics = () => {
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

  const validateUploadStep = (drafts: AlbumDraft[]) => {
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
      if (missingUploads.length === 1 && confirmEmailSubmission()) {
        return true;
      }
      setNotice({
        error: "음원 파일을 업로드하거나 이메일 제출을 선택해주세요.",
      });
      return false;
    }

    return true;
  };

  const validatePaymentDocument = () => {
    if (paymentMethod !== "BANK") return true;
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
    }
    return true;
  };

  const startEditingDraft = (index: number) => {
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

    if (
      typeof window !== "undefined" &&
      !window.confirm("해당 앨범 정보를 불러오겠습니까?")
    ) {
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
          tracks: isOneClick ? undefined : mapTracksForSave(draft.tracks),
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
        guestToken: isGuest ? currentGuestToken : null,
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
    if (!validateFormStep()) {
      return;
    }
    setIsAddingAlbum(true);
    setNotice({});
    try {
      const draft = await buildAlbumDraft({ includeUpload: false });
      if (editingIndex !== null) {
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
        setAlbumDrafts((prev) => [...prev, draft]);
        resetAlbumForm();
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

  const handleStep2Next = async () => {
    if (editingIndex !== null) {
      setNotice({ error: "수정 중인 앨범을 저장한 뒤 진행해주세요." });
      return;
    }
    if (!validateFormStep()) {
      return;
    }
    let currentDraft: AlbumDraft;
    try {
      currentDraft = captureCurrentDraft();
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
    setStep(3);
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
    if (!validateUploadStep(draftsForUpload)) {
      return;
    }
    const saved = await saveAlbumDrafts(draftsForUpload, { includeFiles: true });
    if (saved) {
      setStep(4);
    }
  };

  const handleSave = async (status: "DRAFT" | "SUBMITTED") => {
    if (editingIndex !== null) {
      setNotice({ error: "수정 중인 앨범을 저장한 뒤 진행해주세요." });
      return;
    }
    if (status === "SUBMITTED" && !validateFormStep()) {
      return;
    }
    if (status === "SUBMITTED" && !isOneClick && !validateTranslatedLyrics()) {
      return;
    }
    if (
      status === "SUBMITTED" &&
      paymentMethod === "BANK" &&
      !bankDepositorName.trim()
    ) {
      setNotice({ error: "입금자명을 입력해주세요." });
      return;
    }
    if (status === "SUBMITTED" && paymentMethod === "BANK") {
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
    if (status === "SUBMITTED" && !validateUploadStep(draftsForSubmit)) {
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
      let emailWarning: string | undefined;

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
          melonUrl: isOneClick ? draft.melonUrl || undefined : undefined,
          guestToken: draft.guestToken,
          guestName: applicantNameValue,
          guestCompany: draft.productionCompany || undefined,
          guestEmail: applicantEmailValue,
          guestPhone: applicantPhoneValue,
          paymentMethod,
          bankDepositorName:
            status === "SUBMITTED" ? bankDepositorName.trim() : undefined,
          paymentDocumentType:
            status === "SUBMITTED" ? paymentDocumentType || undefined : undefined,
          cashReceiptPurpose:
            status === "SUBMITTED" && paymentDocumentType === "CASH_RECEIPT"
              ? cashReceiptPurpose || undefined
              : undefined,
          cashReceiptPhone:
            status === "SUBMITTED" &&
            paymentDocumentType === "CASH_RECEIPT" &&
            cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION"
              ? cashReceiptPhone.trim() || undefined
              : undefined,
          cashReceiptBusinessNumber:
            status === "SUBMITTED" &&
            paymentDocumentType === "CASH_RECEIPT" &&
            cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
              ? cashReceiptBusinessNumber.trim() || undefined
              : undefined,
          taxInvoiceBusinessNumber:
            status === "SUBMITTED" && paymentDocumentType === "TAX_INVOICE"
              ? taxInvoiceBusinessNumber.trim() || undefined
              : undefined,
          status,
          tracks: isOneClick ? undefined : mapTracksForSave(draft.tracks),
          files: status === "SUBMITTED" ? draft.files : undefined,
        });

        if (result.error) {
          setNotice({ error: result.error });
          return;
        }

        if (result.submissionId) {
          submissionIds.push(result.submissionId);
        }
        if (result.guestToken) {
          guestTokens.push({
            token: result.guestToken,
            title: draft.title.trim() || "제목 미입력",
          });
        }
        if (result.emailWarning && !emailWarning) {
          emailWarning = result.emailWarning;
        }
      }

      if (status === "SUBMITTED" && submissionIds.length > 0) {
        clearDraftStorage();
        if (paymentMethod === "CARD") {
          const { ok, error } = openInicisCardPopup({
            context: isOneClick ? "oneclick" : "music",
            submissionId: submissionIds[0],
            guestToken: guestTokens[0]?.token ?? currentGuestToken ?? undefined,
          });
          if (!ok) {
            setNotice({
              error: error || "결제 팝업을 열지 못했습니다. 팝업 차단을 해제한 뒤 다시 시도해주세요.",
            });
          }
          return;
        } else if (paymentMethod === "BANK") {
          if (typeof window !== "undefined") {
            window.alert("심의 접수가 완료되었습니다.");
            if (emailWarning) {
              window.alert(emailWarning);
            }
          }
          setCompletionId(submissionIds[0]);
          setCompletionSubmissionIds(submissionIds);
          if (guestTokens.length > 0) {
            setCompletionTokens(guestTokens);
          }
          setStep(5);
          return;
        } else {
          console.warn("[Inicis][STDPay][init][client] unknown payment method", paymentMethod);
          setNotice({ error: "지원하지 않는 결제 수단입니다." });
          return;
        }
      }

      if (emailWarning && typeof window !== "undefined") {
        window.alert(emailWarning);
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
        label="심의 저장/결제 처리 중..."
      />
      {resumePrompt && !isFromDraftsTab ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-[28px] border border-border/60 bg-background p-6 text-foreground shadow-xl"
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
      {spellcheckModalOpen && spellcheckPendingTrack === activeTrackIndex ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
          <button
            type="button"
            onClick={handleIgnoreSpellcheck}
            className="absolute inset-0 bg-black/50"
            aria-label="맞춤법 제안 닫기"
          />
          <div className="relative z-10 w-full max-w-3xl rounded-3xl border border-border/80 bg-card/95 p-6 shadow-2xl backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  맞춤법 제안
                </p>
                <p className="text-sm text-muted-foreground">
                  {spellcheckSuggestions.length}건의 제안을 검토 후 적용하세요.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyAllSpellcheck}
                  className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-background hover:bg-foreground/90"
                >
                  전체 적용
                </button>
                <button
                  type="button"
                  onClick={handleIgnoreSpellcheck}
                  className="rounded-full border border-border/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-foreground hover:border-foreground hover:bg-foreground/5"
                >
                  모두 무시
                </button>
                <button
                  type="button"
                  onClick={handleSpellcheckUndo}
                  className="rounded-full border border-border/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-foreground hover:border-foreground hover:bg-foreground/5"
                >
                  원문으로 되돌리기
                </button>
                <button
                  type="button"
                  onClick={clearSpellcheckModal}
                  className="rounded-full border border-border/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-foreground hover:border-foreground hover:bg-foreground/5"
                >
                  닫기
                </button>
              </div>
            </div>
            <div className="mt-4 max-h-[50vh] space-y-3 overflow-auto pr-1">
              {spellcheckSuggestions.length > 0 ? (
                spellcheckSuggestions.map((suggestion, index) => (
                  <div
                    key={`${suggestion.before}-${suggestion.start}-${index}`}
                    className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        위치 {suggestion.start}–{suggestion.end}
                        {suggestion.reason ? ` · ${suggestion.reason}` : ""}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleApplySingleSuggestion(index)}
                        className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-foreground hover:border-foreground hover:bg-foreground/5"
                      >
                        적용
                      </button>
                    </div>
                    <div className="mt-2 flex flex-col gap-1 text-sm leading-relaxed">
                      <div className="inline-flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-rose-800 dark:bg-rose-500/20 dark:text-rose-100">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-rose-500">
                          Before
                        </span>
                        <span className="font-semibold">{suggestion.before}</span>
                      </div>
                      <div className="inline-flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-600">
                          After
                        </span>
                        <span className="font-semibold">{suggestion.after}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                  맞춤법 제안이 없습니다.
                </div>
              )}
            </div>
            <div className="mt-4 rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
              제안은 원문 기준 위치로 표시됩니다. 가사를 수정했다면 다시 맞춤법을 실행해주세요.
            </div>
          </div>
        </div>
      ) : null}

      {stepLabels}

      {step === 1 && (
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 01
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                패키지를 선택하세요.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                포함 방송국과 가격을 확인하고 선택하면 다음 단계로 이동합니다.
              </p>
            </div>
          </div>

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
                className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${
                  !isOneClick
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-background text-foreground hover:border-foreground"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                  Standard
                </p>
                <p className="mt-2 text-sm font-semibold">일반 접수</p>
                <p className="mt-2 text-xs opacity-80">
                  트랙 정보를 직접 입력하는 기본 심의 접수입니다.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectionLocked) return;
                  setIsOneClick(true);
                  setShowOneclickNotice(true);
                }}
                disabled={selectionLocked}
                className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${
                  isOneClick
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-background text-foreground hover:border-foreground"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                  One Click
                </p>
                <p className="mt-2 text-sm font-semibold">원클릭 접수</p>
                <p className="mt-2 text-xs opacity-80">
                  멜론 링크와 음원 파일만 제출하는 간편 접수입니다.
                </p>
              </button>
            </div>
            {selectionLocked && (
              <p className="mt-3 text-xs text-muted-foreground">
                추가 앨범이 등록된 경우 접수 방식은 변경할 수 없습니다.
              </p>
            )}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {packages.map((pkg, index) => {
              const isActive = activePackageId === pkg.id;
              const isDisabled =
                selectionLocked && selectedPackage?.id !== pkg.id;
              const tone =
                packageToneClasses[index % packageToneClasses.length];
              const displayPrice = isOneClick
                ? oneClickPriceMap[pkg.stationCount] ?? pkg.priceKrw
                : pkg.priceKrw;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => {
                    if (selectionLocked && selectedPackage?.id !== pkg.id) {
                      return;
                    }
                    setPackageConfirmTarget(pkg);
                  }}
                  disabled={isDisabled}
                  className={`text-left rounded-[28px] border p-6 transition disabled:cursor-not-allowed disabled:opacity-70 ${
                    isActive
                      ? tone.card
                      : "border-border/60 bg-card/80 text-foreground hover:border-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] opacity-70">
                        {formatPackageName(pkg.stationCount, isOneClick)}
                      </p>
                      <h3 className="mt-2 text-xl font-semibold">
                        {formatPackageName(pkg.stationCount, isOneClick)}
                      </h3>
                    </div>
                    <span className="text-sm font-semibold">
                      {formatCurrency(displayPrice)}원
                    </span>
                  </div>
                  <p className="mt-3 text-xs opacity-70">
                    {formatPackageDescription(pkg.description, pkg.stationCount)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {pkg.stations.map((station) => (
                      <span
                        key={station.id}
                        className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${
                          isActive
                            ? tone.chip
                            : "border-border/60 text-muted-foreground"
                        }`}
                      >
                        {station.name}
                      </span>
                    ))}
                  </div>
                </button>
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

      {step === 2 && (
        <div className="space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 02
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                신청서 정보를 입력하세요.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {isOneClick
                  ? "멜론 링크와 기본 정보를 입력한 뒤 다음 단계에서 음원 파일을 업로드합니다."
                  : "트랙 정보를 입력한 뒤 다음 단계에서 음원 파일을 업로드합니다."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                현재 앨범 {albumDrafts.length + 1} 입력 중
                {albumDrafts.length > 0
                  ? ` · 추가 앨범 ${albumDrafts.length}건 등록됨`
                  : ""}
              </p>
            </div>
          </div>

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
                <div className="rounded-2xl border border-[#f6d64a] bg-[#f6d64a] px-4 py-3 text-xs text-black dark:border-[#f6d64a] dark:bg-[#f6d64a] dark:text-black">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                    원클릭 접수 안내
                  </p>
                  <p className="mt-2 text-xs">
                    이미 발매된 음원에 한정된 서비스입니다. 멜론 링크와 음원 파일만
                    첨부하면 접수가 완료됩니다.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      아티스트명 *
                    </label>
                    <input
                      value={artistName}
                      onChange={(event) => setArtistName(event.target.value)}
                      placeholder="발매된 음원의 아티스트명을 입력해주세요."
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      앨범 제목 (선택)
                    </label>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="입력하지 않으면 '원클릭 접수'로 표시됩니다."
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
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

          {!isOneClick && (
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
                <div className="space-y-2">
                  {tracks.map((track, index) => {
                    const active = index === activeTrackIndex;
                    return (
                      <button
                        key={`track-tab-${index}`}
                        type="button"
                        onClick={() => setActiveTrackIndex(index)}
                        className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                          active
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
                        <div
                          className={`mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em] ${
                            active ? "text-background" : ""
                          }`}
                        >
                          {track.isTitle && (
                            <span
                              className={`rounded-full border px-2 py-1 ${
                                track.titleRole === "MAIN"
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
                              className={`rounded-full border px-2 py-1 ${
                                active
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
                  <button
                    type="button"
                    onClick={addTrack}
                    className="w-full rounded-2xl border border-dashed border-border/70 px-3 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:border-foreground hover:text-foreground"
                  >
                    + 트랙 추가
                  </button>
                </div>

                <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">
                      트랙 {activeTrackIndex + 1}
                    </p>
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
                          트랙 정보 삭제
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
                            onClick={handleSpellCheck}
                            disabled={isSpellchecking}
                            className="rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5 active:translate-y-0 active:shadow-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            맞춤법 {isSpellchecking ? "적용 중..." : "자동 적용"}
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
                        {spellcheckNotice && (
                          <div
                            className={`mt-2 rounded-2xl border px-4 py-2 text-xs font-semibold ${
                              spellcheckNotice.type === "error"
                                ? "border-red-200/70 bg-red-50 text-red-700"
                                : spellcheckNotice.type === "success"
                                  ? "border-emerald-200/70 bg-emerald-50 text-emerald-800"
                                  : "border-[#f6d64a] bg-[#f6d64a] text-black"
                            }`}
                          >
                            {spellcheckNotice.message}
                          </div>
                        )}
                        {showLyricsToolNotice && (
                          <div className="pointer-events-none mt-0 max-h-0 overflow-hidden rounded-2xl border border-transparent bg-transparent px-4 py-0 text-sm font-semibold leading-relaxed text-black opacity-0 transition-all duration-300 ease-out group-hover/lyrics-tools:pointer-events-auto group-hover/lyrics-tools:mt-2 group-hover/lyrics-tools:max-h-64 group-hover/lyrics-tools:border-[#f6d64a] group-hover/lyrics-tools:bg-[#f6d64a] group-hover/lyrics-tools:py-3 group-hover/lyrics-tools:opacity-100 group-focus-within/lyrics-tools:pointer-events-auto group-focus-within/lyrics-tools:mt-2 group-focus-within/lyrics-tools:max-h-64 group-focus-within/lyrics-tools:border-[#f6d64a] group-focus-within/lyrics-tools:bg-[#f6d64a] group-focus-within/lyrics-tools:py-3 group-focus-within/lyrics-tools:opacity-100">
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
                          className={`relative z-0 min-h-[180px] w-full resize-y overflow-y-auto bg-transparent px-4 py-3 text-sm leading-relaxed outline-none ${
                            showProfanityOverlay
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
                            className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition ${
                              showTranslatedLyricsPanel
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
                          <div className="flex flex-wrap items-center gap-2">
                            {showProfanityPanel && (
                              <button
                                type="button"
                                onClick={() => setLyricsTab("profanity")}
                                className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                                  lyricsTab === "profanity"
                                    ? "bg-foreground text-background"
                                    : "border border-border/70 text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                욕설 표시
                              </button>
                            )}
                            {showSpellcheckPreview && (
                              <button
                                type="button"
                                onClick={() => setLyricsTab("spellcheck")}
                                className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                                  lyricsTab === "spellcheck"
                                    ? "bg-foreground text-background"
                                    : "border border-border/70 text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                맞춤법 수정
                              </button>
                            )}
                          </div>
                          {lyricsTab === "profanity" && showProfanityPanel && (
                            <div className="mt-3 space-y-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                                감지된 단어
                              </p>
                              <div className="max-h-32 space-y-2 overflow-auto pr-1">
                                {profanityWords.length > 0 ? (
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
                          {lyricsTab === "spellcheck" &&
                            showSpellcheckPreview && (
                              <div className="mt-3 space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                                  수정 내역
                                </p>
                                <div className="max-h-32 space-y-2 overflow-auto pr-1">
                                  {hasSpellcheckChanges ? (
                                    spellcheckChanges.map((change, index) => (
                                      <div
                                        key={`${change.before}-${index}`}
                                        className="rounded-xl border border-border/60 bg-background/80 px-3 py-2 text-[11px]"
                                      >
                                        <span className="text-muted-foreground">
                                          {change.before}
                                        </span>
                                        <span className="mx-2 text-muted-foreground">
                                          →
                                        </span>
                                        <span className="font-semibold text-foreground">
                                          {change.after}
                                        </span>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="rounded-xl border border-dashed border-border/60 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                                      맞춤법 수정 내역이 없습니다.
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

          {albumDrafts.length > 0 && (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                등록 앨범 목록
              </p>
              <div className="mt-3 space-y-2">
                {albumDrafts.map((draft, index) => (
                  <div
                    key={draft.submissionId}
                    onClick={() => startEditingDraft(index)}
                    role="button"
                    tabIndex={0}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs transition ${
                      editingIndex === index
                        ? "border-[#f6d64a] bg-[#f6d64a] text-black"
                        : "border-border/60 bg-background/70 hover:border-foreground"
                    }`}
                  >
                    <div>
                      <p
                        className={`text-sm font-semibold ${
                          editingIndex === index ? "text-black" : "text-foreground"
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
                        className={`text-xs ${
                          editingIndex === index
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
              onClick={() => setStep(1)}
              disabled={isSaving || isAddingAlbum}
              className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
            >
              이전 단계
            </button>
            {!isGuest && (
              <button
                type="button"
                onClick={async () => {
                  if (editingIndex !== null) {
                    setNotice({
                      error: "수정 중인 앨범을 저장한 뒤 진행해주세요.",
                    });
                    return;
                  }
                  let draftsForSave: AlbumDraft[];
                  try {
                    draftsForSave = [captureCurrentDraft(), ...albumDrafts];
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
                  await saveAlbumDrafts(draftsForSave, { includeFiles: false });
                }}
                disabled={isSaving || isAddingAlbum}
                className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
              >
                임시 저장
              </button>
            )}
            <button
              type="button"
              onClick={handleAddAlbum}
              disabled={isSaving || isAddingAlbum}
              className="rounded-full border border-border/70 bg-foreground/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-[#f6d64a] hover:bg-foreground/10 hover:text-slate-900 dark:bg-transparent dark:hover:bg-white/10 dark:hover:text-white disabled:cursor-not-allowed"
            >
              {editingIndex !== null ? "선택 앨범 수정 저장" : "추가 앨범 등록"}
            </button>
            <button
              type="button"
              onClick={handleStep2Next}
              disabled={isSaving || isAddingAlbum || editingIndex !== null}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
            >
              다음 단계
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-8">
          {isDraggingOver && (
            <div className="pointer-events-none fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]" />
          )}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 03
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                파일 업로드
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                업로드 대상 앨범을 선택한 뒤 음원 파일을 첨부하세요.
              </p>
            </div>
          </div>

          {uploadDrafts && uploadDrafts.length > 0 && (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                업로드 대상 앨범
              </p>
              <div className="mt-3 space-y-2">
                {uploadDrafts.map((draft, index) => (
                  <div
                    key={draft.submissionId}
                    onClick={() => handleSelectUploadDraft(index)}
                    role="button"
                    tabIndex={0}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs transition ${
                      uploadDraftIndex === index
                        ? "border-[#f6d64a] bg-[#f6d64a] text-black"
                        : "border-border/60 bg-background/70 hover:border-foreground"
                    }`}
                  >
                    <div>
                      <p
                        className={`text-sm font-semibold ${
                          uploadDraftIndex === index
                            ? "text-black"
                            : "text-foreground"
                        }`}
                      >
                        앨범 {index + 1}
                      </p>
                      <p
                        className={`text-xs ${
                          uploadDraftIndex === index
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
                      className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${
                        uploadDraftIndex === index
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
                  accept=".wav,.zip,application/zip"
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
                    허용 형식: <span className="font-mono text-[12px]">WAV/ZIP</span>
                    <span className="text-white/70">·</span>
                    최대 <span className="font-mono text-[12px]">{uploadMaxLabel}</span>
                  </span>
                  <span className="text-[11px] font-normal text-muted-foreground text-center">
                    * 수록곡이 많은 경우 ZIP으로 압축한 하나의 파일로 업로드해주세요.
                  </span>
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
                    아직 선택된 파일이 없습니다.
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    업로드 없이 진행하려면 이메일 제출을 선택하세요.
                  </p>
                  <div className="mt-3 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={confirmEmailSubmission}
                      className="rounded-full border border-border/70 bg-background px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
                    >
                      이메일 제출 선택
                    </button>
                    {emailSubmitConfirmed ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/70 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
                        선택됨
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              <p>
                용량이 크거나 첨부가 어려운 경우 이메일로 음원을 꼭 제출해주세요.
              </p>
              {isOneClick && (
                <p>원클릭 접수는 음원 파일만 제출하면 됩니다.</p>
              )}
              <p className="font-semibold text-foreground">
                {APP_CONFIG.supportEmail}
              </p>
              <p className="text-xs text-muted-foreground">
                CD 제작 등 실물 앨범을 발표한 경우{" "}
                <button
                  type="button"
                  onClick={() => setShowCdInfo(true)}
                  className="font-semibold text-amber-500 transition hover:text-amber-400"
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
              onClick={() => setStep(2)}
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

      {step === 4 && (
        <div className="space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 04
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                결제하기
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                무통장 입금 또는 카드 결제를 선택할 수 있습니다.
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              선택한 옵션
            </p>
            <div className="mt-4 space-y-3 text-sm text-foreground">
              {selectedPackageSummary ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {formatPackageName(
                          selectedPackageSummary.stationCount,
                          isOneClick,
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatPackageName(
                          selectedPackageSummary.stationCount,
                          isOneClick,
                        )}{" "}
                        · 총 {totalAlbumCount}건
                      </p>
                    </div>
                    <span className="text-sm font-semibold">
                      {formatCurrency(basePriceKrw)}원
                    </span>
                  </div>
                  {additionalAlbumCount > 0 && (
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        추가 앨범 {additionalAlbumCount}건 (50% 할인)
                      </span>
                      <span>
                        {formatCurrency(
                          additionalAlbumCount * additionalPriceKrw,
                        )}
                        원
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  선택된 패키지가 없습니다.
                </p>
              )}
              {isOneClick && (
                <span className="inline-flex rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  원클릭 접수
                </span>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm font-semibold text-foreground">
              <span>총 결제 금액</span>
              <span>
                {formatCurrency(totalPriceKrw)}원
              </span>
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              결제 방식 선택
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("BANK")}
                className={`rounded-2xl border p-4 text-left transition ${
                  paymentMethod === "BANK"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-background text-foreground hover:border-foreground"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                  Bank
                </p>
                <p className="mt-2 text-sm font-semibold">무통장 입금</p>
                <p className="mt-2 text-xs opacity-80">
                  입금 확인 후 진행이 시작됩니다.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("CARD")}
                className={`rounded-2xl border p-4 text-left transition ${
                  paymentMethod === "CARD"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-background text-foreground hover:border-foreground"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                  Card
                </p>
                <p className="mt-2 text-sm font-semibold">카드 결제</p>
                <p className="mt-2 text-xs opacity-80">
                  카드 결제로 진행할 수 있습니다.
                </p>
              </button>
            </div>
          </div>

          {paymentMethod === "BANK" && (
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
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      paymentDocumentType === "CASH_RECEIPT"
                        ? "border-foreground bg-foreground/5 text-foreground"
                        : "border-border/70 bg-background text-muted-foreground hover:border-foreground"
                    }`}
                  >
                    <input
                      type="radio"
                      name="album-payment-document"
                      checked={paymentDocumentType === "CASH_RECEIPT"}
                      onChange={() => {
                        setPaymentDocumentType("CASH_RECEIPT");
                        setTaxInvoiceBusinessNumber("");
                      }}
                      className="h-4 w-4 accent-foreground"
                    />
                    현금 영수증 발급
                  </label>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      paymentDocumentType === "TAX_INVOICE"
                        ? "border-foreground bg-foreground/5 text-foreground"
                        : "border-border/70 bg-background text-muted-foreground hover:border-foreground"
                    }`}
                  >
                    <input
                      type="radio"
                      name="album-payment-document"
                      checked={paymentDocumentType === "TAX_INVOICE"}
                      onChange={() => {
                        setPaymentDocumentType("TAX_INVOICE");
                        setCashReceiptPurpose("");
                        setCashReceiptPhone("");
                        setCashReceiptBusinessNumber("");
                      }}
                      className="h-4 w-4 accent-foreground"
                    />
                    세금계산서 발급
                  </label>
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  * 결제 연관 서류는 기재해주신 이메일로 전송됩니다.
                </p>
                {paymentDocumentType === "CASH_RECEIPT" && (
                  <div className="mt-4 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION"
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
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
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
                  <div className="mt-4 space-y-2">
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
                  </div>
                )}
              </div>
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
            <button
              type="button"
              onClick={() => handleSave("SUBMITTED")}
              disabled={isSaving || isAddingAlbum}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
            >
              결제하기
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="rounded-[32px] border border-border/60 bg-card/80 p-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            STEP 05
          </p>
          <h2 className="font-display mt-3 text-3xl text-foreground">
            접수 완료
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            결제 확인 후 진행 상태가 업데이트됩니다.
          </p>
          {completionId && !shouldShowGuestLookup && (
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
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
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-foreground">
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
                        onClick={() => router.push(`/track/${item.token}`)}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={handleCancelPackage}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border/60 bg-background p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              확인
            </p>
            <p className="mt-2 text-lg font-semibold">
              {`${formatPackageName(
                packageConfirmTarget.stationCount,
                isOneClick,
              )}로 진행할까요?`}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              선택을 확정하면 신청서 작성 단계로 이동합니다.
            </p>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowCdInfo(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 shadow-xl"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
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
