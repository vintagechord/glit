# 심의자료 템플릿 근거와 편집 계약

참고 원본은 사용자가 지정한 20261007 프롬프트와 예시 7개이며 원본은 변경하지 않는다. HWP 전체 본문과 표를 pyhwp XML로 읽어 목록·필드·열을 확인했다. 기존 저장소의 HWP 기반 DOCX 전환 파일은 이 프로그램으로 복사하여 사용한다.

## 원본과 매핑

- 앨범정보_예시.docx — SHA-256 `a0b3a1aec448df82f3dbf03a30d175dd0c2b4b31a6802d9fb2d7b54e096c0a1f`
- PBC신청서_예시.hwp — SHA-256 `20eadddd5bbcf781670f254fd7bf40a494a220c2935daadd1400a8178e2cd8e4`
- 음반심의_서류생성_최신프롬프트_20261007_예시양식준수.docx — SHA-256 `6ba06823fa600528f8ef9647c4a6aef9e04e19bd6f045ed3b895ef28f8bbdf41`
- TBS신청서_예시.hwp — SHA-256 `fc8406486bb9cfdae5af95ac4eb12d1b5fc33590b7b8f633fed672c735c0a145`
- 가사 트랙별 개별 파일_예시.hwp — SHA-256 `cbca86edcdabbc609fde3d346acc8b65dae6d2fd01d3f49e1d611b368fde046a`
- 가사전체파일_예시.hwp — SHA-256 `9891ba61142a99336414527f0d0f029bcb8d635546068dd7a06904b0a4692830`
- WBS신청서_예시.hwp — SHA-256 `5e2eb15bea87de5ba03fe33576028ce82ec9ee93d159af0a2981f47e44dbfee0`
- 가요심의요청서_예시.hwp — SHA-256 `860226d294bf5c4c0a8aed3b955cf629550112f18bb7058744c52e3c8232e55a`

## 서식과 슬롯

각 DOCX의 기존 OOXML 구역·스타일·용지·여백·표·병합·번호·관계 파일을 유지하고 docxtemplater 태그 위치에만 신청 값을 넣는다. 반복 트랙은 기존 행/블록을 사용한다. 추가 워드 제목·장식 표는 생성하지 않는다. 편집 필드는 album_title, artist_display, 날짜, company_name, 크레딧, 가사와 tracks/albums 반복이다.

가요심의요청서는 하나의 연속 표를 유지한다. 상단 반복행 및 강제 페이지 이동을 해제하고 [T] 표시용 트랙 슬롯만 변경했다. 원본 예시에 없는 담당자 이메일은 제거했다. 심의폼과 앨범정보는 company_name 이외에 동일 데이터를 사용한다. 별도 심의폼 예시가 없으므로 제공된 앨범정보 예시와 기존 동일 구조 양식을 사용한다.

PBC 파일은 심의 음반 접수 목록 6열, TBS 파일은 음원심의신청서 세로 병합 6열, WBS 파일은 9열이다. 최신 프롬프트의 실제 파일명 우선 규칙을 적용했다. 이는 저장소의 과거 출력 명칭과 반대이며 혼동을 확인사항에 명시한다.

가사 원문은 개별 가사·심의폼·앨범정보에 원래 줄 구조로 넣는다. 전체 가사집만 실제 LibreOffice 페이지 수가 3보다 클 때 빈 줄로 구분된 구간 내부 줄을 연결한다. 원문 문자와 반복 순서는 유지한다.

## 섹션 근거

- lyrics-all.docx: [{'page': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w': '11906', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h': '16838'}, 'margins': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}top': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}right': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}bottom': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}left': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}header': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}footer': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}gutter': '0'}}]
- lyrics-track.docx: [{'page': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w': '11906', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h': '16838'}, 'margins': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}top': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}right': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}bottom': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}left': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}header': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}footer': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}gutter': '0'}}]
- song-review-request.docx: [{'page': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w': '16838', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h': '11906', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}orient': 'landscape'}, 'margins': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}top': '400', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}right': '700', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}bottom': '400', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}left': '700', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}header': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}footer': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}gutter': '0'}}]
- pbc-integrated.docx: [{'page': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w': '11906', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h': '16838'}, 'margins': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}top': '1100', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}right': '1200', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}bottom': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}left': '1200', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}header': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}footer': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}gutter': '0'}}]
- lyrics-mv.docx: [{'page': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w': '11906', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h': '16838'}, 'margins': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}top': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}right': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}bottom': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}left': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}header': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}footer': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}gutter': '0'}}]
- tbs-integrated.docx: [{'page': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w': '11906', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h': '16838'}, 'margins': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}top': '1100', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}right': '1200', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}bottom': '900', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}left': '1200', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}header': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}footer': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}gutter': '0'}}]
- wbs-integrated.docx: [{'page': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w': '16838', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h': '11906', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}orient': 'landscape'}, 'margins': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}top': '700', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}right': '700', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}bottom': '700', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}left': '700', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}header': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}footer': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}gutter': '0'}}]
- review-form.docx: [{'page': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w': '11906', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h': '16838'}, 'margins': {'{http://schemas.openxmlformats.org/wordprocessingml/2006/main}top': '850', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}right': '907', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}bottom': '850', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}left': '907', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}header': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}footer': '720', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}gutter': '0'}}]

## 검증 한계

HWP는 입력 양식이며 출력은 DOCX이다. 기존 DOCX 변환 템플릿의 구성 요소를 보존하지만 HWP 원본과 글꼴별 픽셀 동일성을 보증하지 않는다. 이 환경에 바탕/굴림 등 원본 글꼴이 없어 격리 LibreOffice의 Noto CJK 대체 글꼴로 검수한다. 실제 Word/한컴에서 모든 생성 건의 인쇄 미리보기를 확인해야 한다. 합성 fixture의 렌더 결과와 신청별 자동 페이지 수 검사는 별개이다.

## 요청서 원본 복원

가요심의요청서는 최종 검수 중 기존 저장소의 9열 변형을 발견해, 지정된 HWP 원본을 pyhwp→ODT→LibreOffice DOCX로 변환한 새 템플릿으로 교체했다. 변환 중 균등화된 숨은 그리드 폭은 원본 HWP TableCell의 col/colspan/width 제약을 풀어 15열 폭(775, 948, 2012, 866, 146, 1635, 160, 1078, 1804, 649, 1640, 500, 509, 1166, 1335 twip)으로 복원했다. 앨범 제목 2행 병합, 담당자 행, 모든 기존 칼럼을 유지하고 빈 예시 행만 제거했다. 요청서의 보존 기준은 최종 source-request.docx 및 원본 HWP 구조이며 오래된 저장소 템플릿이 아니다.

최종 긴 크레딧 검수에서 원본 트랙 셀의 1.6배 줄간격이 페이지 수를 불필요하게 늘려, 해당 반복 트랙 셀 문단만 1.15배로 조정했다. 글꼴 크기·열 너비·용지·여백·모든 이름을 유지하며 상단 폼과 안내문은 변경하지 않았다.
