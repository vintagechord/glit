"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

import {
  saveAlbumSubmissionAction,
  type SubmissionActionState,
} from "./actions";

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
  trackTitleKr: string;
  trackTitleEn: string;
  trackTitleOfficial: "" | "KR" | "EN";
  featuring: string;
  composer: string;
  lyricist: string;
  arranger: string;
  lyrics: string;
  notes: string;
  isTitle: boolean;
  titleRole: "" | "MAIN" | "SUB";
  broadcastSelected: boolean;
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

type DraftSnapshot = {
  draft: AlbumDraft;
  emailSubmitConfirmed: boolean;
};

const initialTrack: TrackInput = {
  trackTitleKr: "",
  trackTitleEn: "",
  trackTitleOfficial: "",
  featuring: "",
  composer: "",
  lyricist: "",
  arranger: "",
  lyrics: "",
  notes: "",
  isTitle: false,
  titleRole: "",
  broadcastSelected: false,
};

const steps = [
  "패키지 선택",
  "신청서/파일 업로드",
  "결제하기",
  "접수 완료",
];

const packageToneClasses = [
  {
    card: "border-[#7ad97a] bg-[#8fe38f] text-slate-900",
    chip: "border-black/30 text-slate-900",
  },
  {
    card: "border-[#d8d654] bg-[#e6e35b] text-slate-900",
    chip: "border-black/30 text-slate-900",
  },
  {
    card: "border-[#4f56d8] bg-[#5f67f2] text-slate-900",
    chip: "border-black/30 text-slate-900",
  },
  {
    card: "border-[#e49adf] bg-[#f3a7f2] text-slate-900",
    chip: "border-black/30 text-slate-900",
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
];

const broadcastRequirementMessage =
  "타이틀곡 지정해 주시고 4곡 이상의 앨범일 경우 원음방송 심의를 위해 3곡 지정 해주세요. (원음방송은 앨범당 3곡만 심의가 가능합니다.)";

const oneClickPriceMap: Record<number, number> = {
  7: 100000,
  10: 130000,
  11: 130000,
  13: 160000,
  15: 180000,
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
};

export function AlbumWizard({
  packages,
  userId,
}: {
  packages: PackageOption[];
  userId?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = React.useMemo(() => createClient(), []);
  const isGuest = !userId;
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
  const [files, setFiles] = React.useState<File[]>([]);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadResult[]>([]);
  const [fileDigest, setFileDigest] = React.useState("");
  const [emailSubmitConfirmed, setEmailSubmitConfirmed] = React.useState(false);
  const [showCdInfo, setShowCdInfo] = React.useState(false);
  const [showOneclickNotice, setShowOneclickNotice] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isAddingAlbum, setIsAddingAlbum] = React.useState(false);
  const [notice, setNotice] = React.useState<SubmissionActionState>({});
  const [completionId, setCompletionId] = React.useState<string | null>(null);
  const [completionTokens, setCompletionTokens] = React.useState<string[]>([]);
  const [completionSubmissionIds, setCompletionSubmissionIds] = React.useState<
    string[]
  >([]);
  const [albumDrafts, setAlbumDrafts] = React.useState<AlbumDraft[]>([]);
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [baseDraftSnapshot, setBaseDraftSnapshot] =
    React.useState<DraftSnapshot | null>(null);
  const [currentSubmissionId, setCurrentSubmissionId] = React.useState(() =>
    crypto.randomUUID(),
  );
  const [currentGuestToken, setCurrentGuestToken] = React.useState(() =>
    crypto.randomUUID(),
  );
  const activeTrack = tracks[activeTrackIndex] ?? tracks[0];
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
  const shouldShowGuestLookup = isGuest || completionTokens.length > 0;
  const completionCodesToShow = shouldShowGuestLookup
    ? completionTokens.length > 0
      ? completionTokens
      : completionSubmissionIds.length > 0
        ? completionSubmissionIds
        : [currentGuestToken]
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

  const stepLabels = (
    <div className="grid gap-3 md:grid-cols-4">
      {steps.map((label, index) => {
        const active = index + 1 <= step;
        return (
          <div
            key={label}
            className={`rounded-2xl border px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] ${
              active
                ? "border-amber-200 bg-amber-200 text-slate-900"
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

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const allowedTypes = new Set([
      "audio/wav",
      "audio/x-wav",
      "application/zip",
      "application/x-zip-compressed",
    ]);
    const filtered = selected.filter((file) => {
      if (file.size > uploadMaxBytes) {
        setNotice({ error: `파일 용량은 ${uploadMaxLabel} 이하만 가능합니다.` });
        return false;
      }
      if (file.type && !allowedTypes.has(file.type)) {
        setNotice({ error: "WAV 또는 ZIP 파일만 업로드할 수 있습니다." });
        return false;
      }
      if (!file.type) {
        const lowerName = file.name.toLowerCase();
        if (!lowerName.endsWith(".wav") && !lowerName.endsWith(".zip")) {
          setNotice({ error: "WAV 또는 ZIP 파일만 업로드할 수 있습니다." });
          return false;
        }
      }
      return true;
    });
    const nextUploads = filtered.map((file) => ({
      name: file.name,
      size: file.size,
      progress: 0,
      status: "pending" as const,
      mime: file.type,
    }));
    setNotice({});
    setFiles(filtered);
    setUploads(nextUploads);
    setUploadedFiles([]);
    setFileDigest("");
    setEmailSubmitConfirmed(false);
    if (filtered.length > 0) {
      void uploadFiles(filtered, nextUploads).catch(() => {
        setNotice({ error: "파일 업로드 중 오류가 발생했습니다." });
      });
    }
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

  const createSignedUpload = async (fileName: string) => {
    if (userId) {
      const path = `${userId}/${currentSubmissionId}/audio/${fileName}`;
      const { data, error } = await supabase.storage
        .from("submissions")
        .createSignedUploadUrl(path, { upsert: true });

      if (error || !data) {
        throw new Error("Upload url creation failed");
      }

      return { signedUrl: data.signedUrl, path: data.path };
    }

    const response = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId: currentSubmissionId,
        guestToken: currentGuestToken,
        kind: "audio",
        fileName,
      }),
    });

    if (!response.ok) {
      throw new Error("Upload url creation failed");
    }

    return (await response.json()) as { signedUrl: string; path: string };
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
      const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;

      nextUploads[index] = {
        ...nextUploads[index],
        status: "uploading",
      };
      setUploads([...nextUploads]);

      let signedUrl: string;
      let path: string;
      try {
        const uploadData = await createSignedUpload(fileName);
        signedUrl = uploadData.signedUrl;
        path = uploadData.path;
      } catch {
        nextUploads[index] = {
          ...nextUploads[index],
          status: "error",
        };
        setUploads([...nextUploads]);
        throw new Error("업로드 URL 생성 실패");
      }

      await uploadWithProgress(signedUrl, file, (progress) => {
        nextUploads[index] = {
          ...nextUploads[index],
          progress,
        };
        setUploads([...nextUploads]);
      });

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
    setFiles([]);
    setUploads([]);
    setUploadedFiles([]);
    setFileDigest("");
    setEmailSubmitConfirmed(false);
    setNotice({});
    setCurrentSubmissionId(crypto.randomUUID());
    setCurrentGuestToken(crypto.randomUUID());
  };

  const buildUploadsFromFiles = (fileList: UploadResult[]) =>
    fileList.map((file) => ({
      name: file.originalName,
      size: file.size,
      progress: 100,
      status: "done" as const,
      path: file.path,
      mime: file.mime,
    }));

  const captureCurrentDraft = (): AlbumDraft => ({
    submissionId: currentSubmissionId,
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
  });

  const applyDraftToForm = (
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
    setFiles([]);
    setUploads(draft.files.length > 0 ? buildUploadsFromFiles(draft.files) : []);
    setUploadedFiles(draft.files);
    setFileDigest("");
    setEmailSubmitConfirmed(
      options?.emailSubmitConfirmed ?? draft.files.length === 0,
    );
    setNotice({});
    setCurrentSubmissionId(draft.submissionId);
    setCurrentGuestToken(draft.guestToken);
  };

  const buildAlbumDraft = async (): Promise<AlbumDraft> => {
    const uploaded = await uploadFiles();
    return {
      submissionId: currentSubmissionId,
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
    };
  };

  const getTrackOfficialTitle = (track: TrackInput) => {
    const titleKr = track.trackTitleKr.trim();
    const titleEn = track.trackTitleEn.trim();
    if (track.trackTitleOfficial === "KR") {
      return titleKr;
    }
    if (track.trackTitleOfficial === "EN") {
      return titleEn;
    }
    return titleKr || titleEn;
  };

  const getTrackDisplayTitle = (track: TrackInput) =>
    getTrackOfficialTitle(track) || "제목 미입력";

  const mapTracksForSave = (trackList: TrackInput[]) => {
    const isSingleTrack = trackList.length === 1;
    return trackList.map((track) => ({
      ...track,
      trackTitle: getTrackOfficialTitle(track),
      trackTitleKr: track.trackTitleKr.trim(),
      trackTitleEn: track.trackTitleEn.trim(),
      trackTitleOfficial: track.trackTitleOfficial || undefined,
      isTitle: isSingleTrack ? true : Boolean(track.isTitle),
      titleRole: isSingleTrack
        ? "MAIN"
        : track.isTitle
          ? track.titleRole || "SUB"
          : undefined,
      broadcastSelected: track.broadcastSelected,
    }));
  };

  const validateStep2 = () => {
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

      if (tracks.some((track) => !track.trackTitleKr.trim())) {
        setNotice({ error: "모든 트랙의 곡명(한글)을 입력해주세요." });
        return false;
      }

      if (tracks.some((track) => !track.trackTitleEn.trim())) {
        setNotice({ error: "모든 트랙의 곡명(영문)을 입력해주세요." });
        return false;
      }

      if (tracks.some((track) => !track.trackTitleOfficial)) {
        setNotice({ error: "모든 트랙의 공식 표기를 선택해주세요." });
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

    if (uploads.length === 0) {
      if (emailSubmitConfirmed) {
        return true;
      }
      if (
        typeof window !== "undefined" &&
        window.confirm("음원을 이메일로 제출하시겠습니까?")
      ) {
        setEmailSubmitConfirmed(true);
        return true;
      }
      setNotice({
        error: "음원 파일을 업로드하거나 이메일 제출을 선택해주세요.",
      });
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
      emailSubmitConfirmed: draft.files.length === 0,
    });
  };

  const handleAddAlbum = async () => {
    if (!validateStep2()) {
      return;
    }
    setIsAddingAlbum(true);
    setNotice({});
    try {
      const draft = await buildAlbumDraft();
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

  const handleStep2Next = () => {
    if (editingIndex !== null) {
      setNotice({ error: "수정 중인 앨범을 저장한 뒤 진행해주세요." });
      return;
    }
    if (validateStep2()) {
      setStep(3);
    }
  };

  const handleSave = async (status: "DRAFT" | "SUBMITTED") => {
    if (editingIndex !== null) {
      setNotice({ error: "수정 중인 앨범을 저장한 뒤 진행해주세요." });
      return;
    }
    if (!validateStep2()) {
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
      if (!selectedPackage) {
        setNotice({ error: "패키지를 선택해주세요." });
        return;
      }
      if (basePriceKrw <= 0) {
        setNotice({ error: "결제 금액 정보를 확인할 수 없습니다." });
        return;
      }
      const currentDraft = await buildAlbumDraft();
      const allDrafts = [currentDraft, ...albumDrafts];
      const applicantNameValue = applicantName.trim();
      const applicantEmailValue = applicantEmail.trim();
      const applicantPhoneValue = applicantPhone.trim();
      const submissionIds: string[] = [];
      const guestTokens: string[] = [];

      for (let index = 0; index < allDrafts.length; index += 1) {
        const draft = allDrafts[index];
        const albumPrice = index === 0 ? basePriceKrw : additionalPriceKrw;
        const safeTitle =
          draft.title.trim() || (isOneClick ? "원클릭 접수" : "");
        const safeArtist =
          draft.artistName.trim() || (isOneClick ? "원클릭 접수" : "");
        const result = await saveAlbumSubmissionAction({
          submissionId: draft.submissionId,
          packageId: selectedPackage.id,
          amountKrw: albumPrice,
          title: safeTitle,
          artistName: safeArtist,
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
          status,
          tracks: isOneClick ? undefined : mapTracksForSave(draft.tracks),
          files: draft.files,
        });

        if (result.error) {
          setNotice({ error: result.error });
          return;
        }

        if (result.submissionId) {
          submissionIds.push(result.submissionId);
        }
        if (result.guestToken) {
          guestTokens.push(result.guestToken);
        }
      }

      if (status === "SUBMITTED" && submissionIds.length > 0) {
        if (typeof window !== "undefined") {
          window.alert("심의 접수가 완료되었습니다.");
        }
        setCompletionId(submissionIds[0]);
        setCompletionSubmissionIds(submissionIds);
        if (guestTokens.length > 0) {
          setCompletionTokens(guestTokens);
        }
        setStep(4);
        return;
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
    <div className="space-y-8">
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
                포함 방송국과 가격을 확인하고 선택할 수 있습니다.
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
              const isActive = selectedPackage?.id === pkg.id;
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
                    if (selectionLocked) return;
                    setSelectedPackage(pkg);
                  }}
                  disabled={selectionLocked}
                  className={`text-left rounded-[28px] border p-6 transition disabled:cursor-not-allowed disabled:opacity-70 ${
                    isActive
                      ? tone.card
                      : "border-border/60 bg-card/80 text-foreground hover:border-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] opacity-70">
                        {pkg.stationCount}곳 패키지
                      </p>
                      <h3 className="mt-2 text-xl font-semibold">
                        {pkg.name}
                      </h3>
                    </div>
                    <span className="text-sm font-semibold">
                      {formatCurrency(displayPrice)}원
                    </span>
                  </div>
                  <p className="mt-3 text-xs opacity-70">{pkg.description}</p>
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
          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!selectedPackage}
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
                신청서 정보를 입력하세요.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {isOneClick
                  ? "멜론 링크와 음원 파일만 업로드합니다."
                  : "트랙 정보와 음원 파일을 업로드합니다."}
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
                    <option value="">선택</option>
                    <option value="MALE">남성</option>
                    <option value="FEMALE">여성</option>
                    <option value="MIXED">혼성</option>
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
                <div className="rounded-2xl border border-amber-300/40 bg-amber-100/40 px-4 py-3 text-xs text-amber-700 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-200">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                    원클릭 접수 안내
                  </p>
                  <p className="mt-2 text-xs">
                    이미 발매된 음원에 한정된 서비스입니다. 멜론 링크와 음원 파일만
                    첨부하면 접수가 완료됩니다.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
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
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    접수자 *
                  </label>
                  <input
                    value={applicantName}
                    onChange={(event) => setApplicantName(event.target.value)}
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
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em]">
                          {track.isTitle && (
                            <span
                              className={`rounded-full border px-2 py-1 ${
                                track.titleRole === "MAIN"
                                  ? "border-amber-300 text-amber-600 dark:text-amber-200"
                                  : "border-border/60 text-muted-foreground"
                              }`}
                            >
                              {track.titleRole === "MAIN"
                                ? "메인 타이틀"
                                : "서브 타이틀"}
                            </span>
                          )}
                          {track.broadcastSelected && (
                            <span className="rounded-full border border-emerald-300 px-2 py-1 text-emerald-600 dark:text-emerald-200">
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
                          className="h-4 w-4 rounded border-border"
                        />
                        타이틀
                      </label>
                      {activeTrack.isTitle && (
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={activeTrack.titleRole === "MAIN"}
                            onChange={() => setMainTitleTrack(activeTrackIndex)}
                            className="h-4 w-4 rounded-full border-border"
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
                          className="text-red-500"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                  {requiresBroadcastSelection && (
                    <div className="mt-3 rounded-2xl border border-amber-300/40 bg-amber-100/40 px-3 py-2 text-xs text-amber-700 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-200">
                      {broadcastRequirementMessage} (선택 {broadcastCount}/3)
                    </div>
                  )}
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        곡명 (한글) *
                      </label>
                      <input
                        value={activeTrack.trackTitleKr}
                        onChange={(event) =>
                          updateTrack(
                            activeTrackIndex,
                            "trackTitleKr",
                            event.target.value,
                          )
                        }
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        곡명 (영문) *
                      </label>
                      <input
                        value={activeTrack.trackTitleEn}
                        onChange={(event) =>
                          updateTrack(
                            activeTrackIndex,
                            "trackTitleEn",
                            event.target.value,
                          )
                        }
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
                            checked={activeTrack.trackTitleOfficial === "KR"}
                            onChange={() =>
                              updateTrack(
                                activeTrackIndex,
                                "trackTitleOfficial",
                                "KR",
                              )
                            }
                            className="h-4 w-4 rounded-full border-border"
                          />
                          한글
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={activeTrack.trackTitleOfficial === "EN"}
                            onChange={() =>
                              updateTrack(
                                activeTrackIndex,
                                "trackTitleOfficial",
                                "EN",
                              )
                            }
                            className="h-4 w-4 rounded-full border-border"
                          />
                          영문
                        </label>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        피처링
                      </label>
                      <input
                        value={activeTrack.featuring}
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
                      <textarea
                        value={activeTrack.lyrics}
                        onChange={(event) =>
                          updateTrack(
                            activeTrackIndex,
                            "lyrics",
                            event.target.value,
                          )
                        }
                        className="h-24 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                      <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3 text-xs text-muted-foreground">
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

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              전체 음원 파일 업로드
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              허용 형식: WAV/ZIP · 최대 {uploadMaxLabel}
            </p>
            <div className="mt-4">
              <label className="block">
                <span className="sr-only">파일 첨부</span>
                <input
                  type="file"
                  multiple
                  accept=".wav,.zip,application/zip"
                  onChange={onFileChange}
                  className="hidden"
                />
                <span className="flex w-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-6 text-sm font-semibold text-foreground transition hover:border-foreground">
                  파일 첨부
                </span>
              </label>
            </div>
            <div className="mt-4 space-y-3">
              {uploads.map((upload) => (
                <div
                  key={upload.name}
                  className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">
                      {upload.name}
                    </span>
                    <span className="text-muted-foreground">
                      {upload.status === "done"
                        ? "완료"
                        : upload.status === "uploading"
                          ? "업로드 중"
                          : upload.status === "error"
                            ? "실패"
                            : "대기"}
                    </span>
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
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              <p>
                음원 첨부는 선택사항입니다. 미첨부 시 이메일 제출 확인이
                필요합니다.
              </p>
              {isOneClick && (
                <p>원클릭 접수는 음원 파일만 제출하면 됩니다.</p>
              )}
              <p>
                용량이 크거나 첨부가 어려운 경우 이메일로 음원만 발송해주세요.{" "}
                <span className="font-semibold text-foreground">
                  {APP_CONFIG.supportEmail}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setShowCdInfo(true)}
                className="text-xs font-semibold text-foreground underline decoration-foreground/60 underline-offset-4 transition hover:text-amber-300"
              >
                CD 제작 등 실물 앨범을 발표한 경우
              </button>
            </div>
          </div>

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
                        ? "border-amber-200 bg-amber-200/20"
                        : "border-border/60 bg-background/70 hover:border-foreground"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        앨범 {index + 1}
                        {editingIndex === index && (
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200">
                            수정 중
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
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

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={isSaving || isAddingAlbum}
              className="rounded-full border border-border/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-amber-200 hover:text-slate-900 disabled:cursor-not-allowed"
            >
              이전 단계
            </button>
            {!isGuest && (
              <button
                type="button"
                onClick={() => handleSave("DRAFT")}
                disabled={isSaving || isAddingAlbum}
                className="rounded-full border border-border/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-amber-200 hover:text-slate-900 disabled:cursor-not-allowed"
              >
                임시 저장
              </button>
            )}
            <button
              type="button"
              onClick={handleAddAlbum}
              disabled={isSaving || isAddingAlbum}
              className="rounded-full border border-border/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-amber-200 hover:text-slate-900 disabled:cursor-not-allowed"
            >
              {editingIndex !== null ? "선택 앨범 수정 저장" : "추가 앨범 등록"}
            </button>
            <button
              type="button"
              onClick={handleStep2Next}
              disabled={isSaving || isAddingAlbum || editingIndex !== null}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-muted"
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
              {selectedPackageSummary ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {selectedPackageSummary.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedPackageSummary.stationCount}곳 패키지 · 총{" "}
                        {totalAlbumCount}건
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

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-full border border-border/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-amber-200 hover:text-slate-900"
            >
              이전 단계
            </button>
            <button
              type="button"
              onClick={() => handleSave("SUBMITTED")}
              disabled={isSaving || isAddingAlbum}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-muted"
            >
              접수 완료 요청
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
              onClick={() =>
                router.push(`/dashboard/submissions/${completionId}`)
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
                {completionCodesToShow.map((token, index) => (
                  <div
                    key={token}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs"
                  >
                    <span className="text-muted-foreground">
                      앨범 {index + 1}
                    </span>
                    <span className="font-semibold text-foreground">
                      {token}
                    </span>
                    <button
                      type="button"
                      onClick={() => router.push(`/track/${token}`)}
                      className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:border-amber-200 hover:text-slate-900"
                    >
                      조회
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
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
              className="mt-6 w-full rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-amber-200 hover:text-slate-900"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {showCdInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
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
              서울시 은평구 진흥로 37-6 202호 온사이드
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
              className="mt-6 w-full rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-amber-200 hover:text-slate-900"
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
                className="flex-1 rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-amber-200 hover:text-slate-900 dark:hover:text-foreground"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => setShowOneclickNotice(false)}
                className="flex-1 rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-amber-200 hover:text-slate-900"
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
