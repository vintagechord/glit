# 내 음악 관리: 외부 제공처·공식 업무 안내 운영 기록

확인일: **2026-09-08 (Asia/Seoul)**. 이 문서는 자동수집 코드 구현, 운영 활성화, 실제 HTTP 확인을 구분한다. 무료 부가서비스가 곧 비상업적 이용이라는 전제는 사용하지 않았다. 외부기관 신청·결제·계약·가입은 실행하지 않았다. 사용자가 승인한 온사이드 DB·웹 배포와 음악 제공처 API 이용 허가는 별개이며, 제공처 자동수집은 아래 제한 상태를 유지한다.

## 제공처별 판단

| 제공처 | 공식 기능 확인 | 이번 코드/기본 상태 | 활성화에 필요한 확인 |
| --- | --- | --- | --- |
| MusicBrainz | 아티스트 검색/ID 조회, 발매본 browse, 발매본 트랙·녹음 조회. `artist`와 `track_artist` browse를 각각 페이지 처리 가능 | 실제 어댑터 구현. 기본 `permission_required`; 상업 이용 허가와 연락 가능한 User-Agent 확인 후 조회 가능 | MetaBrainz 상업 API 이용 허가/계약 범위, 전체 인스턴스의 호출 제한, 실제 운영 HTTP 재검증 |
| Spotify | 공식 검색·아티스트 앨범·앨범 트랙 API 및 페이지네이션 존재 | `permission_required`, **API 어댑터 미구현**, 서비스 URL 연결만 가능 | 업무용 아카이브/데이터베이스 용도·보관·타 서비스 결합 정책, 개발 앱과 자격증명, 운영 접근 심사 범위 |
| 멜론 | 공식 음악 검색/아티스트·앨범 페이지와 파트너센터 존재 | `link_only`. 공개된 공식 아카이브 API, 필드 계약·전체 페이지 수집 권한을 확인하지 못함 | 제휴/프로모션 창구에서 공식 API 또는 데이터 피드, 상업 이용·저장·재표시·이미지 조건을 확인 |
| 지니뮤직 | 공식 음악 서비스와 제휴 문의 경로 존재 | `link_only`. 아카이브용 공개 API·데이터 이용 허가 확인 못함 | 공식 제휴 계약/허용된 피드와 호출·보관·이미지 조건 확인 |
| 벅스 | 공식 음악 서비스와 이용약관 존재 | `link_only`. 공개 아카이브 API/데이터 이용 허가 확인 못함 | 제공처의 서면 이용 범위·공식 피드·보관·재표시 조건 확인 |

‘확인하지 못함’은 비공개 제휴 API도 존재하지 않는다는 단정이 아니다. 소비자 웹사이트를 볼 수 있다는 사실만으로 대량 수집·상업 재표시·이미지 이용을 허가받은 것으로 취급하지 않는다. 이번 아카이브는 기존 `src/lib/genie.ts`의 웹페이지/가사 추출을 호출하거나 확장하지 않는다.

- 멜론: [공식 서비스](https://www.melon.com/), [공식 이용약관](https://info.melon.com/terms/web/terms1_2.html), [공식 파트너센터 안내](https://partner.melon.com/partrct/svcguide/web/svcguide_tab1.htm). 공개 자료에서 재사용할 수 있는 아카이브 API 명세·권한·보관기간은 확인되지 않았다.
- 지니: [공식 서비스 이용약관](https://www.genie.co.kr/guide/userAgreement), [공식 제휴 문의](https://www.geniemusic.co.kr/love/alliance.do). 미확인 API 엔드포인트를 추정하지 않았다.
- 벅스: [공식 이용약관](https://music.bugs.co.kr/rules/use). 소비자 서비스 접근과 별개로 메타데이터 수집·재배포 권한은 확인되지 않았다.

## MusicBrainz 구현과 보관 범위

[MusicBrainz 공식 API 문서](https://musicbrainz.org/doc/MusicBrainz_API)는 공개 API의 무료 사용을 비상업적 용도로 안내하고, 상업 용도는 [MetaBrainz 상업 지원/문의](https://metabrainz.org/supporters/account-type)를 안내한다. API 키 없이 조회할 수 있다는 사실과 상업 이용 허가는 별개다. 의미 있는 User-Agent와 애플리케이션당 초당 1회 이하 호출이 필요하다.

[데이터 라이선스](https://musicbrainz.org/doc/About/Data_License)와 [공식 코어 데이터 CC0 고지](https://github.com/metabrainz/musicbrainz-server/blob/master/admin/COPYING-PublicDomain)를 구분한다. 코어 사실 메타데이터는 CC0이고 부가 데이터에는 별도 라이선스가 있다. 어댑터는 태그·평점·주석·가사·음원·사진·커버를 요청/저장하지 않는다. 이름·발매일·타입·크레딧·식별자·디스크/트랙 순서·길이 등 사용한 필드만 정규화한다. 이미지 권한을 확보하지 않았으므로 `imageUrl: null`로 반환하며 UI 기본 이미지를 사용한다. 외부 ID/URL과 MusicBrainz 출처·확인시각을 유지하고 사용자의 자체 업무 기록과 분리한다. 데이터 라이선스의 허용 범위와 API 서비스 계약의 추가 보관 조건을 운영자가 함께 확인해야 한다.

필요한 **서버 환경변수**:

```dotenv
# 실제 상업 API 이용 권한이 확인된 뒤에만 true. 이 작업에서는 설정하지 않음.
MUSICBRAINZ_COMMERCIAL_USE_APPROVED=false
# 실제 모니터링하는 담당 연락처나 서비스 연락 URL로 설정
MUSICBRAINZ_USER_AGENT=OnsideMusicArchive/1.0 (https://YOUR_REAL_SERVICE/contact)
```

`src/lib/music-archive/providers.ts`는 URL 검증·지원 상태·공유 타입, `musicbrainz.ts`는 네트워크 어댑터다. 서버에서 상태만 직렬화하여 UI에 전달한다. URL 입력은 allowlist의 HTTPS 호스트/경로/ID만 수용하고 사용자 인증정보·임의 포트를 거부한다. API 요청은 고정된 `https://musicbrainz.org/ws/2/`에서 검증한 MBID로 다시 구성하며 리다이렉트는 허용하지 않는다. 검색어의 Lucene 제어 문자는 이스케이프한다.

`searchMusicBrainzArtists(query, options)`는 이름 또는 MusicBrainz 아티스트 URL/MBID를 받고 `items,total,nextOffset,checkedAt`를 반환한다. 동명이인 후보의 이름·국가·유형·구분 설명을 보존한다. 후보를 자동 확정하지 않는다. 후보 이미지·대표 발매본은 조회하지 않아 비어 있으며, 제공되지 않은 정보를 만들어내지 않는다.

`collectMusicBrainzStep(artistId, cursor, options)`는 **한 번에 외부 요청 1개**만 처리한다. 한 발매본의 전체 디스크/트랙 조회 또는 최대 100개 발매본 페이지 조회를 수행하고 JSON 직렬화 가능한 `nextCursor`를 반환한다.

1. `artist`로 본인 명의 발매본의 모든 offset 페이지를 조회한다.
2. 페이지의 `pending` 발매본을 하나씩 조회해 트랙·녹음 정보를 반환한다.
3. `track_artist`로 트랙 크레딧 참여 발매본도 모두 처리한다. 두 범위에서 같은 발매본이 다시 등장할 수 있으므로 서비스 계층은 제공처+외부 ID를 사용해 동일 관리 항목에 반영한다.
4. 각 디스크의 `track-count`와 실제 트랙 개수가 다르면 수집 완료로 표시하지 않는다. 8 MB 응답/발매본 10,000 트랙 처리 제한에 도달해도 동일하게 오류와 재개 지점을 남긴다.
5. 반환된 메타데이터와 커서를 서비스 계층에서 함께 저장한 뒤 다음 단계로 넘어간다. 실패 후 원래 커서를 재사용하면 동일 단계가 재시도된다. cursor 자체를 어댑터가 수정하지 않는다.

`options.acquirePermit`는 서버가 제공하는 DB 기반 전역 호출 슬롯 콜백이다. 검색과 워커가 같은 슬롯을 사용해야 한다. 콜백 미지정 시 프로세스 내 1.1초 간격 보호만 적용되므로 복수 인스턴스 운영에는 충분하지 않다. HTTP는 12초 제한, 스트리밍 본문 8 MB 제한, Next `no-store`이다. 429/5xx/네트워크 오류는 일시 상태로 구분하고 `Retry-After`(초 또는 HTTP 날짜)를 최대 24시간 범위에서 보존한다. 401/403은 권한 부족, 404는 검색 결과 없음이며 업무 미완료로 바꾸지 않는다. DB 작업 재시도·동시실행 보호는 서비스/잡 계층의 책임이다.

발매본 MBID·수록트랙 MBID·녹음 MBID를 별도로 보존한다. 동일 제목이나 ISRC만으로 녹음·저작물을 병합하지 않는다. 자동 관리 대상 트랙은 해당 아티스트 MBID가 트랙 또는 녹음 크레딧에 실제 있는 경우만 표시한다. 다른 아티스트 트랙과 확인되지 않은 크레딧을 자동 업무 대상으로 삼지 않는다. 세션 관계로만 연결된 참여·누락된 크레딧·미등록 발매작·다른 서비스의 수록 범위는 자동 확인하지 못한다. 작업의 `completed`는 **해당 제공처에서 조회 가능한 두 browse 범위의 처리가 끝남**을 뜻하며 전곡 100% 수집 인증이 아니다.

## Spotify를 자동 활성화하지 않은 이유

[검색 API](https://developer.spotify.com/documentation/web-api/reference/search), [아티스트 앨범 API](https://developer.spotify.com/documentation/web-api/reference/get-an-artists-albums), [앨범 트랙 API](https://developer.spotify.com/documentation/web-api/reference/get-an-albums-tracks)는 공식적으로 존재한다. 앨범은 album/single/appears_on/compilation 범위와 지역 제한, 트랙은 디스크·순서·길이·아티스트·Spotify ID와 다음 페이지를 제공한다. 모든 필드가 모든 API 응답에 존재한다고 가정하지 않으며, UPC/ISRC 등이 필요하면 해당 엔드포인트의 실제 응답과 접근 범위를 별도로 확인해야 한다.

[개발 정책](https://developer.spotify.com/policy)은 출처 표시와 원본 링크, 일부 업무용 서비스·독립 메타데이터 제품에 대한 제한을 둔다. [개발 약관](https://developer.spotify.com/terms)의 저장·캐싱 조항은 필요한 범위를 넘는 데이터베이스 구축과 무기한 보관을 제한한다. 이 업무용 아카이브가 허용된 비스트리밍 사용에 해당하는지 코드만으로 확정할 수 없다. 임의의 ‘24시간이면 항상 허용’ 같은 보관기간을 만들지 않았다. 허가 없는 Spotify 사진도 불러오지 않는다.

[현재 quota 문서](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)는 개발 모드 소유자의 Premium 계정과 최대 5명 허용 사용자, 더 넓은 운영의 심사 조건을 안내한다. 개발 키가 있다는 이유로 가입 회원 전체를 대상으로 운영할 수 있다고 판단하지 않는다. 이번 작업은 Spotify 자격증명·계정·심사 상태를 확보하지 않았으며 API 요청이나 외부 앱 등록을 실행하지 않았다. 링크 파서만 구현되어 있고 환경변수만 추가해도 Spotify 연동이 활성화되지 않는다.

## 공식 업무 안내와 관리자 관리

실제 화면용 기본 안내는 `src/lib/music-archive/guides.ts`의 `agencyGuides` 한 곳에 관리한다. 기관별 소개·대상·준비 정보·공식 경로·사후 확인·온사이드 기록 항목·비용 안내·출처·마지막 확인일·노출 여부를 갖춘다. `isOfficialAgencyUrl`은 전체 공식 호스트 검증 유틸리티이며 관리자 저장 경로는 각 안내의 기존 공식 출처 호스트로 더 좁게 제한한다. 새 공식 도메인으로 이전하면 출처를 확인한 뒤 allowlist와 안내를 함께 변경한다.

- **KOMCA**: [신탁관련서식](https://www.komca.or.kr/dat2/dat_contents_0101.jsp)에서 신탁계약과 저작물 신고 서식이 별도임을 확인했다. 메인 페이지는 자동 텍스트 추출이 제한되어 로그인 후 온라인 신고 화면은 검증하지 못했다. 공식 홈페이지·자료실 경로와 사용자 기록을 제공하며 API나 권리자 인증을 주장하지 않는다.
- **KOSCAP**: [작품검색](https://www.koscap.or.kr/v2/music/search_list), [신탁계약안내](https://www.koscap.or.kr/v2/admission/information), [작품등록안내](https://www.koscap.or.kr/v2/admission/regist_info)를 확인했다. 등록신청서와 저작자임을 증명할 자료가 안내되며 작품명뿐 아니라 저작자를 비교하도록 한다. 기관 신탁관계와 작품별 기록을 구분한다.
- **법적 저작권 등록**: [위원회 등록 안내](https://www.copyright.or.kr/business/registration/index.do)는 등록부 공시, 신청·심사·수수료·등록증 과정을 설명한다. [문체부 공식 설명](https://www.mcst.go.kr/site/s_policy/copyright/knowledge/know05.jsp?pCommPage=1)에서 저작권은 창작 시 발생한다는 근거를 확인했다. 협회 작품등록과 동일 절차로 안내하지 않는다. [CROS](https://www.cros.or.kr/) 로그인/개인 등록내역은 확인하지 않았다.
- **음실련**: [공식 홈페이지](https://www.fkmp.kr/)의 회원전용 작품조회/실연정보등록과 [입회 본인인증](https://www.fkmp.kr/entrust/Entrust/entrust1)을 확인했다. 해당 공식 페이지는 사전 허락 없는 자동화에 의한 외부적 활용을 금지한다고 고지한다. 개인 등록내역을 수집하지 않고 참가자·트랙·역할별 사용자 기록을 제공한다. 민감 서류와 인증서는 기관에 직접 제출한다.
- **TJ**: [일반 신청 유의사항](https://www.tjmedia.com/song/accompaniment_apply_agree)은 기존 신청곡 추천 절차와 실제 수록이 보장되지 않음을 안내한다. [유료곡 등록](https://www.tjmedia.com/support/paidsong)은 비용과 내부심사에 따른 거절 가능성을 명시한다. 일반/유료 방식을 구분하고 접수와 수록곡 번호를 별도로 기록한다.
- **금영**: [공식 반주곡 신청](https://www.kyentertainment.kr/bbs/board.php?bo_table=qa_song)의 검색 메뉴가 현재 [K-VOICE 검색](https://kygabang.com/shop/)으로 연결됨을 확인했다. 출발점 `https://kysing.kr/`는 읽을 수 있는 본문이 나오지 않았다. [유료곡 안내](https://www.kyentertainment.kr/w/platform/enrollment.php)도 별도 제공한다. 공개 페이지에서 확인되지 않은 금액·기간·수록 보장은 추가하지 않았다.

이들 기관에는 자동 조회/신청 어댑터가 없다. 공식 페이지 열기는 신청 완료나 공식 확인 상태를 생성하지 않는다. 사용자가 공식 화면에서 확인해 입력한 내용도 `사용자 입력` 근거로 표시하며 기관 API가 검증한 것으로 바꾸지 않는다. 사용자 증빙은 공식 기관 확인과 별도다. 기관과의 제휴·대행·권리 인증을 의미하지 않는다.

## 실제 검증과 모의 검증의 경계

| 방식/대상 | 결과 | 검증하지 못한 부분 |
| --- | --- | --- |
| 실제 HTTP: `GET https://musicbrainz.org/ws/2/artist/5b11f4ce-a62d-471e-81fc-a69a8278c7da?fmt=json` | 2026-09-08T09:15:01.468Z HTTP 200, Nirvana 이름/MBID 수신. 읽기 전용 1회 개발 검증 | 상업적 운영 허가, 전체 아카이브 정확성 |
| 실제 HTTP: MusicBrainz `artist?query=artist:"Nirvana"&limit=2&offset=0&fmt=json` | 12초 타임아웃 | 라이브 이름 검색 페이지 성공 확인 못함 |
| 실제 HTTP: MusicBrainz `release?track_artist=5b11f4ce-a62d-471e-81fc-a69a8278c7da&limit=1&offset=0&fmt=json` | 2026-09-08T09:22:17.091Z 12초 타임아웃 | 참여작 페이지 및 이어지는 실제 발매본/트랙 HTTP 검증 못함 |
| 공식 업무/정책 웹 페이지 확인 | 위 링크의 공개 메뉴/본문을 읽기 전용으로 확인. 일부 MusicBrainz 문서 재조회는 429 발생 | 기관 로그인·개인 내역·실제 등록/결제 없음 |
| Spotify/멜론/지니/벅스 메타데이터 API | 실제 API 검증 없음 | 인증·계약·정식 피드 미확보. 연동 완료로 보고하지 않음 |
| `node --test --import tsx tests/music-archive-providers.test.ts` | **10/10 통과**, 모의 응답 단위 테스트 | 라이브 전체 카탈로그 import, 권한/DB/UI 검증은 이 단위 테스트 범위 밖 |
| 대상 파일 ESLint | 통과 | 전체 서비스 배포 검증 아님 |

모의 검증은 동명이인 후보·페이지 재개·본인 명의/참여 발매본 범위·1단계 1요청·25곡 초과/다중 디스크·다른 녹음 버전·타 아티스트 트랙 제외·중간 페이지 누락·잘못된 JSON·8MB 제한·429 재시도·권한 부족/결과 없음 구분·URL 안전성·공식 안내 완결성을 확인한다. 운영 활성화 전에는 상업 이용 권한을 확보하고, 실제 운영 egress에서 이름 검색/자신의 아티스트/발매본/전체 트랙/중단 재개를 작은 범위로 다시 확인해야 한다.

현재 기본값에서는 수동 아티스트·발매본·트랙 등록, 서비스 URL 연결, 기존 심의 내역 연결, 외부 업무 사용자 기록과 공식 안내를 이용한다. 제공처 장애나 자격 미설정은 수동 관리 기능과 자체 업무 기록을 삭제하거나 막는 이유가 아니다.
