# 국내 아티스트 카탈로그 연결: Apple 공식 검색 API

확인일: 2026-09-08. 구현: `src/lib/music-archive/apple.ts`.

Apple은 [공식 API 개요](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html)에서 웹 검색 필드와 ID를 통한 자체 라이브러리·디지털 카탈로그 대응을 설명한다. 이 어댑터는 사실 메타데이터와 공식 스토어 링크만 사용한다. 별도 이용 조건이 있는 앨범 이미지·음원 미리듣기·영상·가사·소개글은 내려받거나 저장·표시하지 않는다. 이는 국내 모든 아티스트가 수록되었다는 보장이 아니다.

[공식 검색 명세](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)는 `country`, `entity`, `limit`(1–200), 약 20회/분의 호출 한도를 설명한다. 공개 명세에 없는 `offset`을 API로 보내지 않는다. 검색은 한국 storefront의 최대 200개 결과창을 가져오고 애플리케이션에서 나눈다. `pageSize:200`을 사용한 서버 캐시 후 20개씩 표시할 수 있다. 200개면 `limited:true`를 표시해야 하며 `total`은 그 결과창의 개수다. 초성 검색의 전체 카탈로그 지원을 주장하지 않는다.

[공식 lookup 예시](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/LookupExamples.html)로 확인한 ID·앨범·곡 관계를 사용한다. API 키, 로그인, 비공개 엔드포인트는 사용하지 않는다. 요청은 고정 `https://itunes.apple.com/search` 또는 `/lookup`, redirect 금지, 12초 제한, 스트림 8MB 상한이다. 운영에서는 검색·수집 모두 같은 DB permit을 사용해 요청 간격을 최소 3.1초로 제한한다. 모듈의 로컬 permit은 단일 프로세스용이다. 429/5xx의 `Retry-After`를 보존한다.

## 실제 HTTP 확인

`entity=musicArtist&country=KR`의 `빈티지코드` 검색은 서로 다른 후보를 반환한다. 동일인으로 자동 합치거나 멜론 ID와 자동 대응시키지 않는다.

| Apple artist ID | API 표기 | 한국 공식 링크 이름 | 장르 | KR 앨범 조회 |
| --- | --- | --- | --- | --- |
| 1259084205 | Vintage Chord | 빈티지코드 | R&B/소울 | 7개, `The Moon and the Stars` 등 |
| 1112117967 | Vintagechord | 빈티지코드 | 힙합/랩 | 2개, `KozyTape pt.6`, `오브제텐` |

한국 아티스트 링크의 한글 경로 이름을 표시하고 API 영문명·장르도 구분 정보로 유지한다. 이미지나 대표앨범을 검색 응답에 없는데 만들어 넣지 않는다.

동일한 앨범 ID 1259083959 조회는 `country=KR&entity=song`에서 앨범 1개/곡 0개를 반환했다(`trackCount:9`). `country=US`에서는 같은 앨범 및 9곡을 반환했다. 1886162774도 KR 곡 0개, US 7곡이었다. 그래서 수집은 KR 앨범 목록과 같은 ID의 US 곡 목록을 결합한다. KR 앨범명·아티스트 표기를 보존하고, US 곡의 ID·이름·순서·길이를 사용한다. 조회 국가를 아티스트 국적이나 발매 국가로 저장하지 않는다. 국가별 목록 차이·US 미제공 앨범·트랙 수 불일치는 완료로 처리하지 않는다.

US 아티스트의 `entity=song` 응답은 다른 primary artist ID인 협업곡도 포함했다. 해당 응답의 정확한 track ID 관계 또는 트랙의 직접 artist ID만 관리 대상 판단에 사용한다. 참여 앨범의 무관한 곡을 이름 부분 일치로 관리 대상에 넣지 않는다. Apple song ID를 recording ID/ISRC로 만들지 않는다.

작성한 어댑터 자체를 실제 API에 연결한 읽기 검증에서 1259084205의 7개 앨범·26개 트랙을 9개 수집 단계로 완주했다. 협업 앨범 2개도 포함된다. 외부·운영 DB 쓰기는 하지 않았다. 동명이인 후보 중 하나를 회원의 기존 멜론 연결에 자동 대응시키지 않았다.

## 중단·재시작 계약

`AppleCursor`는 `albums → artist_songs → tracks → done` 순서로 진행하며 단계당 API 요청은 최대 1회다. 앨범별 결과와 다음 cursor를 원자적으로 저장해야 한다. cursor에는 최대 200개 앨범의 선택된 메타데이터만 남긴다. 실패 시 입력 cursor를 바꾸지 않는다. 앨범의 전체 `trackCount`와 곡 수가 맞아야 가져온다.

앨범/참여곡 결과가 200개 한도에 닿으면 가져올 수 있는 앨범을 저장한 뒤 `limited` 단계에서 `MusicProviderError('invalid_response', ...)`를 발생시켜 작업을 일부 수집 상태로 유지한다. 전체 수집 완료로 표시하지 않는다. 정상 완료에도 KR/US 조회 범위와 200개 제한을 `scopeNote`에 남긴다.

`tests/fixtures/music-archive-apple/`는 위 소량 응답에서 필요한 사실 필드만 남긴 fixture다. 원본 API의 artwork/preview/copyright 필드는 제외했다. 단위 테스트는 실제 응답의 KR 곡 누락, US 전체 곡, 동명이인, 참여 관계, 재시작, 잘린 결과, 호출 오류와 크기 제한을 검증한다.
