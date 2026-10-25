# 온사이드 오픈 준비 배포 기록 (2026-10-26)

- 운영 소스: `main` `d5340bf` (PR #8 `322ef18` + 빌드 수정 PR #9). Render 배포 `dep-dbf47bavcj2c73epa690` Live, `/api/health` 오류 0건(카카오 선택 채널 경고 1건), `/readyz` 200.
- 운영 DB 적용 마이그레이션: `20261026090000_station_review_status_preservation.sql`, `20261026120000_admin_payment_resolution.sql`. 2026-10-24 이메일 마이그레이션 3건은 `supabase migration repair`로 이력에 기록했다. `20261020092015_magazine_three_credit_requests.sql`은 의도적으로 미적용 상태이며, 새 마이그레이션을 push할 때는 이 파일을 잠시 폴더 밖으로 옮긴 뒤 복원한다.
- 첫 배포 `dep-dbf465on74is73bfvg70`은 영문 상세 페이지의 `dynamic`/`revalidate` 재내보내기 때문에 빌드에 실패했다. 라우트 설정은 각 page 파일에 직접 선언해야 한다(04de307과 동일).
- 검증: `tsc` 통과, ESLint 오류 0, 단위 테스트 1034 통과, 격리 PostgreSQL 회귀(주문·결제, 방송사 심의) 통과, 로컬 Turbopack 운영 빌드 통과. Playwright는 `localhost:3001` 개발 서버 기준으로 수정한 스펙 전부 통과. `127.0.0.1`로 접속하면 Next.js 개발 서버가 교차 출처 자산을 차단하므로 `NEXT_E2E_BASE_URL=http://localhost:3001`을 사용한다.
- 미수정 e2e(현재 UI와 어긋난 기존 스펙, 고객 동작과 무관): `album-release-flow.spec.ts`(발매 전 작성 방식 선택 라디오, URL 오류 대화상자, 1440px 뷰포트), `submission-detail-checkout.spec.ts`(결제 확인 대기 상태의 버튼 라벨), `station-review-results.spec.ts`·`radio-request-dialog.spec.ts`(방송사 상태 라벨), `health.spec.ts`(로컬 환경 이메일 설정).
