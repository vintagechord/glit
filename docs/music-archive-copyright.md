# 음악저작자·작품 조회 연동 점검

확인일: 2026-09-08. 공개 공식 자료만 조회했으며 로그인, CAPTCHA 우회, 비공개 API 추정, 작품 대량 수집, 외부 신청은 하지 않았다.

## 제공처별 현재 상태

| 기관 | 실제 확인한 접근 경로 | 온사이드 자동 조회 | 제공하는 동작 |
| --- | --- | --- | --- |
| KOMCA | 공식 메뉴의 `/srch2/srch_01.jsp` 저작물검색 링크 | 관리저작물 자동화 제한 | 공식 검색 화면 열기, 곡명·저작자 복사, 사용자 확인 기록 |
| KOSCAP | 비로그인 작품검색 GET form, 제목·저작자 입력 필드 | 정보 수집·재제공 허가 확인 필요 | 공식 검색에 곡명·저작자를 전달하여 열기, 사용자 확인 기록 |

이 제한은 운영 문서에 남기며 고객에게 빈 자동 조회 기능으로 제공하지 않는다. 두 기관 모두 **검색 결과 없음 또는 미등록을 의미하지 않는다**. 현재 서버는 협회 작품 검색 요청을 보내지 않으며, 조회 후보·조회 시각·회원 권리 확인을 생성하지 않는다.

## KOMCA 공식 근거

[공식 협회규정](https://www.komca.or.kr/disclose2/disclose_0101.jsp) 페이지의 공통 하단은 협회 관리저작물을 대상으로 하는 AI·로봇·매크로·스크래퍼 등 자동화 도구 활용을 허용하지 않는다고 안내한다. 같은 내용은 [공식 FAQ](https://www.komca.or.kr/CTLJSP?EVENTID=info_05_list&MENUID=1000005023005&SYSID=PATHFINDER&S_PAGENUMBER=1&S_ROWS=100&S_TTCON=) 하단에서도 확인했다.

협회규정 HTML의 저작물검색·전체검색 메뉴 `href`는 `https://www.komca.or.kr/srch2/srch_01.jsp`였다. 본문 검색 파라미터는 확인하지 않았으므로 임의로 추가하지 않는다. 공개 접근 가능성을 자동 수집 허가로 해석하지 않았으며 작품 결과를 수집하지 않았다. 향후 허용된 공식 API 또는 협회 허가가 확보되면 해당 범위에 맞는 별도 어댑터가 필요하다.

## KOSCAP 공식 근거와 기술 확인

[공식 작품검색](https://www.koscap.or.kr/v2/music/search_list)은 로그인 없이 HTTP 200으로 열렸다. 실제 HTML에서 다음을 확인했다.

- `form#form_sch`의 action: `/v2/music/search_list`, method 미지정(브라우저 기본 GET).
- 작품명: `f_song_name`, 저작자명/코드: `f_artist`, 각 최대 200자.
- 결과 개수: `page_cnt`, 공식 선택지의 최소 10곡.
- 표제: 작품명, 작사, 작곡, 편곡, 가수명, 공표일. 상세 작품번호·ISWC의 실제 결과 데이터는 확보하지 않았다.
- 저작자 검색 버튼의 공개 이동 경로도 존재하지만, 이름 목록 수집이나 추가 상세 조회는 하지 않았다.

같은 페이지 하단 **이용약관** 모달은 HTML 내부 `terms`에 포함된다. 제12조는 사전 승낙 없는 영업 이용과 회원 이용 목적 외 복제·제3자 제공을 제한하고, 제16조 제2항은 동의 없는 정보 가공·판매 등 상업적 사용을 제한한다. 제20조에도 사전 승낙 없는 복제·유통·상업적 이용에 관한 제한이 있다. 공개 검색 폼이 동작한다는 사실만으로 온사이드가 그 결과를 수집·저장·재제공할 수 있다고 판단하지 않았다.

따라서 `prepareCopyrightLookup()`은 확인된 form 필드만 URL에 넣어 **사용자가 공식 사이트에서 직접 검색하도록 이동**시킨다. 온사이드 서버가 이를 요청하거나 결과를 프록시하지 않는다. 기관의 API·이용 허가가 확보되기 전까지 환경변수 하나로 자동 조회를 켜는 우회 경로도 제공하지 않는다.

작품 등록에 필요한 정보는 [KOSCAP 작품등록안내](https://www.koscap.or.kr/v2/admission/regist_info)와 [공식 FAQ](https://www.koscap.or.kr/v2/community/faq)에서 확인할 수 있다. 공개 저작자 정보가 있다는 것과 회원 본인의 신탁 관계·작품 등록 업무가 끝났다는 것은 별개다.

## 구현 계약

`src/lib/music-archive/copyright-providers.ts`는 `copyrightLookupInputSchema`, `prepareCopyrightLookup(input)`을 제공한다. 기관과 제목 또는 저작자 이름을 검증하고 `{agency, query, officialUrl, copyText}`만 반환한다.

이동 준비 결과에는 조회 상태, 조회 시각 또는 빈 후보 목록을 넣지 않는다. 현재 확보되지 않은 기관 작품번호·ISWC·저작자 역할을 만들거나 음원 서비스 크레딧으로 대체하지 않는다.

화면은 **공식 사이트에서 검색**이라고 표시한다. 직접 확인 후 저장한 내용은 `user_input` 또는 증빙이 있으면 `user_evidence`로 보관하며, `official` 조회 성공이나 본인 권리 확인으로 승격하지 않는다. 작품 선택·연결만으로 업무 상태를 완료로 바꾸지 않는다. 같은 제목의 다른 저작물은 저작자·역할·기관 작품번호 등을 비교해 사용자가 구분해야 한다.

## 검증 범위

공식 공개 HTML·메뉴·폼·약관을 실제 HTTP 요청으로 확인했다. 실제 협회 작품 후보 API 조회 또는 운영 자동 연동을 검증한 것은 아니다. 단위 테스트는 한글·특수문자 검색어 전달, 공식 도메인 고정, 길이·제어문자·미지정 필드 차단, 네트워크 호출 부재, 조회/권리/완료 값 미생성을 확인한다.

## 재이용 가능한 대안: 한국저작권위원회 등록정보 API

[공공데이터포털의 한국저작권위원회 저작권등록정보서비스(신규)](https://www.data.go.kr/data/15106731/openapi.do)는 제목·저작자·등록번호로 법적 등록정보를 조회하는 실제 공개 API다. 제공기관은 한국저작권위원회이며, 무료·공공누리 제1유형(출처표시), 개발 자동승인·운영 심의승인으로 안내된다. API 활용 신청 및 서비스키가 필요하다. 이것은 **한국저작권위원회 법적 등록정보**이므로 KOMCA/KOSCAP 작품 신고, 회원 신탁 또는 ISWC 조회를 대신하지 않는다.

공식 포털 HTML이 지정한 [Swagger 명세](https://infuser.odcloud.kr/api/stages/27549/api-docs)를 실제 HTTP 200으로 확보했다. 현재 명세의 HTTPS 경로는 다음과 같다.

- 목록: `https://api.odcloud.kr/api/CpyrRegInforService/v1/getCpyrRegInforUniList`
- 상세: `https://api.odcloud.kr/api/CpyrRegInforService/v1/getCpyrRegInforUniDetail`
- 목록 조건: `cond[CONT_TITLE::LIKE]`, `cond[AUTHOR_NAME::LIKE]`, `cond[REG_ID::EQ]`, `page`, `perPage`.
- 목록 필드: `REG_ID`, `CONT_TITLE`, `AUTHOR_NAME`, `REG_DATE`.
- 상세에는 `CONT_CLASS_NAME`(저작물 종류) 등이 추가된다. 목록만으로 동명 작품이 음악인지 판단하지 않는다.

이 새 서비스의 재이용 조건은 이전 검색 결과에 남은 구형 `openapi.copyright.or.kr` API와 혼동하지 않는다. 구형 공공데이터 항목 15000477, 15000497은 이번 공식 페이지 조회에서 404였다. 문화공공데이터광장에는 공유마당 만료저작물에 관한 안내가 검색되었으나 현재 상세 카탈로그 접속이 502였고, 회원의 최신 협회 등록 음악 전체를 제공한다는 근거는 확인하지 못했다. 만료저작물 자료를 현재 음악가의 작품 등록정보처럼 표시하지 않는다.

`src/lib/music-archive/copyright-registry.ts`에 명세 기반 서버 어댑터를 구현했다. `searchCopyrightRegistrations()`는 사용자가 요청한 한 페이지(10개)만 조회하고, `getCopyrightRegistrationDetail()`은 명시적으로 선택한 등록번호 1건의 종류를 확인한다. 요청은 고정 HTTPS 주소, 10초 제한, 1MiB 응답 제한, 리다이렉트 금지로 실행하며 API 키나 원문 오류를 로그/응답에 노출하지 않는다. 원문에 포함될 수 있는 추가 권리자 정보는 필요한 저작자명·등록번호·제목·일자·종류 외에는 반환하지 않는다.

환경변수는 `COPYRIGHT_REGISTRY_API_KEY`다. 키 미설정 시 `CONFIGURATION_REQUIRED`, 승인/키 오류는 `PERMISSION_REQUIRED`, 한도는 `RATE_LIMIT`, 일시 오류는 `TEMPORARY_ERROR`로 구분한다. 공식 정상 응답이 실제로 비어 있을 때만 `no_results`를 반환한다. 키를 채팅·브라우저에 입력하도록 하지 말고 승인된 서비스키를 운영 서버 환경에 설정해야 한다. 운영 심의 승인과 출처 표시를 완료한 뒤 고객용 조회를 노출한다.

실제 목록 주소에 키 없이 제목 조건·1개 페이지를 요청하여 **HTTP 401 및 인증키 필수 응답**을 확인했다. 키 우회나 등록정보 수집은 하지 않았다. 성공한 데이터 응답은 공식 명세 구조의 합성 fixture로만 검증했으므로 운영 인증 성공으로 보고하지 않는다. 실제 API 키가 준비되면 음악 1건의 제목·저작자·등록번호·종류를 원본과 비교하는 최소 실조회 검증이 필요하다.

후보는 `provider: copyright_commission`, `registrationNumber`, `title`, `authorName`, `registrationDate`, `officialUrl`, 실제 `checkedAt`을 포함한다. 상세 조회 시 `workType`을 추가한다. 확인 결과와 사용자가 선택한 트랙을 연결하더라도 회원 권리를 인증하거나 기관별 업무 완료를 자동 설정하지 않는다. 이 API의 등록번호를 협회 작품번호로 저장해서도 안 된다.
