# Backblaze B2 CORS 설정 (Render, Cloudflare 없음)

- Allowed Origins: `https://glit-b1yn.onrender.com` (스테이징/프리뷰 도메인도 추가)
- Allowed Methods: `PUT, HEAD, GET`
- Allowed Headers: `Content-Type, Content-MD5, x-amz-*, authorization`
- Expose Headers: `ETag`
- Max Age: 적절히(예: 3600)

목적: 브라우저가 presigned PUT URL로 B2에 직접 업로드할 수 있도록 허용하고, HEAD/GET 검증 시 필요한 헤더 노출을 보장합니다. Cloudflare를 사용하지 않는 환경을 가정합니다.
