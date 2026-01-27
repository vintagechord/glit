import { presignGetUrl } from "@/lib/b2";

export const RATING_IMAGE_MAP: Record<"ALL" | "12" | "15" | "18", string> = {
  ALL: "submissions/admin-free/free-upload/all 로고.png",
  "12": "submissions/admin-free/free-upload/12세 로고.png",
  "15": "submissions/admin-free/free-upload/15세 로고.png",
  "18": "submissions/admin-free/free-upload/18세 로고.png",
};

export const LABEL_GUIDE_KEY =
  "submissions/admin-free/free-upload/온사이드 뮤직비디오 등급표시 방법 안내.pdf";

export type RatingCode = keyof typeof RATING_IMAGE_MAP;

export const isRatingCode = (value: unknown): value is RatingCode =>
  value === "ALL" || value === "12" || value === "15" || value === "18";

export const getRatingObjectKey = (rating: RatingCode | null | undefined) =>
  rating ? RATING_IMAGE_MAP[rating] : null;

export const getRatingSignedUrl = async (rating: RatingCode) =>
  presignGetUrl(RATING_IMAGE_MAP[rating]);

export const getGuideSignedUrl = async () => presignGetUrl(LABEL_GUIDE_KEY);
