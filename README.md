# Onside (MVP → v1)

음원/뮤직비디오 심의 접수·진행·결과 통보를 온라인으로 처리하는 서비스입니다.

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
NEXT_PUBLIC_SUPPORT_EMAIL=onside17@daum.net
NEXT_PUBLIC_BANK_NAME=신한은행
NEXT_PUBLIC_BANK_ACCOUNT=123-456-789012
NEXT_PUBLIC_BANK_HOLDER=온사이드
NEXT_PUBLIC_PRE_REVIEW_PRICE=0
NEXT_PUBLIC_UPLOAD_MAX_MB=200
```

3) Supabase SQL (run in SQL Editor)
```sql
-- in order
supabase/migrations/0001_profiles.sql
supabase/migrations/0002_core.sql
supabase/migrations/0003_storage.sql
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
- 결제: 무통장 입금 안내 + 입금자명 입력 → PAYMENT_PENDING
- 진행상황: 방송국별 상태 테이블 + 실시간 갱신
- 결과 통보: 이벤트 타임라인
- 신청서 다운로드: `/forms`
- 노래방 등록 요청: `/karaoke-request`
- 관리자: `/admin` (접수 관리, 결제 승인, 방송국 상태, 패키지/방송국 설정)

## Realtime

사용자 상세 페이지(`/dashboard/submissions/[id]`)에서 Supabase Realtime을 구독해
`submissions`, `station_reviews`, `submission_events` 변경을 즉시 반영합니다.

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
