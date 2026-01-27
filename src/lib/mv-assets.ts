import { presignGetUrl } from "@/lib/b2";

const DEFAULT_RATING_MAP: Record<"ALL" | "12" | "15" | "18" | "19" | "REJECT", string> = {
  ALL: "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/mv/All.png",
  "12": "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/mv/12.png",
  "15": "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/mv/15.png",
  "18": "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/mv/18.png",
  // 19/REJECT fall back to 18 로고 to avoid missing objects
  "19": "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/mv/18.png",
  REJECT: "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/mv/18.png",
};

const getEnvKey = (name: string, fallback: string) =>
  process.env[name]?.trim() || fallback;

export const RATING_IMAGE_MAP: Record<"ALL" | "12" | "15" | "18" | "19" | "REJECT", string> = {
  ALL: getEnvKey("MV_RATING_IMAGE_ALL_KEY", DEFAULT_RATING_MAP.ALL),
  "12": getEnvKey("MV_RATING_IMAGE_12_KEY", DEFAULT_RATING_MAP["12"]),
  "15": getEnvKey("MV_RATING_IMAGE_15_KEY", DEFAULT_RATING_MAP["15"]),
  "18": getEnvKey("MV_RATING_IMAGE_18_KEY", DEFAULT_RATING_MAP["18"]),
  "19": getEnvKey("MV_RATING_IMAGE_19_KEY", DEFAULT_RATING_MAP["19"]),
  REJECT: getEnvKey("MV_RATING_IMAGE_REJECT_KEY", DEFAULT_RATING_MAP.REJECT),
};

export const LABEL_GUIDE_KEY = getEnvKey(
  "MV_LABEL_GUIDE_KEY",
  "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/mv/mv_guide.pdf",
);

export type RatingCode = keyof typeof RATING_IMAGE_MAP;

export const isRatingCode = (value: unknown): value is RatingCode =>
  value === "ALL" ||
  value === "12" ||
  value === "15" ||
  value === "18" ||
  value === "19" ||
  value === "REJECT";

export const getRatingObjectKey = (rating: RatingCode | null | undefined) =>
  rating ? RATING_IMAGE_MAP[rating] ?? null : null;

export const getRatingSignedUrl = async (rating: RatingCode) =>
  presignGetUrl(RATING_IMAGE_MAP[rating]);

export const getGuideSignedUrl = async () => presignGetUrl(LABEL_GUIDE_KEY);
