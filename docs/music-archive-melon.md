# 멜론 공개 아티스트 자료 조사

확인일: 2026-09-08. 이번 변경에는 미확인 네트워크 계약에 의존하는 멜론 수집 코드를 포함하지 않는다. 소량 기술 확인에 성공한 사실과 운영 사용 허용 여부를 구분한다.

기본 TLS 검증을 유지하고 로그인·쿠키 없이 `OnsideMusicArchiveResearch/1.0 (read-only compatibility check)` User-Agent로 공식 홈페이지, artist/song.htm의 아티스트 261143 페이지, robots.txt를 각 1회 확인했다. 모두 HTTP 200이었다. 아티스트 페이지에서 아이유라는 이름, 앨범·곡 ID, 발매 201곡/참여 26곡, 한 페이지 50곡, `songPaging.htm`과 발매 A·참여 F 분류를 관찰했다. JavaScript 실행, 브라우저 가장, CAPTCHA/IP 차단 우회, 음원·가사 다운로드는 하지 않았다.

자료가 공개되어 기술적으로 읽힌다는 이유로 온사이드의 자동 접근·저장·회원 재표시가 허용되었다고 판단하지 않았다. [현재 일반 이용약관](https://info.melon.com/terms/web/terms1_1.html) 제17조 제7항 및 제20조 제1항 제2호는 서비스로 얻은 정보의 영리 이용·제3자 제공·사전 승낙 없는 복제와 유통 등에 제한을 둔다. 실제 [robots.txt](https://www.melon.com/robots.txt)는 일반 User-agent에 `/global-k-chart` 이외 경로를 허용하지 않는다. Googlebot 등 특정 로봇의 허용 규칙을 온사이드에 적용하거나 이를 가장하지 않았다. 운영 수집은 활성화하지 않았다.

[공식 파트너센터 안내](https://partner.melon.com/partrct/svcguide/web/svcguide_tab1.htm)는 아티스트·마케팅 관리 기능을 설명하지만, 온사이드의 공개 아카이브 수집에 바로 사용할 수 있는 무인 조회 API 계약을 확인하는 근거가 되지는 않았다. 공식 홈페이지의 검색 폼은 JS가 action을 지정하는 구조였다. 실제 검색 목적지 및 페이지 offset 파라미터를 검증하기 전에 우선순위가 공식 Apple 검색 API로 변경되었으므로 그 값을 추정하거나 구현 완료로 표시하지 않았다. 멜론 ID 882441과 Apple 후보 IDs는 별개의 식별자이며 이름만으로 합치지 않는다.

국내 대체 제공처도 명칭만 보고 API가 있다고 판단하지 않았다. [벅스 현재 약관](https://music.bugs.co.kr/rules/use) 제15조 제7항/제18조 제1항 제2호에서 유사한 정보 이용 제한을 확인했고 [공식 제휴 안내](https://music.bugs.co.kr/cooperation)를 확인했다. [지니 공식 제휴 안내](https://www.geniemusic.co.kr/love/alliance.do)는 사업 제휴·음원 계약·유통의 문의 경로를 공개한다. 이는 공개 무제한 메타데이터 API의 허가나 명세가 아니다. 로그인 URL 또는 비공식 GitHub 래퍼를 공식 데이터 API로 사용하지 않았다. 외부 문의 발송이나 계약 신청은 하지 않았다.
