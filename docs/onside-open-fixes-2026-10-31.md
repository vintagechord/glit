# 온사이드 오픈 전 최종 점검 조치 (2026-10-31)

2026-10-31 최종 점검에서 확인한 8개 항목을 한 번에 반영했다. 고객 흐름(회원가입 → 심의 신청 → 결제)과 운영 절차에 영향이 있는 변경만 기록한다.

## 1. 모바일 카드 결제 (INIpayMobile)

- 모바일 브라우저의 카드 결제는 KG이니시스 모바일 일반결제(INIpayMobile)로 처리한다. PC는 기존 INIStdPay를 그대로 사용한다.
- 공식 규격: [이니시스 웹표준/모바일 연동가이드](https://manual.inicis.com/pay/stdpay_pc.html#mo). 요청 `POST https://mobile.inicis.com/smart/payment/`(EUC-KR 폼, 최상위 이동), 인증결과는 `P_NEXT_URL`로 POST 또는 GET, 승인은 `P_REQ_URL`에 `P_MID`·`P_TID` POST, 망취소는 `{P_REQ_URL 호스트}/smart/payNetCancel.ini`.
- 위변조 방지 `P_CHKFAKE = BASE64(SHA512(P_AMT + P_OID + P_TIMESTAMP + HashKey))`를 매뉴얼 예시 값으로 검증했다. `P_RESERVED=centerCd=Y&amt_hash=Y`, `P_CHARSET=utf8`을 함께 보낸다.
- 승인 URL은 `idc_name`과 `https://(fc|ks|stg)mobile.inicis.com/smart/payReq.ini`가 일치할 때만 호출한다. 승인 전 claim, 금액·주문번호·MID·지불수단 대조, 불일치 시 망취소, 결과 불확실 시 `APPROVAL_UNCERTAIN` 보존 등 PC와 같은 안전장치를 적용했다.
- 새 경로: `src/lib/inicis/mobile.ts`, `src/app/api/inicis/mobile/return/`. 주문 생성 API는 `channel: "mobile"`을 받는다.
- **운영 설정 필요:** Render 환경변수 `INICIS_MOBILE_HASH_KEY_PROD`에 이니시스 가맹점관리자 ▶ 상점정보 ▶ 계약정보 ▶ KEY 정보 ▶ **모바일 금액위변조 Hash Key** 값을 등록해야 한다. 등록 전까지 모바일에서는 기존처럼 무통장 입금만 안내하며, `/api/health`에 `inicis prod mobile env` 경고가 표시된다. 이니시스 계약에 모바일 결제가 포함되어 있어야 한다.

## 2. 카드 승인 잠금 자동 해소

- 승인 요청 직전에 걸리는 `APPROVAL_IN_PROGRESS` 잠금이 프로세스 중단으로 남으면, 10분 뒤 `expire_stale_inicis_approval_claims()`가 `APPROVAL_UNCERTAIN`으로 전환하고 주문을 `REVIEW_REQUIRED`로 투영한다. pg_cron `onside-stale-approval-claims`가 5분마다 실행한다.
- 전환된 건은 기존 `/admin/payments`의 승인 확인 절차(이니시스 거래 내역 대조 후 승인·미승인 기록)로 처리한다. 시간 경과만으로 실패 처리하지 않는다.
- `submission_payments.approval_claimed_at` 컬럼을 추가했다.

## 3. 무통장 입금자명·입금 예정일

- 장바구니 무통장 입금 단계에서 입금자명(필수, 40자)과 입금 예정일(오늘부터 2주 이내)을 받는다. `submission_orders.depositor_name`, `deposit_due_at`에 저장하고 주문내역·관리자 접수 상세·입금 안내 메일에 표시한다.
- 예정일이 지나도 신청서는 보관되며 주문내역에 "기한 지남"으로 표시한다. 자동 취소는 하지 않는다.
- 입금 대기 주문을 장바구니로 돌려 다시 결제할 때는 "아직 입금하지 않았습니다" 확인란을 체크해야 진행된다.

## 4. 비회원 작성 중 초안의 로그인 승계

- 비회원이 작성하던 DRAFT/PRE_REVIEW 신청서는 로그인 후 같은 브라우저에서 신청 화면을 열면 `claim_guest_draft_submissions`로 계정에 연결된다. 정확한 비회원 토큰을 제시한 경우에만 이동하며, 결제 대기·주문 생성 건은 대상이 아니다.

## 5. MV 초안 생성 시점과 빈 초안 정리

- MV 신청 화면은 방문만으로 서버 초안을 만들지 않고, 신청서 작성 단계(3단계)에 들어갈 때 생성한다.
- 24시간 이상 지난 빈 초안(제목·아티스트·접수자·파일·트랙·업로드·결제·주문이 전혀 없는 DRAFT)은 pg_cron `onside-purge-empty-drafts`가 매시간 삭제한다. 내용이 하나라도 있으면 삭제하지 않는다.

## 6. 비회원 조회 코드 안내

- 비회원 신청서가 장바구니에 담기는 시점에 접수자 이메일로 조회 링크와 조회 코드를 보낸다(`cart-saved:<접수ID>:<이메일>` 키로 1회). 장바구니 화면에도 조회 코드 안내를 표시한다.

## 7. 가입 인증 재발송 안내

- 인증을 마치지 않은 이메일로 다시 가입하면 안내문과 함께 가입 화면에서 인증 메일 재요청 링크를 보여준다. 자동 재발송은 하지 않는다. 이미 인증된 이메일이면 로그인·비밀번호 찾기 링크를 보여준다.

## 8. 영문 인증 화면, 검색 엔진 파일, 헬스체크

- `/en` 로그인·가입·비밀번호 찾기·재설정·이메일 확인 화면의 문구와 서버 응답 메시지를 영어로 제공한다.
- `src/app/robots.ts`, `src/app/sitemap.ts`를 추가했다. 회원·관리자·콜백·토큰 경로는 색인에서 제외한다.
- Render `glit` 서비스의 헬스체크 경로를 `/api/health`로 설정했다(`render.yaml`과 일치). 사이트를 깨우는 외부 핑은 사용자가 운영 중이다.

## 검증

- 단위 테스트: 모바일 해시·파라미터·응답 파싱·수신 처리기, 무통장 상세 규칙, 인증 화면 영문 응답.
- 격리 PostgreSQL: `scripts/submission-orders-sql-test.sh`에 새 마이그레이션 적용과 `tests/sql/open-fixes.sql`(잠금 만료, 입금 상세, 초안 승계, 빈 초안 정리)을 추가했다.
- 브라우저 e2e: 모바일 결제 수단 선택과 게이트웨이 폼 전송, 무통장 입력, 장바구니 결제 흐름.
- 실제 이니시스 모바일 결제는 Hash Key 등록과 계약 확인 후 소액 실결제로 확인해야 한다.
