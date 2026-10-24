# 온사이드 오픈 전 수정·검증 보고서

작성일: 2026-10-24 KST. 대상: `vintagechord/glit`, `https://glit-b1yn.onrender.com/`.
기준 커밋: `3811f942233e5dd4890cc2c7efa5ba50a9503b3f`.
첨부 점검보고서와 최종 수정 프롬프트를 검토하고, 사용자의 “두 파일 검토 및 glit 수정” 요청 범위에서 수행했다. 직접 접수 방식이며 아직 고객이 없다는 사용자 확인을 반영했다. 고객이 없다는 사실을 기존 DB·파일 전체 삭제 허가로 해석하지 않았다.

## 1. 결론 — 오픈 보류

신청 UX, 인증 복귀, 접근성, 결제 안내, 파일 검증, 결제 후 보완 제출의 로컬 구현을 수정했다. 실제 B2 저장소의 제한된 시험 파일 전송도 확인했다. 그러나 운영 배포 SHA와 DB migration 이력, 실제 승인·취소와 입금 대사, 실제 결과 파일 전달, 지정 수신자의 이메일·카카오 수신을 확인하지 못했다. 이 중요한 경로를 mock 통과만으로 오픈 가능하다고 판정할 수 없다.

현재 운영 health의 HTTP 200은 업로드·결제·알림의 실제 성공 증거가 아니다. 이메일 경고가 있었으며, 수정된 readiness는 필수 이메일 설정이 유효하지 않으면 503을 반환한다. 배포 전에 해당 설정과 발송 경로부터 확인해야 한다.

사용자가 2026-10-24에 보관 정책을 확정했다. 심의용 음원 파일은 **각 파일의 제출일부터 1개월**, 영상·가사·신청서·결과 파일·필증 및 신청·심의 결과 내역은 **관리자가 삭제할 때까지 기간 만료 없이 보관**한다. 음원 보관 종료가 신청/결과 내역 삭제를 의미하지 않는다. 한·영 파일 정책에 반영했다. 기산점도 사용자 확인으로 음원 제출일로 확정했다. 보완 음원은 각 파일의 제출일을 기준으로 한다. 자동 음원 삭제는 구현·실행하지 않았다. 조회한 B2 버킷에는 lifecycle 설정이 없었고, 파일 종류별 분류가 현재 삭제 기준으로 충분하지 않으므로 버킷 전체 만료를 설정하지 않았다.

## 2. 검증 표·환경·증거

상태는 명시한 범위에만 적용한다. **PASS**는 실행 결과, **FAIL**은 확인된 불일치, **BLOCKED**는 접근·설정·승인이 필요한 실행, **NOT TESTED**는 실행하지 않은 범위다. “정적 검토”와 “mock”은 실제 서비스 성공을 뜻하지 않는다.

환경: macOS 로컬, Node 24.7, Next.js 16.3.1 / React 19.2.3, 설치된 Chrome을 사용하는 Playwright. 로컬 앱은 `127.0.0.1:3001`이며 기존 3000번 프로세스를 검증 대상으로 사용하지 않았다. DB 검증은 외부 네트워크가 없는 임시 PostgreSQL 17 컨테이너에서 수행하고 제거했다. 모든 검증일은 2026-10-24 KST다.

| 페이지·기능 | 판정 | 실행 범위와 한계 |
|---|---|---|
| `/`, `/dashboard/new`, `/en/dashboard/new` | PASS | 홈 가상 예시·목적별 3개 서비스·영어 목적 및 링크·360/390/430/768/1024/1440px. 공개 UI의 쓰기 요청 차단 |
| 서비스 화면 확대·대비 | PASS / NOT TESTED | 200% CSS zoom에서 포커스와 가로 넘침 확인. 일반 본문 3개 카드 색 대비 약 12.35:1, 7.24:1, 4.65:1. 작은 빨강 카드 문구의 opacity를 제거. 실제 브라우저 zoom·전체 사이트 대비 감사·Safari·실기기는 미실행 |
| 가입·로그인·복구·정책/조회 모달 | PASS / BLOCKED | 인증 UI·안전한 next·비밀번호 보기·모달 포커스 등 17개 mock E2E. 실제 계정 생성·재설정 메일 수신·운영 세션 검증 미실행 |
| 음반 기본 11필드·이메일 나중 제출·키보드 업로드 | PASS | mock UI에서 필드 연결·오류·혼성 입력·자료 제출 대기·장바구니 경로. 실제 관리자 자료 수신 확인과는 별개 |
| MV 목적·선택 방송사 안내·영어 제출 단계 | PASS | KBS만 선택 시 해당 규격 우선 표시, 온라인/방송 목적 유지, 중복 이메일 안내 정리 |
| KBS 직접 접수 적용 규격 | BLOCKED | 사용자는 직접 접수를 확인. RIAK 공식 FAQ는 참고 출처로 표시했으며 직접 접수 적용 여부는 담당 기관 확인 필요 |
| `/forms`, `/support`, 영문 대응 화면 | PASS | 구·신 사이트 “1년 병행” 미확정 약속 제거, 결제·파일·보완·결과 도움말. ko/en 모바일 2개 mock E2E |
| 원본 direct/multipart 완료 API | PASS | mock 실제 handler에서 크기·컨테이너 불일치·조회 실패·미지원 기존 형식 등 검증. 서버가 최대 1KB만 읽음 |
| 실제 B2 multipart | PASS | 17MiB 시험 WAV, 16MiB+1MiB 2파트. 브라우저 CORS·ETag, HEAD 크기, 다운로드 SHA256 일치, 해당 시험 객체 버전 삭제 확인 |
| 실제 파일 → 신청 DB 연결 → 관리자 열기 | NOT TESTED | 위 B2 시험은 앱 DB에 연결하지 않은 저장소 단독 시험. 실제 결과·필증·생성 서류 열기 포함 전체 흐름은 별도 필요 |
| 최대 4GB 부근 전송·대용량 메모리 | NOT TESTED | 실제 최대 용량 전송은 미실행. 작은 시험 전송을 대체 증거로 사용하지 않음 |
| 결제 후 보완 요청·제출·재보완·수락 | PASS / BLOCKED | 격리 SQL와 7개 mock UI E2E. 원본·결제 snapshot 불변, A/B/비회원/관리자 권한·응답 유실 재확인. 운영 migration 미적용 |
| 보완 알림 실패·재시도·이력 | PASS / BLOCKED | provider mock과 SQL lease·채널별 재시도·중복 방지·관리자 이력. 실제 업체 접수/수신/링크는 미실행 |
| 이니시스 설정·health | PASS | staging/prod 정확한 hostname 검증 공유, 위장 hostname 차단. 실제 가맹점 계약·승인 성공 증거 아님 |
| 카드 승인·실패·중복·불확실·취소/환불 | BLOCKED | 기존 결제 잠금/대사 보호 유지 및 단위 회귀. 실제 거래/취소/PG-DB 대사는 실행하지 않음 |
| 모바일 카드 | PASS / BLOCKED | 모바일 안내·무통장 선택·직접 popup 차단 2개 mock E2E PASS. 실제 모바일 카드 지원은 미구현/계약 확인 필요. PC 카드·모바일 무통장·PC 이어하기 안내, 기존 서버 차단 유지 |
| 무통장 입금 확인·부족/초과 입금·환불 | PASS / NOT TESTED | 3결제수단×7상태 및 재콜백의 격리 SQL PASS. 실제 계좌 입금·부족/초과 입금과 운영자 대사는 미실행 |
| 관리자 결제 목록 | PASS / NOT TESTED | 관리자 가드·필터·페이지네이션 정적/단위 회귀. 실제 거래 데이터로 UI/PG 대사는 미실행 |
| 부분 결과·최종 결과·필증/등급표 전달 | PASS / NOT TESTED | 방송사 부분 결과·보완·저장 실패 5개, MV 희망/공식 등급 구분 3개 mock E2E PASS. 필증 교체의 기존 객체·감사 이력 보존은 mock handler/격리 SQL PASS. 실제 결과 파일 열기→고객 수신 전체 흐름 미실행 |
| 운영 Supabase migration 이력 | BLOCKED | 실제 온사이드 project ref를 확인했으나 관리 API/CLI의 권한 부족으로 목록 조회 실패. 다른 서비스 프로젝트는 사용하지 않음 |
| Render 실제 SHA·요금제·지역·worker | BLOCKED | 실제 운영 콘솔 접근 미확인. `render.yaml`의 free/oregon/autoDeploy를 실제 운영 증거로 간주하지 않음 |
| 빌드·정적 검사·단위 회귀 | PASS / BLOCKED | 아래 최종 집계와 실행 명령에 기록. 기본 Turbopack은 실행 환경의 포트 생성 제한으로 중단되어 Webpack을 별도 확인 |

전체 URL 목록은 [라우트 인벤토리](onside-route-inventory-2026-10-24.json)에 있다. 페이지 109개, API handler 73개, 기타 HTTP handler 3개를 구분하며 영문·별칭·개발 경로를 실제 검증 수로 세지 않는다. 각 항목은 URL, 진입 조건, 행동, 상태 저장 단서, 다음 경로, 오류·빈 상태, 테스트 근거와 source hash를 포함한다. 인벤토리 작성자의 부분 PASS와 위 표의 다른 실행 증거는 구분해서 읽어야 한다.

### 1차 수정 검사 집계 (06:29 KST)

- `npm test`: **840개 중 834 PASS / 0 FAIL / 6 SKIP**, 최종 실행 약 9.15초. 기존 문구 계약 테스트를 현 정책/공유 컴포넌트에 맞게 수정한 후 전체 재실행했다.
- SKIP 6개: bundled Chromium이 필요한 DOM 검사 1개, Linux 전용 process/메모리 검사 2개, 고정 버전 문서 변환기·한국어 폰트/OCR이 필요한 3개. 설치된 Chrome의 실제 영어 경로 E2E와 구분하며 생략한 검사를 통과로 세지 않았다.
- `npm run lint`: **0 errors / 기존 9 warnings**(내부 이동의 `window.location.href`).
- 최종 `next build --webpack`: **PASS**, 코드 컴파일 20.3초, TypeScript 12.7초, 정적 페이지 85개 생성. 별도 `tsc --noEmit`도 통과했다.
- 기본 `npm run build`의 Turbopack: **BLOCKED** — 이 실행 환경의 PostCSS 자식 프로세스/포트 생성 `EPERM`. 실제 Render Docker 빌드와 같은 결과라고 단정하지 않는다.
- 보완·결제 주문·필증 이력의 **격리 PostgreSQL SQL 회귀 모두 PASS**. 운영 DB에는 미적용.
- 선택한 브라우저 **72개 unique 시나리오 PASS**. 단일 72개 실행을 뜻하지 않으며, 인증/신청/보완/공개/지원/결제·결과 묶음으로 나눠 실행했다. 실패 원인 수정 후 해당 범위를 재실행한 기록 포함.
- `git diff --check`: **PASS**. 최종 소스 검증 집계 시각: 2026-10-24 06:29 KST.

원본 로그는 로컬 `/private/tmp/glit-unit-release-final.log`, `glit-lint-release.log`, `glit-build-release.log`, `glit-supplement-sql-final.log`, `glit-payment-prereview-sql.log`와 해당 E2E outputDir에 보관했다. 장기 보관용 요약은 이 보고서와 evidence JSON이다.

재현 명령(Chrome 채널용 임시 config는 저장소 `playwright.config.ts`를 가져와 `use.channel='chrome'` 및 별도 outputDir를 지정):

```sh
npm test
npm run lint
npx tsc --noEmit --pretty false
npx --no-install next build --webpack
bash scripts/submission-supplements-sql-test.sh
bash scripts/submission-orders-sql-test.sh
bash scripts/certificate-history-sql-test.sh
bash scripts/review-docs/test-jobs.sh  # 외부 네트워크 없는 임시 PostgreSQL 컨테이너 전용
# 로컬 dev 앱을 3001에 기동한 뒤, 외부 mutation을 mock/차단하는 선택된 specs만 실행
NEXT_E2E_BASE_URL=http://127.0.0.1:3001 npx playwright test --config=/private/tmp/glit-auth-playwright.config.ts tests/e2e/auth-flow.spec.ts tests/e2e/auth-accessibility.spec.ts --workers=1
NEXT_E2E_BASE_URL=http://127.0.0.1:3001 npx playwright test --config=/private/tmp/glit-supplement-playwright.config.ts tests/e2e/submission-supplements.spec.ts --workers=1
```

실제 계정 변경이 있는 `auth-live-smoke`, 실제 발송이 있는 `email-smoke`, 전체 외부 연동 E2E를 무분별하게 실행하지 않았다. 인증/입금/PG/수신 검증을 하지 않은 항목에는 PASS를 부여하지 않았다.

### 보관 정책 후속 반영 (사용자 확인 이후)

- 한·영 파일 정책에 **음원은 각 파일의 제출일부터 1개월 / 나머지 파일·신청·결과 내역은 관리자 삭제 전까지**를 명시했다. 이메일 제출도 같은 정책을 따르며, 실제 메일함·백업 정리 절차는 운영 설정과 함께 확인해야 한다.
- 관리자 서류 변환 작업은 별도 원본·DOCX/ZIP·추출/수정 데이터에 7일 만료와 90일 이력 삭제가 있었으므로, 이번 후속 코드에서 자동 정리를 중지했다. 새 migration은 새 작업과 아직 유효한 미정리 작업의 만료일을 무기한으로 바꾼다. 기존에 만료되거나 삭제된 자료를 되살리지는 않는다.
- 처리 시간 제한, worker lease, 임시 로컬 작업 디렉터리 정리는 보관 정책과 별개로 유지한다. 새 관리자 삭제 기능이나 자동 음원 삭제를 추가하지 않았다.
- 음원 보관 기간은 사용자 확인에 따라 **각 파일의 제출일부터 1개월**로 확정했다. 보완 음원도 해당 파일의 제출일을 적용하며, 원래 파일의 보관 기산점을 새 보완 파일 때문에 다시 시작하지 않는다. 결제일·심의 완료일을 기준으로 바꾸거나 30일로 임의 치환하지 않는다. 실제 음원 분류, 만료일·삭제 이력, 이메일/백업/객체 버전 처리가 준비되기 전에는 자동 삭제를 활성화하지 않는다.
- 후속 최종 검증(2026-10-24 11:02 KST): 전체 단위 **843개 중 837 PASS / 0 FAIL / 6 SKIP**; ESLint **0 errors / 기존 9 warnings**; Webpack 빌드·TypeScript **PASS**. 한·영 파일정책 모달 390px 읽기 전용 Chrome 확인 2건, 관리자 서류 변환 화면 fixture E2E 8건, 격리 PostgreSQL 보관/권한/worker 회귀 모두 PASS. 로그: `/private/tmp/glit-retention-unit-final.log`, `glit-retention-lint-final.log`, `glit-retention-build-final.log`, `glit-retention-ui.log`, `glit-review-docs-retention-sql.log`. 기존 72개 시나리오 전체를 이번에 재실행했다는 뜻은 아니다.
- 제출일 기준을 확정한 문구는 한·영 정책 모달 390px에서 추가 확인 2건 PASS, footer ESLint PASS. 이 확인은 문구 변경 범위이며 자동 삭제 실행 검증을 뜻하지 않는다.
- 이번 후속 수정도 운영 DB/스토리지에 적용하지 않았다. 운영에는 기존 7일 정리 코드가 남아 있을 수 있으므로 migration과 새 worker를 함께 배포해야 한다.

## 3. 수정 사항과 변경 묶음

| 변경 | 고객·운영자에게 달라지는 동작 | 주요 파일 |
|---|---|---|
| 목적별 진입·홈 | 음원 방송 / MV 온라인 유통 / MV 방송사 구분, 준비물·결과·비용 단위·기간 기준 안내, 가상 예시를 접어서 하단 배치 | `src/lib/onside-content.ts`, `src/app/page.tsx`, `src/app/dashboard/new/page.tsx`, `src/features/home/*` |
| 인증·접근성 | 가입 후 안전한 원래 경로·언어 유지, 실제 8~128자 조건/보기, 정책 열람/필수 동의, 모달 초기·순환·복귀 포커스 | `src/features/auth/*`, `src/lib/use-modal-focus.ts`, 정책·문의·조회 모달 |
| 신청·파일·규격 | 자료가 없으면 제출 대기, 이메일 제목/체크리스트/처리 시작 조건, 파일 선택 키보드·터치, 오류 연결, 선택 방송사만 안내 | `album-wizard.tsx`, `mv-wizard.tsx`, `submission-preflight*`, `email-materials-notice.tsx`, `mv-submission-specs.ts` |
| 단위·지원 문구 | 방송국 N곳·앨범 1건 표기, 기존 50,000/70,000/100,000/130,000/150,000원 보존, PC 카드 범위 표시, 조회 코드를 이메일로 받기 | `album-package-label.ts`, history/detail, about, track lookup |
| 파일 확인 | 소유권·grant·snapshot 보호를 유지하면서 저장 크기 후 컨테이너 헤더 확인, 위장 확장자 차단 | `file-signature.ts`, `upload-content-verification.ts`, 원본 complete API 2개 |
| 결제·알림 | 장바구니 저장을 접수 완료로 알리지 않음, 입금·카드·PayPal 첫 결제의 초기 상태만 자료 검수 대기(PRE_REVIEW), 기존 진행/결과/완료·재콜백 상태 보존, 결제 실패/확인 필요 목록, 필수 이메일 readiness | `payments/submission.ts`, `features/submissions/actions.ts`, `admin/payments/page.tsx`, `email*`, `kakao*`, `runtime-health.ts`, `inicis/config.ts` |
| 결제 후 보완 | 별도 요청·버전·파일·관리자 수락 이력, 원본 수정 잠금 유지, 알림 시도/provider ID·실패 채널 재시도 | `submission-supplements.tsx`, `src/lib/submission-supplements/*`, API 및 신규 migration |
| 필증 결과 이력 | 교체 시 이전 객체를 삭제하지 않고 이전/현재 참조를 보존, 현재 필증 포인터와 이력의 원자적 기록, B2_PREFIX 준수 | `api/admin/submissions/[id]/certificate/route.ts`, certificate history migration |
| 운영 문서 | URL 인벤토리, 실제/모의 검증 구분, 배포·롤백·일일 점검 | 이 보고서, 인벤토리, evidence JSON, 격리 SQL script |

가입은 기존 `admin.createUser(email_confirm:true)` 흐름을 유지한다. 이를 이메일 소유 확인이 수행된 것으로 설명하지 않으며, 운영 정책에 따라 검증메일 가입을 적용할지는 별도 결정이 필요하다. 동의 버전과 서버 기록 시각은 앱 관리 메타데이터에 남긴다.

컨테이너 검사는 악성 파일 검사, 전체 디코딩 또는 방송사 적합 판정이 아니다. DOCX/ZIP 및 DOC/HWP처럼 동일한 컨테이너를 공유하는 형식도 헤더만으로 구별할 수 없다. 미지원 기존 형식은 `verification.signature='unsupported'`, `verified:false`로 구분하고 코덱/내부 내용은 `not_checked`로 반환한다.

이번 변경은 배포·push하지 않았다. 기준 브랜치는 `main`이며 로컬 검토 브랜치 `codex/onside-prelaunch-20261024`로 분리한다. 최종 커밋 해시는 작업 완료 메시지에 명시한다. 작업 시작 때부터 있던 `public/media/mv-ratings/19.png` 삭제와 `supabase/.temp/cli-latest` 변경을 덮어쓰거나 이번 수정으로 분류하지 않았다. 릴리스에는 검토한 변경만 포함해야 한다.

## 4. 실제 서비스 검증과 mock 증거

[기계 판독용 증거 요약](onside-launch-evidence-2026-10-24.json)은 자격증명·signed URL·조회 코드·고객 정보를 포함하지 않는다.

- **실제 운영 읽기:** `/api/health` 200 / ok:true / errorCount:0 / warningCount:2 재확인. B2의 비공개 ACL, 현재 온사이드 origin의 HEAD/GET/PUT와 ETag 노출을 읽었다. 설정 존재를 승인·수신 성공으로 확대 해석하지 않았다.
- **실제 제한된 저장소 시험:** 합성 WAV 17,825,792바이트를 실제 Chrome에서 2파트 PUT. ETag로 complete한 뒤 HEAD 크기와 스트리밍 다운로드 SHA256 일치. 생성한 정확한 시험 객체 버전을 제거했다. 앱 DB 행, 고객 원본, 기존 객체를 변경하지 않았다.
- **격리 DB:** 회원 A/B, 비회원 올바른/틀린 코드, 관리자 권한, 요청 간 file binding, 제출 전 PENDING 차단, 재보완 사유, 버전 이력, paid 원본 불변, 중단/늦은 확인 경쟁, 알림 lease·재시도·stale 결과 거절, 브라우저 RLS/RPC 접근 금지. 별도 주문 SQL에서는 3결제수단×7상태·카드/PayPal 재콜백·금액·claim·동시성을 검증했다. 필증 SQL에서는 2회 교체 chain, 재시도, 감사 저장 실패 rollback, 기존 결제·결과 불변을 확인했다.
- **브라우저 mock:** 인증 17건, 신청 10건, 지원 2건, 보완 7건, 공개 화면 9건, 장바구니/주문 17건, 방송사 결과 5건, 모바일 결제 안내 2건, MV 등급 3건으로 총 72개 unique 시나리오. 일부 실패는 테스트 selector·단계 포커스 대기·CSS zoom 측정식을 바로잡아 해당 범위를 다시 실행했다. 외부 PG/메일/카카오/신청 DB의 성공 증거로 사용하지 않는다.
- **미실행:** 실가입·지정 수신자 수신함, PC 회원/비회원 실제 승인·취소, 은행 입금, 4GB 부근 업로드, 실제 원본의 관리자 열람, 필증·등급표·DOCX/PDF 최종 파일 열기, Safari/실기기, 실제 운영 worker 부하.

저장 구조: Supabase는 Auth와 신청/주문/결제/파일 메타데이터·권한의 기준이다. 고객 원본과 보완·필증/심의 문서 산출물은 B2 경로를 사용하며 브라우저 접근은 권한 확인 후 signed URL을 받는다. 공개 배너 업로드의 Supabase Storage 경로와 `public/` 정적 이미지는 고객 비공개 원본과 구분된다. 관리자 파일 다운로드에는 기존 Supabase Storage 파일을 위한 300초 signed URL fallback도 남아 있다. 스토리지 서비스를 교체하지 않았다.

## 5. 남은 차단 항목과 필요한 접근

1. **온사이드 Supabase 프로젝트 권한:** 해당 프로젝트 관리 계정에서 기존 migration 이력을 먼저 확인한다. MCP에 보인 다른 서비스 프로젝트에 적용하지 않는다. 서비스 role 키를 채팅으로 전달하지 말고 기존 환경/프로젝트 콘솔의 안전한 설정을 사용한다.
2. **Render 실제 배포 정보:** 온사이드 서비스 콘솔에서 배포 SHA, branch, 자동배포, 플랜·지역, 도메인, 문서 변환기/worker 상태를 확인한다. 실제 Free이면 유휴 정지와 재기동이 첫 진입/결제 callback에 미치는 영향을 [Render 공식 제한](https://render.com/docs/free)과 대조한다. 요금제나 비용을 변경하지 않았다.
3. **알림 설정과 지정 테스트 수신자:** Render 환경의 Resend API key·검증된 발신 도메인을 확인하고 Supabase Auth SMTP 경로와 구분한다. 지정 수신자에게만 접수/결제/보완/결과/조회 코드/비밀번호 복구를 시험하고 provider ID → 수신함 → 링크 권한을 대조한다. 카카오는 선택 채널 설정과 provider idempotency 지원을 확인한다. [Supabase Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Resend 중복 방지](https://resend.com/docs/dashboard/emails/idempotency-keys).
4. **실결제 승인 범위:** 온사이드 가맹점, 테스트할 심의 주문, 금액, 카드수단·회원/비회원, 즉시 취소 담당자와 취소 계획을 확정한 뒤 실행한다. 심의 접수의 PG 자동 환불은 이번에 구현하지 않았다. 기존 `requestRefund` 호출은 다른 구독 상품 경로이며 심의 환불 검증의 대체 증거가 아니다. 연결된 묶음 주문은 개별 REFUNDED 수정이 차단된다. PG 관리자 수동 취소와 앱 주문 전체 상태 반영 절차를 확정하고, REFUNDED 표시가 같은 사건을 가리키는지 반드시 대조한다. [이니시스 일반결제](https://manual.inicis.com/pay/stdpay_pc.html), [취소](https://manual.inicis.com/pay/cancel.html).
5. **직접 접수 규격·보관 실행 기준:** KBS 직접 제출 담당 경로의 최신 규격은 확인이 필요하다. [RIAK FAQ](https://review.riak.or.kr/community.asp?inx=3)는 직접 경로 확정 근거로 사용하지 않았다. 보관 기간과 기산점은 음원 제출일부터 1개월/나머지 관리자 삭제 전까지로 확정됐다. 실제 제출 시각 기록과 이메일·백업·스토리지 버전을 포함한 삭제 절차는 별도 구현·운영 확인이 필요하다. 현재 album 첨부의 `kind=AUDIO`와 보완 grant의 `upload_kind=audio`에는 문서·ZIP도 포함될 수 있으므로 그 값만으로 만료 삭제하면 안 된다. 실제 음원 형식을 확인하고 혼합 ZIP은 자동 분류에서 제외해야 한다. 미정인 환불률을 임의 설정하지 않는다.
6. **실제 전 과정 시험:** 식별 가능한 시험 계정/신청과 파일로 회원 A/B/비회원/관리자 접근을 교차 확인한다. 최대 용량 부근 파일, 실제 결과·필증/등급표·생성 문서 열기, 실제 수신, 재시도/중복/불확실 결제 대사까지 끝낸 후 오픈 판정을 갱신한다.

## 6. 배포 변경 묶음·migration·롤백

적용 후보는 이번 소스/테스트/문서와 다음 **신규 migration 4개**다.

| 적용 순서 | 파일 | 목적·전제 |
|---|---|---|
| 1 | `20261023210008_submission_supplements.sql` | 보완 요청/버전/파일/알림 감사 테이블과 service-role RPC. 기존 multipart grants(0081), submissions/events/profiles 필요 |
| 2 | `20261023212202_payment_pre_review.sql` | 입금·카드·PayPal 첫 결제의 초기 상태만 PRE_REVIEW. 기존 승인·claim·금액·snapshot·주문 잠금 유지. 기존 0076/0097/0098 권한·주문 구조 확인 필요 |
| 3 | `20261023212253_certificate_result_history.sql` | 기존 events에 details JSONB와 관리자 필증 기록 RPC 추가. 기존 필증 컬럼(0037) 필요 |
| 4 | `20261024015746_review_documents_admin_retention.sql` | 관리자 문서 변환 작업의 신규 만료 기본값을 infinity로 변경하고 아직 유효하며 purge되지 않은 기존 작업만 만료 해제. 이미 만료·정리된 데이터는 복원하지 않음. 기존 0094/0103/0105 구조 확인 필요 |

파일은 모두 `supabase/migrations/`에 있으며 운영에는 미적용이다. 기존 신청·결제·파일의 일괄 갱신/삭제를 실행하는 migration이 아니다.  운영 이력을 보지 못했으므로 `supabase db push`로 모든 로컬 migration을 일괄 적용해서는 안 된다.

배포 순서:

1. 실제 온사이드 대상·현재 SHA·migration 이력을 확인하고 DB 백업/PITR 복구 시점, storage metadata/객체 버전, 기존 환경 설정을 확보한다. 비밀값을 Git에 넣지 않는다.
2. 별도 검증 환경에서 기존 schema와 신규 migration의 호환성을 확인한다. service-role 전용 RPC, anon/auth 직접 접근 거부, 기존 결제·파일 권한 회귀를 확인한다.
3. 이메일/도메인/PG callback/Auth redirect/B2 CORS를 실제 운영 주소와 대조한다. readiness 503 원인을 해결한다. 카카오 미설정은 선택 채널 경고로 구별한다.
4. 관리자 문서 변환 worker와 웹 dispatcher의 작업을 잠시 중지한 상태에서 승인된 신규 migration을 적용하고 이력/권한을 기록한다. 보관 정책을 반영한 소스를 배포한 뒤 해당 버전의 worker만 재개한다. 구버전 worker가 만료 데이터를 정리하는 경쟁 조건을 피해야 한다. 신규 migration 적용 전 UI는 보완 기능을 준비 중으로 안내할 수 있으나 이는 완성 상태가 아니다.
5. `/healthz`, `/readyz`, `/api/health`, KO/EN 신청·조회·보완을 smoke test한다. 지정 시험 대상의 파일 연결/관리자 열기/알림 수신과 승인된 결제·취소를 대조한다. 기본 Docker/Turbopack 빌드는 실제 배포 환경에서도 확인한다.
6. 배포 SHA, 승인된 시험 데이터 ID, provider 거래/메시지 ID, 결과를 비공개 운영 기록에 남긴다. 전체 오픈은 차단 항목 해소 후 진행한다.

롤백은 우선 앱을 직전 검증 SHA로 되돌린다. 보완 테이블과 필증 이력 컬럼은 추가형이므로 접수된 보완 이력을 보호하기 위해 **drop/전체삭제하지 않는다**. 신규 쓰기를 중단하고 실패 건을 식별한 뒤 호환 수정 또는 개별 복구한다. 결제 검수 상태 RPC 변경을 되돌릴 필요가 있다면 직전 백업의 함수 정의를 확인한 별도 forward migration으로 진행하고, 이미 기록된 진행 상태는 임의로 일괄 변경하지 않는다. 이미 생성한 B2 객체와 결제 거래를 코드 rollback만으로 삭제/취소하지 않는다. migration의 실패 원인과 적용 이력을 확인하기 전 재실행·repair·reset을 하지 않는다. 구버전 문서 worker로 되돌리면 7일/90일 자동 정리가 다시 실행될 수 있으므로, 보관 정책 수정이 유지됨을 확인하기 전에는 worker를 재개하지 않는다.

보완 업로드가 중단되어 완료 여부가 불확실하면 먼저 재확인한다. ACTIVE/ABORTING 만료 grant는 기존 정리 경로가 처리하지만, 완료된 고아 객체는 자동 일괄 삭제하지 않는다. request/revision/file/grant 식별자를 대조하고 확정한 보관 정책에 따라 개별 정리한다. 알림의 provider 응답이 불확실하면 재전송 전 공급자 기록을 확인한다. Resend idempotency 보존은 24시간이며 모든 공급자가 영구 중복 방지를 보장하는 것은 아니다.

## 7. 일일 운영 점검

| 확인 대상 | 확인 위치·처리 |
|---|---|
| 미입금·금액 불일치 | 접수 관리의 결제 대기/입금 대기와 은행 거래를 주문별 대조. 부족·초과 입금은 사유를 기록하고 임의 PAID 처리하지 않음 |
| 결제 확인 중 | `/admin/payments?filter=attention`. 주문번호/TID로 PG 거래와 DB 주문/신청 대조. 확인 전 재결제 안내 금지 |
| 자료 미제출 | 이메일 나중 제출 신청의 접수번호와 수신 메일·파일을 대조. 수신과 자료 검수·방송사 접수 시점을 따로 기록 |
| 보완 대기 | 관리자 접수 상세의 보완 내역에서 요청 항목/버전/전송 상태/검수 사유 확인. 검증된 파일을 열고 수락·재보완 처리 |
| 알림 실패 | 보완 이력의 채널별 결과·시도 시각/provider ID 확인. 수락된 채널은 중복 발송하지 않고 실패 채널만 재시도. 실제 수신은 별도 확인 |
| 부분·최종 결과 | 방송사·트랙별 결과와 사유, 고객 화면의 완료 분모, 필증/등급표 파일 내용·권한을 대조. 일부 결과를 전체 완료로 표시하지 않음 |
| 취소·환불 | PG 관리자 취소 상태/금액/일시와 앱 REFUNDED 및 처리 이력 대조. 앱 상태만으로 실제 환불을 확정하지 않음 |
| 저장소·작업 실패 | 만료 multipart, DB 연결 실패, 문서 생성 실패, 보완 고아 객체를 개별 확인. 음원 만료 처리 시 파일 바이트만 대상으로 하며 신청·결과·결제 이력은 유지. 문서·영상·결과 및 식별 불명 파일을 음원으로 간주해 삭제하지 않음 |
| 서비스 준비 상태 | readiness·메일/카카오 provider 오류·문서 worker·콜백 실패 점검. 실패를 정상 결제/결과 저장 상태로 덮어쓰지 않음 |
