# 온사이드 (MVP → v1)

음원/뮤직비디오 심의를 접수하고 승인·아카이브까지 온라인으로 처리하는 서비스입니다.

## Tech Stack

- Next.js (App Router) + TypeScript + Tailwind
- shadcn/ui
- Supabase (Auth, Postgres, Storage, Realtime)
- Vercel (Hobby, Next.js Functions in `bom1` Mumbai, next to the Supabase project)
- Backblaze B2 (submission files)

## Local Setup

1) Install
```bash
npm install
```

2) Environment
Create `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional (UI/config)
NEXT_PUBLIC_SUPPORT_EMAIL=iamonside@daum.net
NEXT_PUBLIC_SUPPORT_PHONE=010-8436-9035
NEXT_PUBLIC_BANK_NAME=국민은행
NEXT_PUBLIC_BANK_ACCOUNT=073001-04-276967
NEXT_PUBLIC_BANK_HOLDER=주식회사 빈티지하우스
NEXT_PUBLIC_PRE_REVIEW_PRICE=0
NEXT_PUBLIC_UPLOAD_MAX_MB=4096
NEXT_PUBLIC_AUDIO_UPLOAD_MAX_MB=4096
NEXT_PUBLIC_VIDEO_UPLOAD_MAX_MB=4096
# Spellcheck proxy (Python microservice)
SPELLCHECK_SERVICE_URL=https://glit-spellcheck.onrender.com
SPELLCHECK_SHARED_SECRET=optional-shared-secret

# Optional OpenAI-backed lyric translation
OPENAI_API_KEY=your_openai_api_key
OPENAI_TRANSLATION_MODEL=gpt-5.5
OPENAI_TRANSLATION_TIMEOUT_MS=15000

# Email notifications (Supabase relay; SMTP credentials belong in function secrets)
EMAIL_PROVIDER=supabase-smtp
SUPABASE_EMAIL_RELAY_URL=https://your-project.supabase.co/functions/v1/send-transactional-email
EMAIL_RELAY_SECRET=your_64_hex_character_relay_secret
SMTP_FROM="온사이드 <iamonside@daum.net>"
NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional
EMAIL_TEST_TO=you@example.com

# Optional (official Kakao/Alimtalk notification webhook)
KAKAO_ALIMTALK_WEBHOOK_URL=https://your-kakao-provider-webhook
KAKAO_ALIMTALK_API_KEY=optional-provider-api-key
KAKAO_ALIMTALK_TEMPLATE_CODE=ONSIDE_OFFICIAL_NOTICE

# Inicis subscription billing (staging sample values)
INICIS_ENV=stg
INICIS_MID_STG=INIBillTst
INICIS_SIGN_KEY_STG=SU5JTElURV9UUklQTEVERVNfS0VZU1RS
INICIS_BILLING_API_KEY_STG=rKnPljRn5m6J9Mzz
INICIS_BILLING_API_IV_STG=W2KLNKra6Wxc1P==
INICIS_LITE_KEY_STG=b09LVzhuTGZVaEY1WmJoQnZzdXpRdz09
INICIS_API_URL_STG=https://stginiapi.inicis.com
INICIS_STDJS_URL_STG=https://stgstdpay.inicis.com/stdjs/INIStdPay.js
SUBSCRIPTION_PRICE_KRW=1000
```

### Inicis STDPay(일반 결제) 체크리스트
- 필요 env(일반 결제만): `INICIS_ENV`(기본 stg), `INICIS_MID_{STG|PROD}`, `INICIS_SIGN_KEY_{STG|PROD}`, 선택 `INICIS_STDJS_URL_{STG|PROD}`. 빌링용 키(`INICIS_BILLING_*`, `INICIS_LITE_KEY_*`, `INICIS_API_URL_*`)가 없어도 STDPay는 동작해야 합니다.
- 로컬: 위 env만 넣고 `npm run dev` → `POST /api/inicis/submission/order`가 200/`stdJsUrl` 응답인지 확인 → 브라우저 Network에서 `INIStdPay.js` 200 로드 및 콘솔의 `[Inicis][STDPay] INIStdPay.js loaded?` 로그 확인. `localhost`는 INI에서 차단될 수 있으므로 ngrok 등 퍼블릭 URL을 `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_SITE_URL`로 주입하세요.
- Vercel: Project → Settings → Environment Variables(Production)에 동일 env 저장 후 재배포 → `/api/inicis/submission/order` 200 및 `INIStdPay.js` 로드 확인.

3) Supabase SQL (run in SQL Editor)
```sql
-- in order
supabase/migrations/0001_profiles.sql
supabase/migrations/0002_core.sql
supabase/migrations/0003_storage.sql
supabase/migrations/0004_guest_access.sql
supabase/migrations/0005_extras.sql
supabase/seed.sql
```

4) Run
```bash
npm run dev
```

## 주요 기능

- Auth: 회원가입/로그인/로그아웃 + profiles 자동 생성
- 심의 접수: 음반/뮤직비디오 Wizard (STEP01~05)
- 파일 업로드: Backblaze B2 presigned/multipart upload (로컬 디스크 미사용)
- 결제: 카드/무통장 선택 + 입금 확인 → PAYMENT_PENDING
- 진행상황: 방송국별 상태 테이블 + 실시간 갱신
- 결과 통보: 이벤트 타임라인
- 내 음악 관리: `/mypage/music`의 회원별 아티스트·발매작·트랙 아카이브와 발매 후 업무 기록. 신규 DB 설치, 제공처 허가·설정, 수집 워커와 관리자 운영은 [구현·운영 안내](docs/music-archive.md)를 참고하세요.
- 신청서 다운로드: `/forms`
- 노래방 등록 요청: `/karaoke-request`
- 관리자: `/admin` (접수 관리, 결제 승인, 방송국 상태, 패키지/방송국/배너 설정)

## Realtime

사용자 상세 페이지(`/dashboard/submissions/[id]`)에서 Supabase Realtime을 구독해
`submissions`, `station_reviews`, `submission_events` 변경을 즉시 반영합니다.

## 스모크 테스트 체크리스트

- 앨범/뮤비 다중 파일 업로드: 3개 이상 동시 업로드 후 드래프트 재진입 시 목록 유지되는지 확인
- 게스트 접수: 제출 후 수신 이메일에서 조회 코드/링크가 포함됐는지 확인
- 관리자 다운로드: B2 저장소 파일에 대해 관리자 다운로드 링크가 생성·동작하는지 확인
- 대용량 업로드: 앨범(1GB)·뮤비(4GB) 정책 용량까지 업로드 진행률 표시와 완료 여부 확인

## Vercel 배포 가이드

2026-10-31 Render에서 Vercel로 이전했습니다. 절차와 검증 기록은
[Vercel 이전 기록](docs/onside-vercel-migration-2026-10-31.md)을 참고하세요.

1) Vercel 프로젝트 `glit`이 GitHub `vintagechord/glit`의 `main`에 연결되어
   있습니다. `main`에 병합하면 Production으로 자동 배포됩니다.
2) Build는 Vercel 기본값(`npm install` → `next build`)을 사용합니다. 함수 리전은
   `vercel.json`의 `bom1`(Mumbai, Supabase `glit`과 같은 지역)입니다.
3) Env는 Vercel → Project Settings → Environment Variables(Production)에
   저장합니다. 값을 바꾼 뒤에는 재배포해야 반영됩니다.
4) DB 마이그레이션은 배포 전에 `supabase db push`로 먼저 적용합니다. 새 RPC를
   호출하는 코드가 마이그레이션보다 먼저 배포되지 않도록 순서를 지킵니다.

### Vercel 제약

- 함수 요청·응답 본문은 4.5MB까지입니다. 음원·영상·신청서·결제 서류는 B2
  presigned URL로 브라우저에서 바로 올리고, 서버를 거치는 관리자 업로드는 4MB로
  제한합니다(`src/lib/server-upload-limit.ts`).
- Hobby 함수 실행 시간은 최대 300초입니다.
- 상주 프로세스가 없으므로 음악 아카이브·심의자료 작업은 Supabase pg_cron
  (`onside-background-jobs`)이 대기 작업이 있을 때만 `/api/internal/background-jobs`를
  호출해 이어서 처리합니다.
- 웹 심의자료 처리는 DOCX와 멜론·지니 URL만 지원합니다. DOC·HWP·PDF는 Mac 심의
  데스크로 처리합니다.

## Health Check

- `/healthz`: lightweight liveness endpoint for uptime monitors
- `/readyz`: runtime configuration readiness check
- `/api/health`: backward-compatible runtime configuration check

Production uses the existing Daum mailbox through a Supabase Edge Function.
No new domain or Resend account is required. The `6b19cd9` deployment went live
in `transactional` mode on 2026-10-25; a common app notification was sent and
the user confirmed receipt. See [email configuration](docs/auth-email-configuration.md)
and the [deployment record](docs/email-production-activation-2026-10-24.md)
for setup and the exact verification scope.

For a real email send test, configure the selected provider and an approved
test recipient, then run:

```bash
npm run email:smoke -- --to you@example.com
```

`/api/health` checks provider configuration, durable queue availability, worker
heartbeat and delivery exceptions; it does not verify inbox delivery.
Resend remains an optional provider and requires an owned, verified sender
domain. Daum SMTP credentials stay in Supabase function secrets; the web app uses
the HTTPS relay URL and its separate server secret.

Signup verification, account lookup, password recovery, guest code recovery
and review updates use the selected app email provider. Failed sends do not
retry through Supabase's default sender. Safe failures retry from a server-only
database outbox; uncertain SMTP acceptance requires an explicit operator decision
at `/admin/emails`. See [deployment order and scheduler setup](docs/auth-email-configuration.md).
Password recovery uses a signed fragment and consumes its token only on password
submission. Links issued before this hardening deployment must be requested again.
Keep Supabase Auth's redirect allowlist
configured for the actual site's `/reset-password` and `/en/reset-password` URLs.

To check login and password recovery without sending email, run the following
against an explicitly selected app. It uses the local Supabase configuration,
creates one temporary account, tests both passwords, then deletes the account:

```bash
AUTH_QA_BASE_URL=http://127.0.0.1:3000 npx tsx scripts/auth-live-smoke.ts
```

## Notes

- Storage는 Supabase Storage만 사용합니다.
- Vercel 함수의 파일 시스템은 휘발성이므로 파일을 저장하지 않습니다.
- `public/forms/*` 파일은 MVP용 placeholder입니다.
- 관리자 계정은 Supabase `profiles` 테이블에서 `role='admin'`으로 설정하세요.
- 운영 회원가입은 이메일 확인 후 비밀번호를 설정합니다. Supabase Auth의 Email Confirm을 유지하고 [이메일 설정 문서](docs/auth-email-configuration.md)를 따르세요.
