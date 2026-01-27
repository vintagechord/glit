import { presignGetUrl } from "@/lib/b2";

const DEFAULT_RATING_MAP: Record<"ALL" | "12" | "15" | "18", string> = {
  ALL: "submissions/admin-free/free-upload/all 로고.png",
  "12": "submissions/admin-free/free-upload/12세 로고.png",
  "15": "submissions/admin-free/free-upload/15세 로고.png",
  "18": "submissions/admin-free/free-upload/18세 로고.png",
};

const getEnvKey = (name: string, fallback: string) =>
  process.env[name]?.trim() || fallback;

export const RATING_IMAGE_MAP: Record<"ALL" | "12" | "15" | "18", string> = {
  ALL: getEnvKey("MV_RATING_IMAGE_ALL_KEY", DEFAULT_RATING_MAP.ALL),
  "12": getEnvKey("MV_RATING_IMAGE_12_KEY", DEFAULT_RATING_MAP["12"]),
  "15": getEnvKey("MV_RATING_IMAGE_15_KEY", DEFAULT_RATING_MAP["15"]),
  "18": getEnvKey("MV_RATING_IMAGE_18_KEY", DEFAULT_RATING_MAP["18"]),
};

export const LABEL_GUIDE_KEY = getEnvKey(
  "MV_LABEL_GUIDE_KEY",
  "submissions/admin-free/free-upload/온사이드 뮤직비디오 등급표시 방법 안내.pdf",
);

export type RatingCode = keyof typeof RATING_IMAGE_MAP;

export const isRatingCode = (value: unknown): value is RatingCode =>
  value === "ALL" || value === "12" || value === "15" || value === "18";

export const getRatingObjectKey = (rating: RatingCode | null | undefined) =>
  rating ? RATING_IMAGE_MAP[rating] ?? null : null;

export const getRatingSignedUrl = async (rating: RatingCode) =>
  presignGetUrl(RATING_IMAGE_MAP[rating]);

export const getGuideSignedUrl = async () => presignGetUrl(LABEL_GUIDE_KEY);
