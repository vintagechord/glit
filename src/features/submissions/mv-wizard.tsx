"use client";

import Script from "next/script";
import * as React from "react";
import { useRouter } from "next/navigation";

import { PendingOverlay } from "@/components/ui/pending-overlay";
import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";

import {
  saveMvSubmissionAction,
  type SubmissionActionState,
} from "./actions";

type StdPayInitResponse = {
  orderId?: string;
  stdJsUrl?: string;
  stdParams?: Record<string, string>;
  error?: string;
};

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
};

const steps = ["목적 선택", "신청서/파일 업로드", "결제하기", "접수 완료"];

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
const baseOnlinePrice = 30000;
const stationPriceMap: Record<string, number> = {
  KBS: 30000,
  MBC: 30000,
  SBS: 30000,
  ETN: 15000,
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
  "border-[#7ad97a] bg-[#8fe38f] text-slate-900",
  "border-[#d8d654] bg-[#e6e35b] text-slate-900",
  "border-[#4f56d8] bg-[#5f67f2] text-slate-900",
  "border-[#e49adf] bg-[#f3a7f2] text-slate-900",
];

export function MvWizard({
  stations,
  userId,
}: {
  stations: StationOption[];
  userId?: string | null;
}) {
  const router = useRouter();
  const isGuest = !userId;
  const [step, setStep] = React.useState(1);
  const [mvType, setMvType] = React.useState<"MV_DISTRIBUTION" | "MV_BROADCAST">(
    "MV_DISTRIBUTION",
  );
  const [tvStations, setTvStations] = React.useState<string[]>([]);
  const [onlineOptions, setOnlineOptions] = React.useState<string[]>([]);
  const [onlineBaseSelected, setOnlineBaseSelected] = React.useState(true);
  const [title, setTitle] = React.useState("");
  const [artistName, setArtistName] = React.useState("");
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
  const [files, setFiles] = React.useState<File[]>([]);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadResult[]>([]);
  const [fileDigest, setFileDigest] = React.useState("");
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [payData, setPayData] = React.useState<{
    orderId: string;
    stdParams: Record<string, string>;
    stdJsUrl: string;
  } | null>(null);

  const logStdPayParams = React.useCallback(
    (params: Record<string, string>, stdJsUrl: string) => {
      const len = (key: keyof typeof params) => String(params[key] ?? "").length;
      const mask = (value?: string) =>
        value ? `${value.slice(0, 2)}***${value.slice(-2)}` : "";
      console.info("[Inicis][STDPay][params-check]", {
        mid: { masked: mask(params.mid), length: len("mid") },
        oid: { present: Boolean(params.oid), length: len("oid") },
        price: { present: Boolean(params.price), length: len("price") },
        timestamp: { present: Boolean(params.timestamp), length: len("timestamp") },
        returnUrl: { present: Boolean(params.returnUrl), length: len("returnUrl") },
        closeUrl: { present: Boolean(params.closeUrl), length: len("closeUrl") },
        signature: { present: Boolean(params.signature), length: len("signature") },
        mKey: { present: Boolean(params.mKey), length: len("mKey") },
        iniStdPay: Boolean(typeof window !== "undefined" && window.INIStdPay),
        stdJsUrl,
      });
    },
    [],
  );

  const ensureStdPayReady = React.useCallback(async (stdJsUrl: string) => {
    if (typeof window === "undefined") return false;
    if (window.INIStdPay) return true;
    let script = document.querySelector(`script[src="${stdJsUrl}"]`) as
      | HTMLScriptElement
      | null;
    if (!script) {
      script = document.createElement("script");
      script.src = stdJsUrl;
      script.type = "text/javascript";
      script.async = true;
      document.body.appendChild(script);
    }
    return new Promise<boolean>((resolve) => {
      const onReady = () => cleanup(Boolean(window.INIStdPay));
      const onError = () => cleanup(false);
      const cleanup = (value: boolean) => {
        script?.removeEventListener("load", onReady);
        script?.removeEventListener("error", onError);
        window.clearTimeout(timeout);
        window.clearTimeout(poll);
        resolve(value);
      };
      const timeout = window.setTimeout(() => cleanup(Boolean(window.INIStdPay)), 2000);
      const poll = window.setInterval(() => {
        if (window.INIStdPay) {
          cleanup(true);
        }
      }, 200);
      script?.addEventListener("load", onReady);
      script?.addEventListener("error", onError);
    });
  }, []);

  React.useEffect(() => {
    if (!payData || process.env.NODE_ENV === "production") return;
    const timer = window.setTimeout(() => {
      const loaded = typeof window !== "undefined" && !!window.INIStdPay;
      console.info("[Inicis][STDPay] INIStdPay.js loaded?", loaded, payData.stdJsUrl);
      if (!loaded) {
        console.warn("[Inicis][STDPay] INIStdPay.js not available. Check script src or CSP.");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [payData]);
  const payFormId = React.useRef(
    `inicis-subpay-${Math.random().toString(36).slice(2)}`,
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

  React.useEffect(() => {
    if (!payData) return;
    let cancelled = false;
    const launch = async () => {
      const ready = await ensureStdPayReady(payData.stdJsUrl);
      if (cancelled) return;
      logStdPayParams(payData.stdParams, payData.stdJsUrl);
      const formId = payFormId.current;
      if (!ready || typeof window === "undefined" || !window.INIStdPay) {
        console.warn("[Inicis][STDPay] INIStdPay.js not ready. Check script src or CSP.");
        return;
      }
      window.INIStdPay.pay(formId);
    };
    launch();
    return () => {
      cancelled = true;
    };
  }, [ensureStdPayReady, logStdPayParams, payData]);

  if (!submissionIdRef.current) {
    submissionIdRef.current = crypto.randomUUID();
  }
  if (!guestTokenRef.current) {
    guestTokenRef.current = crypto.randomUUID();
  }

  const submissionId = submissionIdRef.current;
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

    if (tvStations.includes("KBS")) {
      chips.push(
        "KBS: 용량 1.5GB 이하",
        "KBS: 1분 30초 편집본 제출",
        "KBS: MOV",
        "KBS: Apple ProRes (ProRes LT / 422)",
      );
    }
    if (tvStations.includes("MBC")) {
      chips.push(
        "MBC: MOV",
        "MBC: 해상도 1920x1080",
        "MBC: 프레임 29.97",
        "MBC: 4GB 이하",
      );
    }
    if (tvStations.includes("SBS")) {
      chips.push(
        "SBS: MOV / MP4 / WMV",
        "SBS: 해상도 1920x1080",
        "SBS: 프레임 29.97",
      );
    }

    return chips;
  }, [mvType, onlineOptions, tvStations]);

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
    selectedStepTone ?? "border-amber-200 bg-amber-200 text-slate-900";

  const stepLabels = (
    <div className="grid gap-3 md:grid-cols-4">
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
    const allowAllExtensions = mvType === "MV_DISTRIBUTION";
    const allowedTypes = new Set([
      "video/mp4",
      "video/quicktime",
      "video/x-ms-wmv",
      "video/mpeg",
    ]);
    const allowedExtensions = [".mp4", ".mov", ".wmv", ".mpg", ".mpeg"];
    const filtered = selected.filter((file) => {
      if (file.size > uploadMaxBytes) {
        setNotice({ error: `파일 용량은 ${uploadMaxLabel} 이하만 가능합니다.` });
        return false;
      }
      if (!allowAllExtensions) {
        if (file.type && !allowedTypes.has(file.type)) {
          setNotice({
            error: "MP4/MOV/WMV/MPG 파일만 업로드할 수 있습니다.",
          });
          return false;
        }
        if (!file.type) {
          const lowerName = file.name.toLowerCase();
          if (!allowedExtensions.some((ext) => lowerName.endsWith(ext))) {
            setNotice({
              error: "MP4/MOV/WMV/MPG 파일만 업로드할 수 있습니다.",
            });
            return false;
          }
        }
      }
      return true;
    });
    const combinedFiles = [...files, ...filtered];
    const existingMap = new Map<string, UploadItem>();
    uploads.forEach((item) => {
      existingMap.set(`${item.name}-${item.size}`, item);
    });
    const nextUploads = combinedFiles.map((file) => {
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
    setFiles(combinedFiles);
    setUploads(nextUploads);
    if (filtered.length > 0) {
      void uploadFiles(combinedFiles, nextUploads).catch(() => {
        setNotice({ error: "파일 업로드 중 오류가 발생했습니다." });
      });
    }
  };

  const onDropFiles = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length === 0) return;
    setIsDraggingOver(false);
    addFiles(dropped);
  };

  const uploadWithProgress = async (
    signedUrl: string,
    file: File,
    onProgress: (percent: number) => void,
  ) => {
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
          reject(new Error("Upload failed"));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.open("PUT", signedUrl);
      if (file.type) {
        xhr.setRequestHeader("Content-Type", file.type);
      }
      xhr.send(file);
    });
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

  const createSignedUpload = async (file: File) => {
    const response = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        guestToken: isGuest ? guestToken : undefined,
        title,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof payload?.error === "string"
          ? payload.error
          : "업로드 URL을 생성할 수 없습니다.",
      );
    }

    return payload as { uploadUrl: string; objectKey: string };
  };

  const uploadFiles = async (
    targetFiles: File[] = files,
    initialUploads: UploadItem[] = uploads,
  ) => {
    if (targetFiles.length === 0) return [];

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

      let signedUrl: string;
      let path: string;
      try {
        const uploadData = await createSignedUpload(file);
        signedUrl = uploadData.uploadUrl;
        path = uploadData.objectKey;
      } catch (error) {
        nextUploads[index] = {
          ...nextUploads[index],
          status: "error",
        };
        setUploads([...nextUploads]);
        const message =
          error instanceof Error && error.message
            ? error.message
            : "업로드 URL 생성 실패";
        setNotice({ error: message });
        throw new Error(message);
      }

      await uploadWithProgress(signedUrl, file, (progress) => {
        nextUploads[index] = {
          ...nextUploads[index],
          progress,
        };
        setUploads([...nextUploads]);
      });

      await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectKey: path,
          submissionId,
          sizeBytes: file.size,
          mimeType: file.type,
        }),
      }).catch(() => null);

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

  const handleSave = async (status: "DRAFT" | "SUBMITTED") => {
    const songTitleKrValue = songTitleKr.trim();
    const songTitleEnValue = songTitleEn.trim();
    const songTitleOfficialValue =
      songTitleOfficial === "KR"
        ? songTitleKrValue
        : songTitleOfficial === "EN"
          ? songTitleEnValue
          : songTitleKrValue || songTitleEnValue;

    if (!title || !artistName) {
      setNotice({ error: "제목과 아티스트명을 입력해주세요." });
      return;
    }
    if (
      status === "SUBMITTED" &&
      (!director.trim() || !leadActor.trim() || !storyline.trim())
    ) {
      setNotice({ error: "감독, 주연, 줄거리 정보를 입력해주세요." });
      return;
    }
    if (
      status === "SUBMITTED" &&
      (!productionCompany.trim() ||
        !agency.trim() ||
        !albumTitle.trim() ||
        !productionDate ||
        !distributionCompany.trim() ||
        !usage.trim())
    ) {
      setNotice({
        error:
          "제작 정보(제작사/소속사/앨범명/제작 연월일/유통사/용도)를 입력해주세요.",
      });
      return;
    }
    if (
      status === "SUBMITTED" &&
      (!songTitleKrValue || !songTitleEnValue)
    ) {
      setNotice({ error: "곡명(한글/영문)을 모두 입력해주세요." });
      return;
    }
    if (status === "SUBMITTED" && !songTitleOfficial) {
      setNotice({ error: "곡명의 공식 표기를 선택해주세요." });
      return;
    }
    if (status === "SUBMITTED" && !composer.trim()) {
      setNotice({ error: "작곡자 정보를 입력해주세요." });
      return;
    }
    if (mvType === "MV_BROADCAST" && tvStations.length === 0) {
      setNotice({ error: "TV 송출 심의를 원하는 방송국을 선택해주세요." });
      return;
    }
    if (
      mvType === "MV_DISTRIBUTION" &&
      !onlineBaseSelected &&
      onlineOptions.length === 0
    ) {
      setNotice({ error: "온라인 심의 옵션을 선택해주세요." });
      return;
    }
    if (isGuest && (!guestName || !guestEmail || !guestPhone)) {
      setNotice({ error: "비회원 담당자 정보(이름/연락처/이메일)를 입력해주세요." });
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

    setIsSaving(true);
    setNotice({});
    try {
      const uploaded = await uploadFiles();
      const result = await saveMvSubmissionAction({
        submissionId,
        amountKrw: totalAmount,
        selectedStationIds,
        title,
        artistName,
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
        releaseDate: releaseDate || undefined,
        genre: genre || undefined,
        mvType,
        runtime: runtime || undefined,
        format: format || undefined,
        mvBaseSelected:
          mvType === "MV_DISTRIBUTION" ? onlineBaseSelected : false,
        guestToken: isGuest ? guestToken : undefined,
        guestName: isGuest ? guestName : undefined,
        guestCompany: isGuest ? guestCompany : undefined,
        guestEmail: isGuest ? guestEmail : undefined,
        guestPhone: isGuest ? guestPhone : undefined,
        paymentMethod,
        bankDepositorName:
          status === "SUBMITTED" ? bankDepositorName.trim() : undefined,
        status,
        files: uploaded,
      });

      if (result.error) {
        setNotice({ error: result.error });
        return;
      }

      if (status === "SUBMITTED" && result.submissionId) {
        if (paymentMethod === "CARD") {
          try {
            const response = await fetch("/api/inicis/submission/order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                submissionId: result.submissionId,
                guestToken: result.guestToken ?? (isGuest ? guestToken : undefined),
              }),
            });
            let json: StdPayInitResponse | null = null;
            let raw: string | null = null;
            try {
              raw = await response.text();
              json = raw ? (JSON.parse(raw) as StdPayInitResponse) : null;
            } catch (parseError) {
              console.error("[Inicis][STDPay][init][client] parse error", parseError, {
                status: response.status,
                body: raw,
              });
            }
            if (!response.ok || json?.error) {
              console.error("[Inicis][STDPay][init][client]", {
                status: response.status,
                error: json?.error,
                body: raw,
              });
              setNotice({
                error:
                  json?.error ||
                  "카드 결제 요청에 실패했습니다. 관리자에게 문의해주세요.",
              });
              return;
            }
            if (!json) {
              setNotice({
                error: "결제 초기화 응답을 해석하지 못했습니다. 잠시 후 다시 시도해주세요.",
              });
              return;
            }
            if (!json.orderId || !json.stdJsUrl || !json.stdParams) {
              setNotice({
                error: "결제 초기화 응답이 올바르지 않습니다. 관리자에게 문의해주세요.",
              });
              return;
            }
            const normalizedPayData = {
              orderId: json.orderId,
              stdJsUrl: json.stdJsUrl,
              stdParams: json.stdParams,
            };
            setPayData(normalizedPayData);
            console.info("[Inicis][STDPay][init][client] order created", {
              orderId: json.orderId,
              stdJsUrl: json.stdJsUrl,
              keys: Object.keys(json.stdParams ?? {}),
            });
            return;
          } catch (error) {
            console.error("[Inicis][STDPay][init][client] exception", error);
            setNotice({ error: "카드 결제 초기화 중 오류가 발생했습니다." });
            return;
          }
        } else if (paymentMethod === "BANK") {
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
          setStep(4);
          return;
        } else {
          console.warn("[Inicis][STDPay][init][client] unknown payment method", paymentMethod);
          setNotice({ error: "지원하지 않는 결제 수단입니다." });
          return;
        }
      }

      if (result.emailWarning && typeof window !== "undefined") {
        window.alert(result.emailWarning);
      }

      setNotice({ submissionId: result.submissionId });
    } catch {
      setNotice({ error: "저장 중 오류가 발생했습니다." });
    } finally {
      setIsSaving(false);
    }
  };

  const canProceed =
    mvType === "MV_BROADCAST"
      ? tvStations.length > 0
      : onlineBaseSelected || onlineOptions.length > 0;

  return (
    <div className="space-y-8 text-[15px] leading-relaxed sm:text-base [&_input]:text-base [&_textarea]:text-base [&_select]:text-base [&_label]:text-sm">
      <PendingOverlay
        show={isSaving}
        label="심의 저장/결제 처리 중..."
      />
      {payData ? (
        <>
          <Script src={payData.stdJsUrl} strategy="afterInteractive" />
          <form id={payFormId.current} method="POST" acceptCharset="UTF-8" className="hidden">
            {Object.entries(payData.stdParams).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
          </form>
        </>
      ) : null}

      {isDraggingOver && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]" />
      )}
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
                className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900"
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
                description: "방송국별로 개별 심의가 필요합니다.",
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
              카드 결제 또는 무통장 입금 모두 가능합니다.
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
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-muted"
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
                M/V 파일 및 신청서 정보를 입력하세요.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                제목/러닝타임/포맷을 입력하고 영상 파일을 업로드합니다.
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
              가사
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
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    담당자명
                  </label>
                  <input
                    value={guestName}
                    onChange={(event) => setGuestName(event.target.value)}
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
                    이메일
                  </label>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(event) => setGuestEmail(event.target.value)}
                    className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    연락처
                  </label>
                  <input
                    value={guestPhone}
                    onChange={(event) => setGuestPhone(event.target.value)}
                    className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              MV 파일 업로드
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {uploadHintTitle}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              최대 {uploadMaxLabel}까지 업로드할 수 있습니다.
            </p>
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
                  <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-amber-300 bg-black/10 backdrop-blur-[1px]" />
                )}
              </label>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              파일 첨부가 실패하는 경우 이메일로 영상 파일만 보내주세요.
              <br />
              help@vhouse.co.kr
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
                      <span className="text-muted-foreground">
                        {upload.status === "done"
                          ? "첨부 완료"
                          : upload.status === "uploading"
                            ? `업로드 중 · ${upload.progress}%`
                            : upload.status === "error"
                              ? "실패"
                              : "대기"}
                      </span>
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
                  아직 선택된 파일이 없습니다.
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
              onClick={() => setStep(1)}
              disabled={isSaving}
              className="rounded-full border border-border/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-amber-200 hover:text-slate-900 dark:hover:text-white disabled:cursor-not-allowed"
            >
              이전 단계
            </button>
            {!isGuest && (
              <button
                type="button"
                onClick={() => handleSave("DRAFT")}
                disabled={isSaving}
                className="rounded-full border border-border/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground disabled:cursor-not-allowed"
              >
                임시 저장
              </button>
            )}
            <button
              type="button"
              onClick={() => setStep(3)}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900"
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
                결제하기
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                카드 결제 또는 무통장 입금을 선택할 수 있습니다.
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
                  KG모빌리언스 연동 예정 · 접수 후 결제 링크 안내
                </p>
              </button>
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
            </div>
          ) : (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm text-muted-foreground">
              카드 결제는 KG모빌리언스 연동 후 자동화 예정입니다. 현재는 접수
              완료 후 담당자가 결제 링크를 안내드립니다.
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
              onClick={() => setStep(2)}
              className="rounded-full border border-border/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-amber-200 hover:text-slate-900 dark:hover:text-white"
            >
              이전 단계
            </button>
            <button
              type="button"
              onClick={() => handleSave("SUBMITTED")}
              disabled={isSaving}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-muted"
            >
              결제하기
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="rounded-[32px] border border-border/60 bg-card/80 p-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            STEP 04
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
