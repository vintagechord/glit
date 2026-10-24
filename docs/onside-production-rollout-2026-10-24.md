# 온사이드 운영 배포·검증 진행 기록

기록일: 2026-10-24 KST. 서비스명은 **온사이드**이며, 저장소·로컬 폴더·기존 Render 및 Supabase 프로젝트 식별자는 `glit`이다.

## 현재 상태

| 항목 | 상태 | 근거 |
|---|---|---|
| 운영 DB 변경 | PASS | `rwysjsmxtpuqekeltwxi`에 신규 migration 4개를 한 트랜잭션으로 적용. 기존 105개에서 109개로 확인 |
| DB 권한·schema 검증 | PASS | 보완 테이블 4개, 보완/필증 RPC, events.details, 문서 작업 infinity 기본값 확인. anon의 새 테이블 HEAD 접근은 4/4 HTTP 401 |
| 소스 업로드 | PASS | 사용자 공개 push 승인 후 `c38a072564da22ac0b0c9173cacb3cae294327bc`까지 GitHub 릴리스 브랜치에 반영 |
| 배포 PR | 준비 완료 | [PR #1](https://github.com/vintagechord/glit/pull/1), main 기준 충돌 없음. 아직 병합하지 않음 |
| 운영 앱 | 기존 버전 유지 | Render 콘솔에서 `3811f942233e5dd4890cc2c7efa5ba50a9503b3f`가 Live임을 확인. 사용자가 메일 연동을 보류하기로 하여 수동 모드로 신규 앱 배포 준비 중 |
| Render 실제 플랜 | Free 확인 | 콘솔의 서비스 플랜을 직접 확인. 유료 전환하지 않음 |
| 알림 환경 | 사용자 결정으로 보류 | `NEXT_PUBLIC_EMAIL_DELIVERY_MODE=manual`로 자동메일을 중지하고 직접 조회·고객센터 안내. 기존 키 값은 표시·복사하지 않음 |
| 온사이드 발신 도메인 | 추후 진행 | 사용자가 도메인 구매·이메일 연동을 나중으로 미루도록 지시. 기존 onrender 주소로 배포 |
| 아트멜론 도메인 사용 | 금지 | 최종 사용자 지시에 따라 `auth.artmelon.co.kr`을 온사이드에 사용하지 않음. 발신 설정 적용·메일 발송 0회 |
| 실제 결제·환불 | 사용자 직접 수행 | 사용자가 코드·구조 점검 후 인계하도록 변경. 에이전트의 실제 PG 승인·취소 0회 |
| 실제 알림·결과 전달 | 메일은 보류, 앱 조회 검증 예정 | 메일 실제 수신은 이번 범위에서 제외. 앱 배포 후 직접 조회·파일 접근 검증 |

현재는 **운영 배포 완료 상태가 아니다**. DB 변경과 배포 대상 소스 준비를 마쳤으며, 수동 이메일 모드 앱 배포 및 직접 결과 조회 검증이 남아 있다.

## 반영한 DB 변경과 복구 자료

다음 4개 파일의 SQL과 migration 이력을 같은 트랜잭션에 기록했다. 기존 함수 정의 MD5와 migration 105개를 실행 전 검사했고, 실행 중 오류가 발생하면 전체가 rollback되도록 구성했다.

1. `20261023210008_submission_supplements.sql`
2. `20261023212202_payment_pre_review.sql`
3. `20261023212253_certificate_result_history.sql`
4. `20261024015746_review_documents_admin_retention.sql`

변경 전 결제 함수 3개의 실제 본문은 기존 로컬 0076/0097과 동일했다. 현재 진행 중인 문서 작업 0건, 만료됐지만 미정리인 작업 0건, 보관 기한 갱신 대상 0건을 확인했다. 고객 행을 조회하거나 원본 파일을 삭제하지 않았다.

변경 전 함수·migration 버전·이전 만료 기본값을 CSV로 내려받았다. 원본은 로컬 Downloads의 `Supabase Snippet Untitled query.csv`, 가공 사본은 `/private/tmp/onside-production-backup-20261024.json`이다. 가공 사본 SHA256은 `cf973adc020fff3d410aa1a1af4c796e4400c73dad8d8eb2e229e7692b387315`다. 이는 변경한 정의의 복구 자료이며 전체 고객 DB/스토리지 백업이라고 주장하지 않는다.

복구 SQL `/private/tmp/onside-production-function-rollback-20261024.sql`은 기존 함수 3개와 작업 만료 기본값을 복구하는 범위다. 신규 보완·필증 이력 테이블을 삭제하거나 고객·결제 기록을 되돌리는 용도가 아니다. 코드 rollback 시 구버전 worker의 7일/90일 자동 정리가 재개되지 않도록 별도 확인해야 한다.

## 무료 메일 설정 진행 상태

[Resend 공식 무료 플랜 안내](https://resend.com/changelog/three-domains-on-the-free-tier)는 인증 도메인 3개를 지원한다. 현재 계정의 기존 인증 도메인은 아트멜론용이므로 온사이드에는 사용하지 않는다.

기존 `onside17.com`의 `notify` 발신 도메인을 Resend에 준비했으나, 가비아 DNS 관리툴은 이 도메인을 퍼스트몰 고객센터를 통해 변경하도록 제한했다. DNS 레코드 저장은 실행하지 않았다. `mail.onside17.com`은 기존 Hiworks CNAME이므로 변경하지 않았다. 준비한 `notify.onside17.com`은 인증 대기 상태의 미사용 항목이며 온사이드 발신 주소로 설정하지 않았다.

사용자가 별도 온사이드 도메인을 새로 등록하기로 했으므로, 이후 사용자가 도메인 구매·메일 연동 자체를 보류하도록 지시했다. 현재 배포는 자동 메일 없이 직접 조회와 고객센터 안내를 사용하는 수동 모드다. 향후 도메인이 준비되면 해당 도메인의 인증 레코드와 `RESEND_FROM`을 설정한다. 도메인·메일·호스팅의 유료 플랜을 신청하거나 결제하지 않았다. 도메인 구매는 사용자가 직접 진행한다.

## 결제·환불 코드 검토와 사용자 검증 인계

- 금액은 서버 상품/주문 데이터에서 계산한다. 카드창 인증 성공과 최종 승인 성공은 별개다.
- 승인 claim, 금액·소유권 검사, 결제 snapshot 및 불확실 승인 잠금을 유지했다. 실제 운영 함수도 초기 결제 상태만 `PRE_REVIEW`로 전환하며, 기존 진행·결과·완료 상태와 재콜백 상태는 유지한다.
- 모바일 카드는 기존 서버 차단을 유지한다. 실제 카드 시험은 PC를 사용하고, 모바일은 무통장 안내를 확인한다.
- 사용자 시험 시 시험용임이 표시된 신청 1건을 만든 뒤 주문번호·TID·금액을 PG 거래, 앱 주문/신청 상태, 관리자 결제 목록과 대조한다. `/admin/payments?filter=attention`의 불확실 거래는 재결제 전에 PG 기록을 확인한다.
- **심의 주문의 실제 PG 환불 API는 현재 없다.** `requestRefund` 호출은 다른 구독 상품 경로에만 존재한다. 이를 심의 취소 시험의 대체 경로로 사용하지 않는다.
- 관리자 화면의 `REFUNDED` 표시만으로 실제 환불 성공을 판정하지 않는다. 주문에 연결된 개별 신청의 결제 상태 수정은 차단된다. PG 관리자 전액 취소 결과와 주문 전체의 상태 반영·이력을 대조하는 운영 절차는 추가 확인이 필요하다.

관련 코드: `src/lib/inicis/config.ts`, `src/lib/inicis/api.ts`, `src/lib/submission-orders.ts`, `src/lib/admin/order-payment.ts`, `src/app/admin/payments/page.tsx`, `supabase/migrations/20261023212202_payment_pre_review.sql`.

## 배포 전 최신 검사

전체 단위 848개 중 **842 PASS / 0 FAIL / 6 환경 의존 SKIP**, 프로덕션 Webpack 빌드·타입 검사 PASS. 필증 다운로드 우회 수정의 신규 5개와 기존 필증 이력 3개 회귀 PASS, 해당 파일 ESLint 및 diff 검사 PASS.

이 검사는 실제 PG 거래·메일 수신함 도착·실제 결과 파일 전달 성공의 대체 증거가 아니다. 실제 배포와 전달 결과는 이후 이 기록에 추가한다. 기존 로컬 변경 `public/media/mv-ratings/19.png` 삭제와 `supabase/.temp/cli-latest`는 이번 릴리스에 포함하지 않았다.

## 이메일 보류 배포 추가 검사

사용자 결정에 따라 `NEXT_PUBLIC_EMAIL_DELIVERY_MODE=manual`을 빌드·런타임 공통 플래그로 추가했다. 7개 메일 함수는 유효한 키가 있어도 네트워크 호출 없이 보류를 반환한다. 관리자 결과 저장은 유지하고 자동메일 보류와 실제 발송 완료를 구분한다. 직접 조회와 기존 정상 복구 링크를 유지하며, 신규 복구 메일·조회 코드 메일 요청은 고객센터로 안내한다.

전체 단위 **852개 중 846 PASS / 0 FAIL / 6 환경 의존 SKIP**, manual 모드 프로덕션 Webpack 빌드·타입 검사 PASS, ESLint 0 errors / 기존 9 warnings. 기존 인증 17개와 manual 한국어·영어 4개 브라우저 회귀 PASS. 실제 발송·실결제는 실행하지 않았다.
