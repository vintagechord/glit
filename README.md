# GLIT (MVP → v1)

음원/뮤직비디오 심의를 접수하고 승인·아카이브까지 온라인으로 처리하는 서비스입니다.

## Tech Stack

- Next.js (App Router) + TypeScript + Tailwind
- shadcn/ui
- Supabase (Auth, Postgres, Storage, Realtime)
- Render (free web service)

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
NEXT_PUBLIC_SUPPORT_EMAIL=help@vhouse.co.kr
NEXT_PUBLIC_SUPPORT_PHONE=010-8436-9035
NEXT_PUBLIC_BANK_NAME=국민은행
NEXT_PUBLIC_BANK_ACCOUNT=073001-04-276967
NEXT_PUBLIC_BANK_HOLDER=주식회사 빈티지하우스
NEXT_PUBLIC_PRE_REVIEW_PRICE=0
NEXT_PUBLIC_UPLOAD_MAX_MB=1024
NEXT_PUBLIC_AUDIO_UPLOAD_MAX_MB=1024
NEXT_PUBLIC_VIDEO_UPLOAD_MAX_MB=4096
# Spellcheck proxy (Python microservice)
SPELLCHECK_SERVICE_URL=https://glit-spellcheck.onrender.com
SPELLCHECK_SHARED_SECRET=optional-shared-secret

# Optional (welcome email)
RESEND_API_KEY=your_resend_key
RESEND_FROM="GLIT <help@vhouse.co.kr>"

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
- Render: Render Dashboard에 동일 env 저장 후 배포 → `/api/inicis/submission/order` 200 및 `INIStdPay.js` 로드 확인.

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
- 파일 업로드: Supabase Storage signed upload (로컬 디스크 미사용)
- 결제: 카드/무통장 선택 + 입금 확인 → PAYMENT_PENDING
- 진행상황: 방송국별 상태 테이블 + 실시간 갱신
- 결과 통보: 이벤트 타임라인
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

## Render 배포 가이드

1) Render → New Web Service → Git repo 연결  
2) Build Command
```bash
npm ci && npm run build
```
3) Start Command
```bash
npm run start
```
4) Env (Render Dashboard)
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL
```

## Health Check

`/api/health`

## Notes

- Storage는 Supabase Storage만 사용합니다.
- Render 무료 플랜의 휘발성 디스크에 파일을 저장하지 않습니다.
- `public/forms/*` 파일은 MVP용 placeholder입니다.
- 관리자 계정은 Supabase `profiles` 테이블에서 `role='admin'`으로 설정하세요.
- 이메일 인증 없이 가입하려면 Supabase Auth 설정에서 Email Confirm을 꺼주세요.
