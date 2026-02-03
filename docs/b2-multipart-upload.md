# B2 Multipart 업로드 구성

## 목적
- 브라우저에서 Backblaze B2(S3 호환)로 직접 업로드합니다.
- Render 서버는 presign/complete API만 담당하고, 파일 바디는 통과하지 않습니다.

## 서버 API
- `POST /api/uploads/multipart/init`
  - 요청: `{ submissionId, kind, filename, mimeType, sizeBytes, title?, guestToken? }`
  - 응답: `{ uploadId, key, partSize, partCount, expiresInSeconds }`
- `POST /api/uploads/multipart/presign`
  - 요청: `{ submissionId, key, uploadId, partNumbers, guestToken? }`
  - 응답: `{ urls: [{ partNumber, url }], expiresInSeconds }`
- `POST /api/uploads/multipart/complete`
  - 요청: `{ submissionId, key, uploadId, parts, filename, mimeType, sizeBytes, kind?, durationSeconds?, checksum?, guestToken? }`
  - 응답: `{ ok, key, accessUrl }`

## 환경 변수
- `B2_S3_ENDPOINT`
- `B2_REGION`
- `B2_BUCKET`
- `B2_PREFIX`
- `B2_KEY_ID`
- `B2_APPLICATION_KEY`
- `B2_PRESIGN_EXPIRES_SECONDS` (단일 PUT presign 만료, 기본 900)
- `B2_MULTIPART_PRESIGN_EXPIRES_SECONDS` (멀티파트 presign 만료, 기본 1200)
- `B2_MULTIPART_PART_SIZE_MB` (멀티파트 파트 크기, 기본 16)
- `B2_ACCESS_URL_EXPIRES_SECONDS` (access_url 저장용 signed GET 만료, 기본 86400)
- `NEXT_PUBLIC_UPLOAD_MULTIPART_THRESHOLD_MB` (클라이언트 멀티파트 전환 기준, 기본 200)

## B2 CORS
`docs/b2-cors.md` 참고. 멀티파트 업로드를 위해 `ETag` 노출이 필수입니다.

## 테스트
- 1GB 파일 업로드
- 네트워크 끊김/재시도: 파트 단위 재시도 확인
- 업로드 완료 후 `submission_files`에 `object_key`, `size`, `mime`, `duration_seconds` 기록 확인
