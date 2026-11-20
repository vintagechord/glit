/**
 * Upload starts (and, separately, upload completions) allowed per IP address
 * per hour. One application may hold 100 files, one file can take two starts
 * (a presigned URL, then the direct fallback) plus a retry, and an office may
 * send several applications from one address. The former 60 refused the 61st
 * file of a single 100-track album.
 */
export const UPLOAD_REQUESTS_PER_IP_PER_HOUR = 300;
