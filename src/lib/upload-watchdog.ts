/** Abort a stalled transfer without limiting the duration of an upload that is progressing. */
export function watchUploadProgress(
  xhr: XMLHttpRequest,
  reject: (error: Error) => void,
  idleTimeoutMs = 90_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sent = 0;
  let received = 0;
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    xhr.upload.removeEventListener("progress", uploadProgress);
    xhr.removeEventListener("progress", responseProgress);
    xhr.removeEventListener("loadend", cleanup);
  };
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      cleanup();
      xhr.abort();
      reject(new Error("업로드 응답이 지연되어 중단했습니다. 다시 시도하거나 이메일로 파일을 보내주세요."));
    }, idleTimeoutMs);
  };
  const uploadProgress = (event: ProgressEvent) => {
    if (event.loaded > sent) { sent = event.loaded; arm(); }
  };
  const responseProgress = (event: ProgressEvent) => {
    if (event.loaded > received) { received = event.loaded; arm(); }
  };
  xhr.upload.addEventListener("progress", uploadProgress);
  xhr.addEventListener("progress", responseProgress);
  xhr.addEventListener("loadend", cleanup);
  arm();
  return cleanup;
}
