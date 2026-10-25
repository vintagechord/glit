# 온사이드 오픈 준비 배포 기록 (2026-10-26)

- 운영 소스: `main` `d5340bf` (PR #8 `322ef18` + 빌드 수정 PR #9). Render 배포 `dep-dbf47bavcj2c73epa690` Live, `/api/health` 오류 0건(카카오 선택 채널 경고 1건), `/readyz` 200.
- 운영 DB 적용 마이그레이션: `20261026090000_station_review_status_preservation.sql`, `20261026120000_admin_payment_resolution.sql`. 2026-10-24 이메일 마이그레이션 3건은 `supabase migration repair`로 이력에 기록했다. `20261020092015_magazine_three_credit_requests.sql`도 같은 날 적용했다(아래 매거진 절). 이제 로컬과 운영의 마이그레이션 이력이 일치한다.
- 첫 배포 `dep-dbf465on74is73bfvg70`은 영문 상세 페이지의 `dynamic`/`revalidate` 재내보내기 때문에 빌드에 실패했다. 라우트 설정은 각 page 파일에 직접 선언해야 한다(04de307과 동일).
- 검증: `tsc` 통과, ESLint 오류 0, 단위 테스트 1034 통과, 격리 PostgreSQL 회귀(주문·결제, 방송사 심의) 통과, 로컬 Turbopack 운영 빌드 통과. Playwright는 `localhost:3001` 개발 서버 기준으로 수정한 스펙 전부 통과. `127.0.0.1`로 접속하면 Next.js 개발 서버가 교차 출처 자산을 차단하므로 `NEXT_E2E_BASE_URL=http://localhost:3001`을 사용한다.
- 현재 UI와 어긋났던 기존 e2e 스펙을 정합화했다(고객 동작 결함 아님): 발매 전 앨범의 작성 방식 선택 단계, URL 오류의 인라인 표시, 단계 이동 시 헤더 아래 스크롤, 카드 결제창을 닫은 주문의 실제 상태(연결 유지·UNPAID)와 승인 확인 중 상태의 주문내역 이동, 방송사 상태 라벨("접수완료", "보완 요청"), 뮤직비디오 적격에는 라디오 신청 가이드를 제공하지 않는 현재 정책. `health.spec.ts`는 배포 환경 전용이므로 localhost 대상일 때 건너뛴다.
- 신청 단계 이동 스크롤 보강: 단계가 바뀔 때의 부드러운 스크롤이 같은 프레임의 다른 스크롤(눌린 버튼을 화면에 맞추는 스크롤 등)에 취소되면 새 단계가 신청서 중간에 멈췄다(390px MV "이전 단계"에서 약 절반 재현, PR 이전 코드에서도 동일). `use-submission-step-scroll.ts`가 0.9초 뒤 위치를 확인해 어긋난 경우에만 한 번 바로잡는다. 그 사이 사용자가 스크롤·터치·키 입력을 하면 개입하지 않는다.
- `tools/onside-desk`(Mac 심의 데스크 소스)를 저장소에 포함했다. 생성 번들(`manual-document-parser.mjs`, `screening-engine.mjs`)은 ESLint 대상에서 제외한다. 데스크 테스트는 `node --test "tools/onside-desk/**/*.test.mjs"`로 실행한다. `public/app.js`는 설치 앱과 소스 해시를 대조하므로 경고 정리를 위해 수정하지 않았다.

## 매거진 3크레딧 마이그레이션

`20261020092015_magazine_three_credit_requests.sql`은 보류 사유가 기록된 적이 없고, [배포 문서](magazine-credit-pricing-deployment.md)상 릴리스와 함께 적용하는 것이 원래 절차였다. 격리 PostgreSQL 검증(`scripts/magazine-credits-sql-test.sh`) 통과 후, 사용자 허용을 받아 2026-10-26에 `supabase db push --include-all --linked`로 운영에 적용했다(적용 대상은 이 파일 하나뿐임을 dry-run으로 확인).

적용 후 운영 확인(읽기 전용):

- 기존 요청 3건(REQUESTED)은 `credits_spent = 1`로 보존됐다.
- `credits_spent` 기본값 3, NOT NULL.
- 익명 키로 `create_magazine_request` 호출 시 `42501 permission denied`, 행 수 변화 없음.
- `/magazine`, `/en/magazine` 200.

이제 매거진 신규 요청이 3크레딧으로 다시 열린다. 이후 새 마이그레이션은 `supabase db push --linked`로 일반 적용하면 된다.
