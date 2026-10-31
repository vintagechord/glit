# 온사이드 Render → Vercel 이전 기록 (2026-10-31)

사용자 요청으로 온사이드 웹을 Render에서 Vercel로 완전히 옮겼다. Supabase(`glit`,
Mumbai)와 Backblaze B2는 그대로 유지한다. 아트멜론·암파인·워터멜론 관련 Vercel
프로젝트, Supabase 프로젝트, GitHub 저장소는 조회 외에 변경하지 않았다.

## 구성

| 항목 | 값 |
| --- | --- |
| Vercel 팀 | `vintagechord85-2949's projects` (Hobby, `team_WpvLGENQ2rt0S7kipCRKvIZK`) |
| 프로젝트 | `glit` (`prj_2BagpJ3xO4SYqS0taoYSdg2RlPRl`), Next.js, Node 22.x |
| 기본 주소 | `https://glit-five.vercel.app` |
| 함수 리전 | `bom1` (Mumbai, `vercel.json`) — Supabase `glit`과 같은 지역 |
| Git | GitHub `vintagechord/glit`, Production 브랜치 `main` |
| 미리보기 빌드 | 건너뜀(Ignored Build Step: Production만 빌드) |
| 도메인 | `iamonside.com`(기본), `www.iamonside.com` → `iamonside.com` 308 |
| 환경변수 | Render `glit`의 25개 값을 그대로 Production에 복사(`PORT` 제외). 비밀키 7개는 Sensitive |

요금제는 사용자가 Hobby를 선택했다. Vercel 이용 정책상 Hobby는 비상업 용도로
제한되며 결제를 받는 사이트는 Pro 대상이다. 이 위험은 사용자가 감수하기로 했다.

## Vercel 제약에 맞춘 코드 변경 (PR #45)

- 함수 요청·응답 본문 4.5MB 제한
  - 고객 신청서(HWP/DOC/DOCX)·결제 증빙(PDF/JPG/PNG/WEBP)은 `/api/uploads/init`
    (`etc` 종류 추가) → B2 presigned PUT → `/api/uploads/complete`로 브라우저에서 바로 올린다.
    `/api/uploads/direct`는 4MB 이하 예비 경로다.
  - 매거진 대표 이미지(최대 20MB)는 Supabase Storage 서명 업로드 URL로 올리고 서버 액션은
    저장된 객체만 확인한다.
  - 서버를 거치는 관리자 업로드(필증, 아티스트 썸네일, MV 등급 이미지, 배너, 웹 심의자료
    원본)는 4MB로 제한한다(`src/lib/server-upload-limit.ts`). Mac 데스크의 필증 업로드도
    같은 4MB 제한을 받는다.
- Hobby 함수 최대 300초: 심의자료 라우트의 `maxDuration` 900 → 300, 웹 작업은 240초에서 재시도
  가능한 시간 초과로 끝낸다.
- 상주 프로세스 없음: Render에서 3초·15초마다 돌던 음악 아카이브·심의자료 dispatcher는
  Vercel에서 꺼진다(`RENDER` 미설정). 대신 마이그레이션
  `20261031210000_vercel_background_jobs.sql`의 pg_cron `onside-background-jobs`가 1분마다
  대기 작업을 확인하고, 있을 때만 `/api/internal/background-jobs`를 호출한다. 인증은 기존
  메일 워커 토큰(`authorize_email_worker`)을 재사용한다. 회원·관리자 화면의 요청 후 처리
  (`after()`)도 그대로 작업을 이어 간다.
- 웹 심의자료 처리: Vercel에는 LibreOffice·OCR·Python이 없으므로 DOCX와 멜론·지니 URL만
  처리한다. DOC·HWP·PDF는 Mac 심의 데스크로 처리한다(사용자 확정).
- `render.yaml` 삭제, `.vercelignore` 추가(수동 CLI 업로드 시 `.env*`·`tmp/` 제외).

## 운영 데이터·설정 변경

- `email_worker_config.endpoint_url`: `https://glit-b1yn.onrender.com/api/internal/email-outbox`
  → `https://iamonside.com/api/internal/email-outbox` (2026-10-31, 서비스 롤로 1행 갱신).
  DNS 전환 전에는 같은 주소가 Render로, 전환 후에는 Vercel로 간다.
- Mac 심의 데스크 `~/Library/Application Support/Onside Review Desk/connection.env`의
  `ONSIDE_DESK_SERVICE_URL`: Render 주소 → `https://iamonside.com`. 서명된 health 호출이
  Vercel 배포와 현재 도메인 모두에서 `ok:true`.
- Vercel GitHub 앱 설치에 `glit` 저장소만 추가(사용자가 GitHub 설정에서 진행).

## DNS (가비아)

| 호스트 | 기존 | 변경 |
| --- | --- | --- |
| `@` A | `216.24.57.1` (Render) | `216.198.79.1`, `64.29.17.1` |
| `www` CNAME | `glit-b1yn.onrender.com.` | `6dbbb6e9e0c47844.vercel-dns-017.com.` |

TTL은 600초. MX·TXT·CAA 레코드는 없다. B2 CORS는 이미 `https://iamonside.com`을 허용한다.

## 전환 순서와 상태

1. Vercel 프로젝트 생성·환경변수·리전·도메인 추가 — 완료.
2. Production 배포(`glit-five.vercel.app`) 점검 — `/api/health` 오류 0, 경고 1(카카오 알림톡,
   Render와 동일), 주요 페이지 200, 내부 API 무인증 401.
3. PR #45 `main` 병합 — 사용자 진행(자동 모드에서 병합이 차단됨).
4. `supabase db push --linked`로 `20261031210000` 적용 — 사용자 진행.
5. 가비아 DNS 변경 — 사용자 진행.
6. DNS·SSL 확인 후 Render `glit`(`srv-d5bvt5ggjchc73ccaaug`) 일시 중지.

## 되돌리기

Render 서비스는 삭제하지 않고 일시 중지만 한다. 문제가 생기면 Render 대시보드에서
Resume 후 가비아 DNS를 위 "기존" 값으로 되돌린다. Render에는 이번 PR 이전 코드가 배포되어
있고, 새 마이그레이션은 Render 코드와 호환된다(메일 워커 주소는 같은 도메인).

## 알려진 제약

- Hobby 월 한도: 함수 호출 100만, Active CPU 4시간, Fast Data Transfer 100GB,
  이미지 최적화 5천 건. pg_cron은 대기 작업이 있을 때만 앱을 깨운다.
- Render 무료 플랜 대비 콜드스타트가 짧아져 외부 keep-alive 핑은 더 이상 필요 없다.
- 기존 `glit-b1yn.onrender.com` 링크는 Render 중지 후 열리지 않는다.
