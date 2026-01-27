## 로그인 상태 탐색 지연 진단/개선 요약 (2026-01-27)

### 진단 (코드 베이스 기반 정적 분석)
- `src/app/dashboard/page.tsx` & `src/app/mypage/page.tsx`가 SSR 단계에서 다음을 매 요청 실행:
  - supabase `auth.getUser`
  - `submissions` 2회 쿼리(ALBUM, MV 각각 최대 5건)
  - 해당 ID 전체에 대해 `station_reviews` 조인 쿼리 1회  
  → 로그인 상태에서 페이지 전환 시마다 최소 3번 DB round-trip + 결과 직렬화가 발생.
- 로그아웃 상태에서는 위 쿼리가 실행되지 않아 체감 속도 차이가 발생.
- 전역 `SiteHeader`는 `auth.getUser`만 호출(경량)하므로 주요 병목이 아님.

### 개선 내용
1) **지연 로딩**  
   - 대시보드/마이페이지의 진행 현황 데이터 로딩을 SSR에서 제거하고, 클라이언트 전환 후 `fetch /api/dashboard/status` 한 번만 호출하도록 변경.  
   - 응답은 사용자 세션 범위 캐시(`Cache-Control: private, max-age=30`) + 클라이언트 상태 보유로 재방문 시 재사용.
2) **경량 API 분리**  
   - 신규 `GET /api/dashboard/status`: 필요한 컬럼만 select, 최대 5건 + 해당 ID에 대한 station_reviews만 조회.
3) **UI 안정성**  
   - 로딩/에러 상태 메시지 추가(스켈레톤 대체용 간단 텍스트)로 UX 유지.

### 예상 효과 (정량 추정)
- **이전**: 로그인 상태에서 대시보드/마이페이지 진입·탭 이동마다 3개 DB 쿼리 + SSR 직렬화.
- **이후**: 최초 진입 시 클라이언트에서 1회 API 호출만 수행, 동일 세션에서 재방문 시 캐시 재사용(30초 이내). SSR 단계의 DB 호출 제거 → TTFB/DOMContentLoaded가 로그아웃 상태에 근접.

### 남은 체크 포인트
- 필요 시 `/api/dashboard/status` 응답에 페이징 파라미터 추가로 확장.
- 다른 레이아웃/가드에서 무거운 preload가 없는지 정기 점검.
