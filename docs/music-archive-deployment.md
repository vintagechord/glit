# 내 음악 관리 운영 배포 기록

> 최신 국내 검색·실제 앨범 가져오기와 초성 제안은 [2026-09-08 후속 변경](music-archive-domestic-update.md)을 참고하세요. 아래 기존 배포 기록의 MusicBrainz 기본 검색/회원 권한 카드 설명은 후속 변경으로 대체됩니다.

2026-09-08 사용자가 운영 DB 적용과 배포를 승인했다. 19:43 KST 최종 운영 검증을 완료했다.

## 반영 대상

- 운영 코드: `9eff20a44f22ff30ed502c1a41019f3ff9045605`.
- 웹: 기존 Render `glit`, `https://glit-b1yn.onrender.com`, GitHub main 자동 배포.
- [최종 Render 배포](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dafubm15efls73b89un0).
- 회원 진입: [내 음악 관리](https://glit-b1yn.onrender.com/mypage/music). 관리자: `/admin/music`.
- 운영 Supabase `glit`에 `0095_music_archive.sql` 적용 완료.
- 기존 무료 웹 인스턴스와 비공개 B2 버킷을 유지했다. 별도 유료 워커·서비스·요금제 변경은 없다.

## DB 적용 확인

`supabase db push --linked --dry-run`에서 0095만 미적용임을 확인한 뒤 기존 CLI로 적용했다. 마이그레이션 이력은 로컬·운영 모두 0095이며, 재차 dry-run은 미적용 없음으로 응답했다.

새 테이블 7개와 `list_music_archive_libraries` RPC가 HTTP 200으로 응답했다. 익명 사용자의 새 테이블 7개 조회와 목록 RPC는 모두 401/42501로 차단됐다. 기존 `submissions`와 `station_reviews` 조회도 정상이다. 기존 회원·심의·결제 테이블의 구조나 고객 데이터를 변경하는 마이그레이션은 실행하지 않았다.

## 실제 운영 검증

- `/api/health`: 200, `ok:true`, `errorCount:0`. 기존 카카오 알림 환경 경고 1개는 배포 전과 동일하다.
- 홈·로그인·가입·비밀번호 찾기·앨범/MV 신청 화면: 200.
- 회원·관리자 음악 페이지: 비로그인 시 해당 페이지를 next 값으로 보존하여 로그인으로 307 이동.
- 새 음악 API와 증빙 API: 비로그인 요청 401. 외부 사이트 Origin 요청은 403.
- 기존 심의자료 API 10개 인증 차단 및 관리자 로그인 이동 회귀: 운영 주소에서 2개 테스트 통과.
- 임시 회원을 메일 발송 없이 생성하고 실제 Supabase 비밀번호 로그인으로 SSR 쿠키를 발급받았다. 해당 쿠키로 운영 API를 호출하여 아래 흐름을 확인했다.

1. 초기 목록과 공식 안내 조회 → 수동 아티스트 생성.
2. 발매작 1개, Original/Clean 버전의 트랙·녹음 각 2개를 원자적으로 저장.
3. Original 트랙에만 TJ 사용자 신청 기록 생성. 다른 버전은 별도 상태 유지.
4. 독립된 GET 재조회에서 저장 내용·버전 구분·기록 출처·감사 이력 유지 확인.
5. 회원의 직접 DB 수정·권한 전용 RPC 실행 차단. 일반 회원의 관리자 API 접근 403.
6. 실제 B2 비공개 PDF 업로드 201 → 업무 증빙 참조와 사용자 증빙 출처 저장 → 다운로드 200 및 원본 SHA-256 일치 → 삭제 200 → 재다운로드 404.
7. 검증 회원의 심의·결제 생성 건수 0 확인. 해당 회원의 증빙 참조·작업·이벤트·아카이브 행과 Auth 계정을 삭제하고 잔존 여부 재검증.

첫 운영 저장 검증에서 발견한 Render 내부 URL과 공개 Origin 불일치는 기존 `getBaseUrl()`을 재사용하여 수정했다. 위조 프록시 헤더·외부 Origin·cross-site 차단을 유지하는 회귀 테스트를 추가했고, 수정 배포 후 위 전체 흐름을 재검증했다.

최종 신규 테스트 55개, 프로덕션 빌드와 TypeScript, 변경 파일 ESLint 및 diff 검사 통과. 앞선 회원·관리자 UI 검증과 로컬 PostgreSQL 통합 검증은 [구현 안내](music-archive.md)에 정리했다. 실제 계정의 권리자 인증, 외부기관 신청, 결제, 메일 발송은 실행하지 않았다.

## 활성화 범위와 복구

수동 아카이브·CSV·공식 안내·업무 기록·비공개 증빙은 배포됐다. MusicBrainz 자동수집은 상업 이용 허가와 User-Agent 설정 대기 상태를 유지한다. Spotify·멜론·지니·벅스 및 기관별 자동 조회·신청은 [제공처 안내](music-archive-providers.md)의 제한 상태와 같다. 운영 배포 승인을 외부 API 이용 계약으로 취급하지 않았다.

코드 복구가 필요하면 이전 Render 웹 배포를 사용하고 신규 테이블 및 0095 이력은 보존한다. DB reset이나 새 아카이브 데이터 삭제를 복구 절차로 사용하지 않는다.

이 검증 기록만 추가하는 후속 커밋에는 `[skip render]`를 사용하여 같은 실행 코드의 중복 배포를 생략한다. [Render 공식 배포 안내](https://render.com/docs/deploys#skipping-an-auto-deploy).
