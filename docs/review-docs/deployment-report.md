# 온사이드 운영 반영 기록

2026-09-07 사용자가 운영 배포를 승인했다.

- Supabase resume 후 Auth health 및 상품 catalog API: HTTP 200.
- 운영 DB dry-run: 0094만 미적용. 0094 적용 완료, 추가 테이블 4개 정상 조회.
- B2: 기존 비공개 버킷과 키를 유지하고 B2_PREFIX 아래 전용 작업 경로 사용.
- 운영 Render 웹: glit / https://glit-b1yn.onrender.com / main 자동 배포.
- 운영 메일 환경변수 존재 및 /api/health email 검사 통과.
- 워커용 기존 Supabase/B2 변수 9개를 onside-review-docs 환경 그룹으로 준비.
- 웹 최신 코드 배포 및 배포 후 검증 진행 중.
- 별도 워커 신규 개설 및 실제 계정·메일 수신 검증은 아직 완료하지 않았다.
