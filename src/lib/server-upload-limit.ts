/**
 * Vercel Functions reject request bodies above 4.5MB before route code runs.
 * Uploads that still pass through the app server stay at 4MB (multipart
 * overhead included); large customer files use direct B2/Storage URLs.
 */
export const SERVER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const SERVER_UPLOAD_MAX_LABEL = "4MB";
