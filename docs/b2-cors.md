# Backblaze B2 CORS 설정

- Bucket: `glit-submissions` (`allPrivate`)
- Allowed Origins: `https://iamonside.com`, `https://glit-b1yn.onrender.com`
- Allowed Methods: `PUT, HEAD, GET`
- Allowed Headers: `*`
- Expose Headers: `etag`
- Max Age: `3600`

목적: 브라우저가 presigned PUT URL로 B2에 직접 업로드할 수 있도록 허용하고, HEAD/GET 검증 시 필요한 헤더 노출을 보장합니다. 멀티파트 업로드는 응답의 `ETag`를 읽어 완료 요청에 사용합니다.

2026-10-29 02:07 KST에 기존 CORS 규칙의 허용 출처에 `https://iamonside.com`만 추가했습니다. 기존 Render 출처, 헤더, 메서드, 캐시 시간 및 비공개 버킷 설정은 유지했습니다. `www.iamonside.com`은 기본 도메인으로 301 리디렉션하므로 추가하지 않았습니다. 새 출처의 익명 `OPTIONS` 요청에서 `PUT` 허용 응답(HTTP 200)을 확인했으며, 실제 파일 업로드나 삭제는 수행하지 않았습니다.
