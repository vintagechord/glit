import { APP_CONFIG } from "@/lib/config";

/**
 * Largest single audio or music video file customers upload through the
 * site (application uploads and supplements): 4GB. Larger files go by email
 * to the support address, the same one the "파일은 이메일로 나중에 제출"
 * option shows (iamonside@daum.net in production).
 */
export const MEDIA_UPLOAD_MAX_BYTES = 4 * 1024 ** 3;
export const MEDIA_UPLOAD_MAX_LABEL = "4GB";
export const MEDIA_EMAIL_SUBMISSION_ADDRESS = APP_CONFIG.supportEmail;

export type MediaUploadKind = "audio" | "video";

/** Shown when a file is over the limit, in the wizards and by the server. */
export const mediaUploadTooLargeMessage = (kind: MediaUploadKind) =>
  `${kind === "video" ? "뮤직비디오" : "음원"} 파일은 하나당 ${MEDIA_UPLOAD_MAX_LABEL}까지 올릴 수 있습니다. ${MEDIA_UPLOAD_MAX_LABEL}가 넘는 파일은 ‘파일은 이메일로 나중에 제출’을 선택하고 ${MEDIA_EMAIL_SUBMISSION_ADDRESS} 주소로 보내주세요.`;

/** One line under the upload area. */
export const MEDIA_UPLOAD_EMAIL_HINT =
  `${MEDIA_UPLOAD_MAX_LABEL}가 넘는 파일은 ${MEDIA_EMAIL_SUBMISSION_ADDRESS} 주소로 이메일 접수해 주세요.`;

/** For checks that do not know the kind (supplement requests). */
export const MEDIA_UPLOAD_LIMITS_MESSAGE =
  `음원과 뮤직비디오는 파일 하나당 ${MEDIA_UPLOAD_MAX_LABEL}까지 올릴 수 있습니다. 더 큰 파일은 ${MEDIA_EMAIL_SUBMISSION_ADDRESS} 주소로 이메일 접수해 주세요.`;
