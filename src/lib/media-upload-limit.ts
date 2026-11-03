import { APP_CONFIG } from "@/lib/config";

/**
 * Largest single audio or music video file customers upload through the
 * site (application uploads and supplements). Larger files go by email to
 * the support address, the same one the "파일은 이메일로 나중에 제출"
 * option shows (iamonside@daum.net in production).
 */
export const MEDIA_UPLOAD_MAX_BYTES = 2 * 1024 ** 3;
export const MEDIA_UPLOAD_MAX_LABEL = "2GB";
export const MEDIA_EMAIL_SUBMISSION_ADDRESS = APP_CONFIG.supportEmail;

/** Shown when a file is over the limit, in the wizards and by the server. */
export const MEDIA_UPLOAD_TOO_LARGE_MESSAGE =
  `파일 하나는 ${MEDIA_UPLOAD_MAX_LABEL}까지 올릴 수 있습니다. ${MEDIA_UPLOAD_MAX_LABEL}가 넘는 파일은 ‘파일은 이메일로 나중에 제출’을 선택하고 ${MEDIA_EMAIL_SUBMISSION_ADDRESS} 주소로 보내주세요.`;

/** One line under the upload area. */
export const MEDIA_UPLOAD_EMAIL_HINT =
  `${MEDIA_UPLOAD_MAX_LABEL}가 넘는 파일은 ${MEDIA_EMAIL_SUBMISSION_ADDRESS} 주소로 이메일 접수해 주세요.`;
