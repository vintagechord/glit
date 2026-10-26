# 온사이드 심의·발매·방송 신청 연결 변경

작성: 2026-10-27. 사용자 승인으로 운영 웹·DB·Mac 앱에 적용했다. Spotify·YouTube API 키 설정은 사용자 요청으로 후속 작업으로 보류한다.

## 신청 화면과 심의데스크

- `/dashboard/new`의 편성 보장 및 Mnet·ETN 상담 안내 문단을 제거했다.
- 자동 저장 배지를 제거하고 비회원 가능 표시를 선택 카드 아래로 이동했다.
- 신청 화면과 신청 단계 하단의 문의 링크를 `문의하기` 버튼으로 통일했다. 기존 새 창 동작과 영문 경로 연결은 유지한다.
- 심의데스크의 목록 휴지통에서 삭제 건수를 확인하고 비울 수 있다. 해당 Mac의 원본·생성 파일·작업 이력을 삭제하며 온라인 신청·심의 결과와 별도 백업은 유지한다. 온라인 항목은 최소 식별 기록을 남겨 다음 동기화에서 다시 나타나지 않게 한다. 동시 복원·삭제와 작업 중 삭제를 막으며, 일부 파일 삭제 실패 시 남은 항목을 재시도할 수 있다.

## 아티스트와 앨범

아티스트를 이름으로 검색하고 제공처·식별자·공식 프로필을 비교한 뒤 연결한다. 표시 이름만으로 다른 제공처의 아티스트나 동명이인 앨범을 자동 병합하지 않는다. 앨범 가져오기는 기존 소유자별 작업 큐와 원자적 커서 저장을 사용하며, 중단 후 재시도할 때 사용자가 수정한 자료와 심의 이력을 보존한다.

일부 곡에만 심의 이력이 있으면 나머지 곡별로 신청할 수 있다. 진행 중 접수는 상세 화면의 결제·자료 보완 경로로 연결한다. 완료된 곡은 기존 심의 결과를 확인한 뒤 `다른 방송사 심의 신청`에서 추가 대상 방송사를 선택할 수 있다.

| 제공처 | 구현 범위 | 운영 조건 |
| --- | --- | --- |
| 멜론·지니 | 공개 아티스트 이름 검색, 선택한 ID의 앨범과 트랙 가져오기 | 새 DB 마이그레이션. 공개 페이지 구조·접근 제한이 바뀌면 재확인 필요 |
| Apple Music | 기존 이름·초성 검색과 앨범 가져오기, 검색 캐시 실패 처리 보완 | 기존 설정 사용 |
| Spotify | 공식 API 이름 검색, 아티스트 검증, 앨범·트랙 페이지별 가져오기, 선택 음원의 심의 신청 연결 | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, 사용 가능한 앱 접근 범위, 새 DB 마이그레이션 |
| YouTube | 공식 API 이름 검색으로 채널 후보 조회·확인·연결 | `YOUTUBE_DATA_API_KEY`, YouTube Data API v3 사용 설정, 새 DB 마이그레이션 |

YouTube 채널·영상·재생목록만으로 공식 앨범 발매일과 수록곡을 확정하지 않는다. 같은 아티스트의 멜론·지니·Spotify·Apple Music 연결에서 발매 정보를 가져오도록 안내한다. 키가 없는 제공처는 검색 불가 이유와 공식 사이트 검색·링크 연결을 제공한다. 키는 서버 전용이며 `NEXT_PUBLIC_` 접두사를 사용하지 않는다.

Spotify는 현재 검색 최대 10개 후보를 사용한다. 앨범/트랙 수집은 고정 API 주소와 검증한 ID로 요청하고, 외부 응답의 `next` URL을 그대로 따라가지 않는다. 응답 크기, 페이지 수, 트랙 소속, 실제 달력 날짜와 저장 커서를 검증한다. 트랙 전체를 확인하기 전에는 앨범을 완성본으로 저장하지 않는다.

공식 구현 근거: [Spotify 검색](https://developer.spotify.com/documentation/web-api/reference/search), [아티스트 앨범](https://developer.spotify.com/documentation/web-api/reference/get-an-artists-albums), [앨범 정보](https://developer.spotify.com/documentation/web-api/reference/get-an-album), [트랙 페이지](https://developer.spotify.com/documentation/web-api/reference/get-an-albums-tracks), [Client Credentials](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow), [YouTube 채널 검색](https://developers.google.com/youtube/v3/docs/search/list), [채널 확인](https://developers.google.com/youtube/v3/docs/channels/list), [Google API 키 헤더](https://docs.cloud.google.com/apis/docs/system-parameters).

## 적격 음원의 방송 신청

기존 방송국별 적격 음원 선택과 신청 초안에 프로그램 편성 안내, 시간대·참여 방식 필터, 공식 코너 안내와 참여 링크를 추가했다. 확인한 프로그램만 구체적인 시간을 표시하며 특집·개편·지역 차이는 공식 페이지에서 확인하도록 한다.

사연과 곡을 함께 신청하는 게시판, 제작진이 사연에 맞춰 곡을 고르는 코너를 구분한다. 준비 체크리스트와 최근 선곡표 확인, 실제 경험과 곡의 연결 이유, 코너 주제와 마감 확인 방법을 제시한다. 방송 후에는 사연 소개와 곡 송출을 따로 기록하고 방송일·선곡표 또는 다시듣기 주소·다음 확인일을 남길 수 있다. 기록은 기존 작업공간과 TXT 내보내기를 사용하며 자동 방송 신청·자동 알림으로 표시하지 않는다.

프로그램별 공식 근거와 확인일은 `src/lib/radio-program-plans.ts` 및 화면에 포함되어 있다. 방송국 게시판에 글을 자동 게시하거나 제작진에게 메시지를 보내는 동작은 추가하지 않았다.

## 운영 반영

1. `supabase/migrations/20261026150859_music_archive_more_catalogs.sql`을 운영에 적용했다. 적용 대상은 이 파일 한 개였고, 전후 스키마·이력·함수 권한·RLS 보존을 확인했다. 소유권 정책을 유지하고 새 제공처의 수집 큐·원본 자료·전역 호출 간격을 허용한다.
2. Spotify·YouTube API 키 발급·등록·활성화는 보류한다. 사용자가 재개를 요청하면 진행한다. 키 없이 가능한 멜론·지니·Apple 검색·앨범 관리 및 방송 신청 가이드는 먼저 배포한다. 키가 없는 두 제공처는 설정 필요 안내와 공식 사이트 검색·프로필 연결만 제공한다.
3. 심의데스크 2.3.2/build 7을 기존 Mac 빌드·설치 절차로 설치했다. 기존 연결키·신청·휴지통·파일을 보존하고 이전 앱과 관리 데이터를 백업했다. 앱 서명·설치 소스 해시·실행 상태 및 실제 화면의 휴지통 비우기 버튼을 확인했다. 실제 휴지통 비우기나 고객 심의 결과 변경은 배포 검증에 사용하지 않았다. 설치 근거는 `tools/onside-desk/qa/install-verification-20261027.json`이다.

운영 웹: [PR #13](https://github.com/vintagechord/glit/pull/13)의 `main` 병합 커밋 `a0107dfd2335a6e414f62866dfaecce11509dae9`를 [Render 배포 dep-dbfn5qom7kps739naigg](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dbfn5qom7kps739naigg)로 배포했다. 2026-10-27 00:36:12 KST Live, 배포 2분 8초. 실제 Auto-Deploy 설정은 Off여서 해당 커밋을 지정해 수동 배포했고 설정은 유지했다. Render의 실제 Turbopack 빌드·TypeScript·페이지 생성도 통과했다.

운영 확인: `https://glit-b1yn.onrender.com`에서 쓰기를 차단한 브라우저 검사 9개(서버 health, 모바일 360/390/430px·태블릿·데스크톱, 영문 문의 경로, 200% 확대)가 모두 통과했다. `/api/health`·`/readyz`는 정상, 차단 오류 0개. 기존 카카오 선택 알림 채널 경고 1개는 이번 변경 범위 밖이며 그대로 유지했다. 운영 검증에서 신청·결제·고객 심의 결과·외부 방송국 게시물을 생성하지 않았다.

DB 근거: 마이그레이션 SHA256 `bd9d4cdd25e25ca5eeaacbdf163e64376346b80b6d6c45f0861ac742a643b110`. 전후 스키마 차이는 검토한 제공처 제약 3개와 호출 슬롯 함수의 제공처 조건뿐이었다. `PUBLIC` 함수 실행 권한 제거, `service_role` 전용 권한, 테이블 RLS와 원격 이력을 재확인했다. 새 함수의 lint 경고는 없었다.

격리 SQL 검증은 `npm run music-archive:test:sql`로 수행했다. 설치된 Docker를 실행하고 기존 PostgreSQL 17 이미지를 사용한 네트워크 차단 임시 컨테이너에서 기존·신규 SQL 테스트가 모두 통과했다. 소유자 격리, 서비스 전용 함수 권한, 제공처 제약, 호출 간격과 큐 포화 동작을 확인했으며 임시 컨테이너는 정리했다. 운영 DB는 테스트에 사용하지 않았다.

검증: 관련 단위 테스트 201개, 추가 심의 범위 최종 검사 25개, 신청 화면 브라우저 검사 8개, 방송 신청 브라우저 검사 27개, 아티스트 화면 브라우저 검사 18개, 데스크 서버 검사 35개와 휴지통 UI smoke를 통과했다. 마지막 범위 검사는 앞선 단위 테스트와 겹치므로 합산하지 않는다. TypeScript와 변경 파일 ESLint도 통과했다. 심의자료 회귀 검사는 26개 통과, 이번 변경과 무관한 Python 변환기 fixture 1개는 전용 환경 미설정으로 건너뛰었다.

최종 `npm run build -- --webpack`은 성공했다. 기본 Turbopack 빌드는 이 실행 환경에서 PostCSS 작업용 프로세스의 포트 바인딩이 `EPERM`으로 차단되어 실패했다. 소스나 기본 빌드 스크립트를 바꾸지 않고 설치된 Next.js가 공식 지원하는 Webpack 경로로 최종 프로덕션 빌드를 검증했다.
