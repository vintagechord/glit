"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PendingOverlay } from "@/components/ui/pending-overlay";
import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import { openInicisCardPopup } from "@/lib/inicis/popup";
import { safeRandomUUID } from "@/lib/uuid";

import {
  saveMvSubmissionAction,
  type SubmissionActionState,
} from "./actions";

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

type PaymentDocumentType = "" | "CASH_RECEIPT" | "TAX_INVOICE";
type CashReceiptPurpose =
  | ""
  | "PERSONAL_INCOME_DEDUCTION"
  | "BUSINESS_EXPENSE_PROOF";

const steps = [
  "목적 선택",
  "신청서 작성",
  "파일 업로드",
  "결제하기",
  "접수 완료",
];

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
const draftDeleteTimeoutMs = 8000;
const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");

const multipartThresholdMbRaw = Number(
  process.env.NEXT_PUBLIC_UPLOAD_MULTIPART_THRESHOLD_MB ?? "200",
);
const multipartThresholdMb = Number.isFinite(multipartThresholdMbRaw)
  ? multipartThresholdMbRaw
  : 200;
const multipartThresholdBytes = multipartThresholdMb * 1024 * 1024;

const baseOnlinePrice = 30000;
// TEMP(test): ETN 입고 옵션 결제 모듈 테스트용 금액. 테스트 종료 후 30000으로 복원.
const etnOptionPrice = 1000;
const stationPriceMap: Record<string, number> = {
  KBS: 30000,
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

const onlineOptionConfirmDetails: Record<
  string,
  { title: string; lines: string[] }
> = {
  MBC: {
    title: "MBC 뮤직비디오 심의 안내",
    lines: [
      "2020.06.25부터 MBC M (<쇼챔피언>, <주간아이돌> 등) 방송되는 아티스트 M/V에 한해 심의 가능.",
      "심의 영상은 온라인용으로 사용 가능합니다.",
      "심의 완료 후 등급분류 + MBC 로고 삽입본 사용 가능.",
      "파일 용량 2GB 미만.",
    ],
  },
  MNET: {
    title: "Mnet 뮤직비디오 심의 안내",
    lines: [
      "자사 편성 계획 M/V 외 등급심의가 불가합니다. 방송 일정이 있는 경우만 문의 주세요.",
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
  "border-[#7ad97a] bg-[#8fe38f] text-black",
  "border-[#f6d64a] bg-[#f6d64a] text-black",
  "border-[#4f56d8] bg-[#4f56d8] text-[#ecf2ff]",
  "border-[#e49adf] bg-[#f3a7f2] text-black",
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
}: {
  stations: StationOption[];
  userId?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isGuest = !userId;
  const isFromDraftsTab = searchParams?.get("from") === "drafts";
  const [step, setStep] = React.useState(1);
  const [mvType, setMvType] = React.useState<"MV_DISTRIBUTION" | "MV_BROADCAST">(
    "MV_DISTRIBUTION",
  );
  const [tvStations, setTvStations] = React.useState<string[]>([]);
  const [onlineOptions, setOnlineOptions] = React.useState<string[]>([]);
  const [onlineBaseSelected, setOnlineBaseSelected] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [artistName, setArtistName] = React.useState("");
  const [artistNameOfficial, setArtistNameOfficial] = React.useState("");
  const [director, setDirector] = React.useState("");
  const [leadActor, setLeadActor] = React.useState("");
  const [storyline, setStoryline] = React.useState("");
  const [productionCompany, setProductionCompany] = React.useState("");
  const [agency, setAgency] = React.useState("");
  const [albumTitle, setAlbumTitle] = React.useState("");
  const [productionDate, setProductionDate] = React.useState("");
  const [distributionCompany, setDistributionCompany] = React.useState("");
  const [businessRegNo, setBusinessRegNo] = React.useState("");
  const [usage, setUsage] = React.useState("");
  const [desiredRating, setDesiredRating] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [songTitleKr, setSongTitleKr] = React.useState("");
  const [songTitleEn, setSongTitleEn] = React.useState("");
  const [songTitleOfficial, setSongTitleOfficial] = React.useState<
    "" | "KR" | "EN"
  >("");
  const [composer, setComposer] = React.useState("");
  const [lyricist, setLyricist] = React.useState("");
  const [arranger, setArranger] = React.useState("");
  const [songMemo, setSongMemo] = React.useState("");
  const [lyrics, setLyrics] = React.useState("");
  const [releaseDate, setReleaseDate] = React.useState("");
  const [genre, setGenre] = React.useState("");
  const [runtime, setRuntime] = React.useState("");
  const [format, setFormat] = React.useState("");
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
  const [files, setFiles] = React.useState<File[]>([]);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadResult[]>([]);
  const [fileDigest, setFileDigest] = React.useState("");
  const [emailSubmitConfirmed, setEmailSubmitConfirmed] = React.useState(false);
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);
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
    } | null;
    storedGuestToken?: string | null;
  } | null>(null);
  const [isClearingResumeDrafts, setIsClearingResumeDrafts] = React.useState(false);
  const resumePromptHandledRef = React.useRef(false);
  const [isPreparingDraft, setIsPreparingDraft] = React.useState(false);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [openBroadcastSpec, setOpenBroadcastSpec] = React.useState<string | null>(
    () => broadcastSpecs[0]?.id ?? null,
  );

  const [notice, setNotice] = React.useState<SubmissionActionState>({});
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
          onlineBaseSelected: payload.onlineBaseSelected ?? false,
          emailSubmitConfirmed: payload.emailSubmitConfirmed ?? false,
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // ignore
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
      type: "MV";
      ids?: string[];
      guestToken?: string;
    } = {
      type: "MV",
    };
    if (ids.length > 0) {
      payload.ids = ids;
    }
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
      const submissionFromMsg = (payload.submissionId as string | undefined) || submissionIdRef.current;
      const guestTokenFromMsg = payload.guestToken as string | undefined;
      if (status === "SUCCESS" && submissionFromMsg) {
        window.location.href = `/dashboard/submissions/${submissionFromMsg}?payment=success`;
        return;
      }
      if (status === "FAIL" || status === "CANCEL" || status === "ERROR") {
        const message =
          typeof payload.message === "string"
            ? payload.message
            : "결제가 완료되지 않았습니다. 다시 시도해주세요.";
        setNotice({ error: message });
      }
      if (status === "SUCCESS" && !submissionFromMsg && guestTokenFromMsg) {
        window.location.href = `/track/${guestTokenFromMsg}?payment=success`;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const requireSubmissionId = React.useCallback(() => {
    if (submissionIdRef.current) return submissionIdRef.current;
    throw new Error("접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }, []);

  const createDraft = React.useCallback(async () => {
    if (isPreparingDraft || submissionIdRef.current) return;
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
        error?: string;
      };
      if (res.ok && json?.submissionId) {
        submissionIdRef.current = json.submissionId;
        return;
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
  }, [isGuest, isPreparingDraft, mvType]);

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
  const uploadHintTitle =
    mvType === "MV_DISTRIBUTION" ? "파일 포맷" : "방송국별 제출 규격";
  const uploadChips = React.useMemo(() => {
    const chips: string[] = [];

    if (mvType === "MV_DISTRIBUTION") {
      chips.push(
        "확장자: 모두 가능",
        "해상도: FHD 권장",
        "용량: 4GB 미만",
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

  const selectedStepTone = React.useMemo(() => {
    if (mvType === "MV_BROADCAST") {
      const selectedCode = tvStationCodes.find((code) =>
        tvStations.includes(code),
      );
      if (!selectedCode) return null;
      const index = tvStationCodes.indexOf(selectedCode);
      return mvOptionToneClasses[index % mvOptionToneClasses.length] ?? null;
    }

    if (onlineBaseSelected) {
      return mvOptionToneClasses[0] ?? null;
    }
    const selectedCode = onlineOptionCodes.find((code) =>
      onlineOptions.includes(code),
    );
    if (!selectedCode) return null;
    const index = onlineOptionCodes.indexOf(selectedCode);
    return mvOptionToneClasses[(index + 1) % mvOptionToneClasses.length] ?? null;
  }, [mvType, onlineBaseSelected, onlineOptions, tvStations]);

  const activeStepTone =
    selectedStepTone ?? "border-[#f6d64a] bg-[#f6d64a] text-black";

  const stepLabels = (
    <div className="grid gap-3 md:grid-cols-5">
      {steps.map((label, index) => {
        const active = index + 1 <= step;
        return (
          <div
            key={label}
            className={`rounded-2xl border px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] ${
              active
                ? activeStepTone
                : "border-border/60 bg-background text-muted-foreground"
            }`}
          >
            STEP {String(index + 1).padStart(2, "0")}
            <p className="mt-2 text-[11px] font-medium tracking-normal">
              {label}
            </p>
          </div>
        );
      })}
    </div>
  );

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    addFiles(selected);
  };

  const addFiles = (selected: File[]) => {
    if (!submissionIdRef.current) {
      setNotice({
        error:
          draftError ||
          "접수 초안을 준비하는 중입니다. 잠시 후 다시 시도하거나 다시 시도 버튼을 눌러주세요.",
      });
      void createDraft();
      return;
    }
    const allowAllExtensions = mvType === "MV_DISTRIBUTION";
    const allowedTypes = new Set([
      "video/mp4",
      "video/quicktime",
      "video/x-ms-wmv",
      "video/mpeg",
    ]);
    const allowedExtensions = [".mp4", ".mov", ".wmv", ".mpg", ".mpeg"];
    let invalidNotice: string | null = null;
    const filtered = selected.filter((file) => {
      if (file.size > uploadMaxBytes) {
        invalidNotice = `파일 용량은 ${uploadMaxLabel} 이하만 가능합니다.`;
        return false;
      }
      if (!allowAllExtensions) {
        if (file.type && !allowedTypes.has(file.type)) {
          invalidNotice = "MP4/MOV/WMV/MPG 파일만 업로드할 수 있습니다.";
          return false;
        }
        if (!file.type) {
          const lowerName = file.name.toLowerCase();
          if (!allowedExtensions.some((ext) => lowerName.endsWith(ext))) {
            invalidNotice = "MP4/MOV/WMV/MPG 파일만 업로드할 수 있습니다.";
            return false;
          }
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
      if (!parsed.uploadId || !parsed.key || !parsed.partSize) return null;
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
    let key = resumeState?.key ?? null;
    let partSize = resumeState?.partSize ?? null;

    if (!uploadId || !key || !partSize) {
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
        key?: string;
        uploadId?: string;
        partSize?: number;
        error?: string;
      };
      if (!initRes.ok || !initJson.key || !initJson.uploadId || !initJson.partSize) {
        throw new Error(initJson.error || "멀티파트 업로드를 시작할 수 없습니다.");
      }
      uploadId = initJson.uploadId;
      key = initJson.key;
      partSize = initJson.partSize;
      saveResumeState(resumeKey, {
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
      let accessUrl: string | undefined;
      let durationSeconds: number | undefined;
      try {
        const uploadResult = await uploadWithProgress(file, (progress) => {
          nextUploads[index] = {
            ...nextUploads[index],
            progress,
          };
          setUploads([...nextUploads]);
        });
        path = uploadResult.objectKey;
        accessUrl = uploadResult.accessUrl;
        durationSeconds = uploadResult.durationSeconds;
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
        console.error("[MvUpload] upload failed", error);
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
        accessUrl,
        durationSeconds,
      });
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

  const confirmEmailSubmission = React.useCallback(() => {
    const message =
      "영상 파일을 이메일로 제출하시겠습니까?\n(파일 업로드 없이 다음 단계로 이동합니다)";
    const confirmed =
      typeof window !== "undefined" ? window.confirm(message) : false;
    if (confirmed) {
      setEmailSubmitConfirmed(true);
      setNotice({});
    }
    return confirmed;
  }, []);

  const applyStoredDraft = React.useCallback((
    draft: Record<string, unknown>,
    storedSelection?: {
      mvType?: string;
      tvStations?: string[];
      onlineOptions?: string[];
      onlineBaseSelected?: boolean;
      emailSubmitConfirmed?: boolean;
    } | null,
  ) => {
    const draftType =
      draft.type === "MV_BROADCAST" ? "MV_BROADCAST" : "MV_DISTRIBUTION";
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
    setProductionDate(normalizeDateValue(draft.mv_production_date));
    setDistributionCompany(String(draft.mv_distribution_company ?? ""));
    setBusinessRegNo(String(draft.mv_business_reg_no ?? ""));
    setUsage(String(draft.mv_usage ?? ""));
    setDesiredRating(String(draft.mv_desired_rating ?? ""));
    setMemo(String(draft.mv_memo ?? ""));
    setSongTitleKr(String(draft.mv_song_title_kr ?? ""));
    setSongTitleEn(String(draft.mv_song_title_en ?? ""));
    setSongTitleOfficial(
      draft.mv_song_title_official === "KR" || draft.mv_song_title_official === "EN"
        ? draft.mv_song_title_official
        : "",
    );
    setComposer(String(draft.mv_composer ?? ""));
    setLyricist(String(draft.mv_lyricist ?? ""));
    setArranger(String(draft.mv_arranger ?? ""));
    setSongMemo(String(draft.mv_song_memo ?? ""));
    setLyrics(String(draft.mv_lyrics ?? ""));
    setReleaseDate(normalizeDateValue(draft.release_date));
    setGenre(String(draft.genre ?? ""));
    setRuntime(String(draft.mv_runtime ?? ""));
    setFormat(String(draft.mv_format ?? ""));

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
    if (draftType === "MV_BROADCAST") {
      setTvStations(Array.isArray(selection?.tvStations) ? selection!.tvStations : []);
      setOnlineOptions([]);
      setOnlineBaseSelected(false);
    } else {
      setTvStations([]);
      setOnlineOptions(Array.isArray(selection?.onlineOptions) ? selection!.onlineOptions : []);
      const baseSelected =
        typeof selection?.onlineBaseSelected === "boolean"
          ? selection.onlineBaseSelected
          : typeof draft.mv_base_selected === "boolean"
            ? draft.mv_base_selected
            : false;
      setOnlineBaseSelected(baseSelected);
    }

    const files = mapDraftFiles(
      Array.isArray(draft.files) ? (draft.files as Array<Record<string, unknown>>) : [],
    );
    setUploadedFiles(files);
    setUploads(files.length > 0 ? buildUploadsFromFiles(files) : []);
    setFiles([]);
    setFileDigest("");
    setEmailSubmitConfirmed(
      Boolean(storedSelection?.emailSubmitConfirmed) && files.length === 0,
    );

    submissionIdRef.current = String(draft.id ?? "");
    if (isGuest && typeof draft.guest_token === "string") {
      guestTokenRef.current = draft.guest_token;
    }

    setNotice({});
    setStep(2);
  }, [buildUploadsFromFiles, isGuest, mapDraftFiles, normalizeDateValue]);

  const handleResumeDraftConfirm = React.useCallback(() => {
    if (!resumePrompt) return;
    resumePromptHandledRef.current = true;
    applyStoredDraft(resumePrompt.draft, resumePrompt.stored ?? null);
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
        onlineBaseSelected: resumePrompt.stored?.onlineBaseSelected ?? false,
        emailSubmitConfirmed: resumePrompt.stored?.emailSubmitConfirmed ?? false,
      });
    }
    setResumePrompt(null);
    setResumeChecked(true);
  }, [applyStoredDraft, isGuest, resumePrompt, writeDraftStorage]);

  const handleResumeDraftCancel = React.useCallback(async () => {
    if (!resumePrompt || isClearingResumeDrafts) return;
    resumePromptHandledRef.current = true;
    setIsClearingResumeDrafts(true);
    const guestToken = resumePrompt.storedGuestToken ?? guestTokenRef.current;
    clearDraftStorage();
    try {
      await clearServerDrafts({ guestToken });
    } catch (error) {
      console.warn("[MvDraft][resume-clear] failed", error);
    } finally {
      setIsClearingResumeDrafts(false);
      setResumePrompt(null);
      setResumeChecked(true);
    }
  }, [
    clearDraftStorage,
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
      songTitleOfficial === "KR"
        ? songTitleKrValue
        : songTitleOfficial === "EN"
          ? songTitleEnValue
          : songTitleKrValue || songTitleEnValue;
    return { songTitleKrValue, songTitleEnValue, songTitleOfficialValue };
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

    if (!titleValue || !artistNameValue) {
      setNotice({ error: "제목과 아티스트명을 입력해주세요." });
      return false;
    }
    if (!artistNameOfficial.trim()) {
      setNotice({ error: "아티스트명 공식 표기를 입력해주세요." });
      return false;
    }
    if (!director.trim() || !leadActor.trim() || !storyline.trim()) {
      setNotice({ error: "감독, 주연, 줄거리 정보를 입력해주세요." });
      return false;
    }
    if (
      !productionCompany.trim() ||
      !agency.trim() ||
      !albumTitle.trim() ||
      !productionDate ||
      !distributionCompany.trim() ||
      !usage.trim()
    ) {
      setNotice({
        error:
          "제작 정보(제작사/소속사/앨범명/제작 연월일/유통사/용도)를 입력해주세요.",
      });
      return false;
    }
    if (!songTitleKrValue || !songTitleEnValue) {
      setNotice({ error: "곡명(한글/영문)을 모두 입력해주세요." });
      return false;
    }
    if (!lyrics.trim()) {
      setNotice({ error: "가사를 입력해주세요." });
      return false;
    }
    if (!songTitleOfficial) {
      setNotice({ error: "곡명의 공식 표기를 선택해주세요." });
      return false;
    }
    if (!composer.trim()) {
      setNotice({ error: "작곡자 정보를 입력해주세요." });
      return false;
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
    if (isGuest && (!guestNameValue || !guestEmailValue || !guestPhoneValue)) {
      setNotice({ error: "비회원 담당자 정보(이름/연락처/이메일)를 입력해주세요." });
      return false;
    }
    if (isGuest && guestEmailValue && !isValidEmail(guestEmailValue)) {
      setNotice({ error: "비회원 이메일 형식을 확인해주세요." });
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
    if (requirePayment && paymentMethod === "BANK" && !validatePaymentDocument()) {
      return false;
    }
    return true;
  };

  const validateMvUploads = () => {
    if (emailSubmitConfirmed) return true;
    if (uploads.length === 0) {
      setNotice({ error: "영상 파일을 업로드해주세요." });
      return false;
    }
    if (uploads.some((upload) => upload.status === "error")) {
      setNotice({ error: "업로드에 실패한 파일이 있습니다." });
      return false;
    }
    if (uploads.some((upload) => upload.status !== "done")) {
      setNotice({ error: "파일 업로드가 완료될 때까지 기다려주세요." });
      return false;
    }
    return true;
  };

  const saveMvDraft = async (options: { includeFiles: boolean }) => {
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
      return false;
    }

    setIsSaving(true);
    setNotice({});
    try {
      const uploaded = options.includeFiles ? await uploadFiles() : undefined;
      const result = await saveMvSubmissionAction({
        submissionId,
        amountKrw: totalAmount,
        selectedStationIds,
        title: titleValue || undefined,
        artistName: artistNameValue || undefined,
        director: director.trim() || undefined,
        leadActor: leadActor.trim() || undefined,
        storyline: storyline.trim() || undefined,
        productionCompany: productionCompany.trim() || undefined,
        agency: agency.trim() || undefined,
        albumTitle: albumTitle.trim() || undefined,
        productionDate: productionDate || undefined,
        distributionCompany: distributionCompany.trim() || undefined,
        businessRegNo: businessRegNo.trim() || undefined,
        usage: usage.trim() || undefined,
        desiredRating: desiredRating.trim() || undefined,
        memo: memo.trim() || undefined,
        songTitle: songTitleOfficialValue || undefined,
        songTitleKr: songTitleKrValue || undefined,
        songTitleEn: songTitleEnValue || undefined,
        songTitleOfficial: songTitleOfficial || undefined,
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
        guestToken: isGuest ? guestToken : undefined,
        guestName: isGuest ? guestNameValue || undefined : undefined,
        guestCompany: isGuest ? guestCompanyValue || undefined : undefined,
        guestEmail: isGuest ? guestEmailValue || undefined : undefined,
        guestPhone: isGuest ? guestPhoneValue || undefined : undefined,
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
        status: "DRAFT",
        files: uploaded,
      });

      if (result.error) {
        setNotice({ error: result.error });
        return false;
      }

      writeDraftStorage({
        id: submissionId,
        guestToken: isGuest ? guestTokenRef.current : null,
        mvType,
        tvStations,
        onlineOptions,
        onlineBaseSelected,
        emailSubmitConfirmed,
      });
      setNotice({ submissionId: result.submissionId });
      return true;
    } catch {
      setNotice({ error: "저장 중 오류가 발생했습니다." });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!validateMvForm({ requirePayment: true })) return;
    if (!validateMvUploads()) return;

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

    setIsSaving(true);
    setNotice({});
    try {
      const uploaded = uploads.length > 0 ? await uploadFiles() : [];
      const result = await saveMvSubmissionAction({
        submissionId,
        amountKrw: totalAmount,
        selectedStationIds,
        title: titleValue || undefined,
        artistName: artistNameValue || undefined,
        director: director.trim() || undefined,
        leadActor: leadActor.trim() || undefined,
        storyline: storyline.trim() || undefined,
        productionCompany: productionCompany.trim() || undefined,
        agency: agency.trim() || undefined,
        albumTitle: albumTitle.trim() || undefined,
        productionDate: productionDate || undefined,
        distributionCompany: distributionCompany.trim() || undefined,
        businessRegNo: businessRegNo.trim() || undefined,
        usage: usage.trim() || undefined,
        desiredRating: desiredRating.trim() || undefined,
        memo: memo.trim() || undefined,
        songTitle: songTitleOfficialValue || undefined,
        songTitleKr: songTitleKrValue || undefined,
        songTitleEn: songTitleEnValue || undefined,
        songTitleOfficial: songTitleOfficial || undefined,
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
        guestToken: isGuest ? guestToken : undefined,
        guestName: isGuest ? guestNameValue || undefined : undefined,
        guestCompany: isGuest ? guestCompanyValue || undefined : undefined,
        guestEmail: isGuest ? guestEmailValue || undefined : undefined,
        guestPhone: isGuest ? guestPhoneValue || undefined : undefined,
        paymentMethod,
        bankDepositorName:
          paymentMethod === "BANK" ? bankDepositorName.trim() : undefined,
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
        status: "SUBMITTED",
        files: uploaded,
      });

      if (result.error) {
        setNotice({ error: result.error });
        return;
      }

      if (result.submissionId) {
        clearDraftStorage();
        if (paymentMethod === "CARD") {
          const { ok, error } = openInicisCardPopup({
            context: "mv",
            submissionId: result.submissionId,
            guestToken: result.guestToken ?? (isGuest ? guestToken : undefined),
          });
          if (!ok) {
            setNotice({
              error:
                error ||
                "결제 팝업을 열지 못했습니다. 팝업 차단을 해제한 뒤 다시 시도해주세요.",
            });
          }
          return;
        }
        if (paymentMethod === "BANK") {
          if (typeof window !== "undefined") {
            window.alert("심의 접수가 완료되었습니다.");
            if (result.emailWarning) {
              window.alert(result.emailWarning);
            }
          }
          setCompletionId(result.submissionId);
          if (result.guestToken) {
            setCompletionGuestToken(result.guestToken);
          } else if (isGuest) {
            setCompletionGuestToken(guestToken);
          }
          setStep(5);
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
    } finally {
      setIsSaving(false);
    }
  };

  const handleStep2Next = async () => {
    if (!validateMvForm()) return;
    const saved = await saveMvDraft({ includeFiles: false });
    if (saved) {
      setStep(3);
    }
  };

  const handleStep3Next = async () => {
    if (!validateMvUploads()) return;
    const uploadsReady =
      uploads.length > 0 && uploads.every((upload) => upload.status === "done");
    const saved = await saveMvDraft({ includeFiles: uploadsReady });
    if (saved) {
      setStep(4);
    }
  };

  const canProceed =
    mvType === "MV_BROADCAST"
      ? tvStations.length > 0
      : onlineBaseSelected || onlineOptions.length > 0;

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
        label={step <= 2 ? "신청서 저장" : "심의 저장/결제 처리 중..."}
      />

      {isDraggingOver && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]" />
      )}
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
      {confirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={handleCancelOnlineOption}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-xl rounded-[28px] border border-border/60 bg-background p-6 text-foreground shadow-xl"
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
                <li key={line} className="list-disc pl-5 leading-relaxed">
                  {line}
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

      {step === 1 && (
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 01
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                M/V 심의 목적을 선택하세요.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                TV 송출용 심의와 유통/온라인 업로드 목적 심의를 구분합니다.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                value: "MV_DISTRIBUTION",
                label: "유통사 제출 & 온라인 업로드",
                description: "온라인 유통을 위한 일반 MV 심의입니다.",
              },
              {
                value: "MV_BROADCAST",
                label: "TV 송출 목적의 심의",
                description:
                  "방송국별로 개별 심의를 진행해야하며, 음원 심의가 완료된 앨범의 뮤비에 한하여 심의가 가능합니다.",
              },
            ].map((item) => {
              const active = mvType === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() =>
                    setMvType(item.value as "MV_DISTRIBUTION" | "MV_BROADCAST")
                  }
                  className={`text-left rounded-[28px] border p-6 transition ${
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border/60 bg-card/80 text-foreground hover:border-foreground"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] opacity-70">
                    MV Purpose
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">{item.label}</h3>
                  <p className="mt-2 text-xs opacity-70">{item.description}</p>
                </button>
              );
            })}
          </div>

          {mvType === "MV_BROADCAST" ? (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                TV 송출 목적의 심의
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                방송국별 개별 심의가 필요하며, 선택한 방송국만 접수됩니다.
              </p>
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
                      className={`text-left rounded-2xl border p-4 transition ${
                        active
                          ? tone
                          : "border-border/60 bg-background text-foreground hover:border-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">
                          {details?.title ?? `${stationName} 심의`}
                        </p>
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
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                유통사 제출 & 온라인 업로드
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                기본 MV 심의 + 방송국 입고 옵션을 선택할 수 있습니다.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setOnlineBaseSelected((prev) => !prev)}
                  className={`text-left rounded-2xl border p-4 transition ${
                    onlineBaseSelected
                      ? mvOptionToneClasses[0]
                      : "border-border/60 bg-background text-foreground hover:border-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">일반 뮤직비디오 심의</p>
                    <span className="text-xs font-semibold">
                      {formatCurrency(baseOnlinePrice)}원
                    </span>
                  </div>
                  <p className="mt-2 text-xs opacity-80">
                    심의 완료 후 등급분류를 영상에 삽입하면 Melon, 지니,
                    유튜브 등으로 온라인 유통이 가능합니다.
                  </p>
                </button>
                {onlineOptionCodes.map((code, index) => {
                  const active = onlineOptions.includes(code);
                  const stationName = stationMap.get(code)?.name ?? code;
                  const details = onlineOptionDetails[code];
                  const tone =
                    mvOptionToneClasses[(index + 1) % mvOptionToneClasses.length];
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleOnlineOption(code)}
                      className={`text-left rounded-2xl border p-4 transition ${
                        active
                          ? tone
                          : "border-border/60 bg-background text-foreground hover:border-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">
                          {details?.title ?? `${stationName} 입고 옵션`}
                        </p>
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
            <p className="mt-2 text-xs text-muted-foreground text-right">
              무통장 입금 또는 카드 결제 모두 가능합니다.
            </p>
            <p className="mt-1 text-xs text-muted-foreground text-right">
              비회원 결제 가능
            </p>
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
        <div className="space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 02
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                M/V 신청서 정보를 입력하세요.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                제목/러닝타임/포맷 등 기본 정보를 입력합니다.
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              MV 기본 정보
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  MV 제목 *
                </label>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  아티스트명 (한글/영문) *
                </label>
                <input
                  value={artistName}
                  onChange={(event) => setArtistName(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
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
                  value={artistNameOfficial}
                  onChange={(event) => setArtistNameOfficial(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
                <p className="text-[11px] text-muted-foreground whitespace-pre-line">
                  실제 음원사이트 표기법을 적용한 공식 표기를 적어주세요.
                  {"\n"}예) SOLE (쏠), 윤하 (YOUNHA), Bakehour, 김장훈
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  영상 공개일자
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
                  value={director}
                  onChange={(event) => setDirector(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  주연 *
                </label>
                <input
                  value={leadActor}
                  onChange={(event) => setLeadActor(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
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
                  value={productionCompany}
                  onChange={(event) => setProductionCompany(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  소속사 *
                </label>
                <input
                  value={agency}
                  onChange={(event) => setAgency(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  앨범명 *
                </label>
                <input
                  value={albumTitle}
                  onChange={(event) => setAlbumTitle(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  제작 연월일 *
                </label>
                <input
                  type="date"
                  value={productionDate}
                  onChange={(event) => setProductionDate(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  유통사 *
                </label>
                <input
                  value={distributionCompany}
                  onChange={(event) =>
                    setDistributionCompany(event.target.value)
                  }
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  사업자등록번호 (선택)
                </label>
                <input
                  value={businessRegNo}
                  onChange={(event) => setBusinessRegNo(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  용도 *
                </label>
                <input
                  placeholder="예: 음악사이트 기재"
                  value={usage}
                  onChange={(event) => setUsage(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
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
                  value={songTitleKr}
                  onChange={(event) => setSongTitleKr(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  곡명 (영문) *
                </label>
                <input
                  value={songTitleEn}
                  onChange={(event) => setSongTitleEn(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  공식 표기 *
                </p>
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={songTitleOfficial === "KR"}
                      onChange={() => setSongTitleOfficial("KR")}
                      className="h-4 w-4 rounded-full border-border"
                    />
                    한글
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={songTitleOfficial === "EN"}
                      onChange={() => setSongTitleOfficial("EN")}
                      className="h-4 w-4 rounded-full border-border"
                    />
                    영문
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  작곡자 *
                </label>
                <input
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
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
                  메모 (장르) (선택)
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
              value={storyline}
              onChange={(event) => setStoryline(event.target.value)}
              className="mt-4 h-32 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              줄거리는 결말까지 작성하셔야 합니다.
            </p>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              가사 *
            </p>
            <textarea
              value={lyrics}
              onChange={(event) => setLyrics(event.target.value)}
              className="mt-4 h-32 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            />
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
                    value={guestName}
                    onChange={(event) => setGuestName(event.target.value)}
                    required
                    className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
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
                    type="email"
                    value={guestEmail}
                    onChange={(event) => setGuestEmail(event.target.value)}
                    required
                    className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    연락처 *
                  </label>
                  <input
                    value={guestPhone}
                    onChange={(event) => setGuestPhone(event.target.value)}
                    required
                    className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
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
              onClick={() => setStep(1)}
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
        </div>
      )}

      {step === 3 && (
        <div className="space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 03
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                파일 업로드
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                방송국 심의 규격에 맞는 파일을 업로드해주세요.
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              MV 파일 업로드
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {uploadHintTitle}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {mvType === "MV_BROADCAST"
                ? `시스템 업로드 한도: 최대 ${uploadMaxLabel}까지 업로드할 수 있습니다.`
                : `최대 ${uploadMaxLabel}까지 업로드할 수 있습니다.`}
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
                onDrop={onDropFiles}
              >
                <span className="sr-only">파일 첨부</span>
                <input
                  type="file"
                  multiple
                  accept={
                    mvType === "MV_DISTRIBUTION"
                      ? undefined
                      : ".mp4,.mov,.wmv,.mpg,.mpeg,video/*"
                  }
                  onChange={onFileChange}
                  className="hidden"
                />
                <span className="flex w-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-6 text-sm font-semibold text-foreground transition hover:border-foreground">
                  파일 첨부 (드래그 앤 드롭 가능)
                </span>
                {isDraggingOver && (
                  <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-[#f6d64a] bg-black/10 backdrop-blur-[1px]" />
                )}
              </label>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              파일 첨부가 실패하는 경우 이메일로 영상 파일만 보내주세요.
              <br />
              onside17@daum.net
            </p>
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
              {paymentItems.length > 0 ? (
                paymentItems.map((item) => (
                  <div
                    key={`${item.title}-${item.amount}`}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="font-semibold">{item.title}</span>
                    <span className="text-sm font-semibold">
                      {formatCurrency(item.amount)}원
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  선택된 옵션이 없습니다.
                </p>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm font-semibold text-foreground">
              <span>총 결제 금액</span>
              <span>{formatCurrency(totalAmount)}원</span>
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
                  KG이니시스 카드 결제 · 결제 팝업에서 즉시 진행
                </p>
              </button>
            </div>
          </div>

          {paymentMethod === "BANK" ? (
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
                      name="mv-payment-document"
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
                      name="mv-payment-document"
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
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
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
          ) : (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm text-muted-foreground">
              카드 결제 선택 시 결제 팝업(이니시스 STDPay)이 열립니다. 팝업이
              차단된 경우 해제 후 다시 시도해주세요. 테스트용/실결제 카드 모두
              지원합니다.
            </div>
          )}

          {notice.error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600">
              {notice.error}
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
              onClick={handleSubmit}
              disabled={isSaving}
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
          {shouldShowGuestLookup && (
            <div className="mt-6 space-y-3">
              <p className="text-xs text-muted-foreground">
                조회 코드:{" "}
                <span className="font-semibold text-foreground">
                  {guestLookupCode}
                </span>
              </p>
              <button
                type="button"
                onClick={() => router.push(`/track/${guestLookupCode}`)}
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
