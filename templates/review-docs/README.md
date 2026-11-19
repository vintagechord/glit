# Review Docs Templates

관리자 심의자료 ZIP은 이 폴더의 DOCX 파일을 **직접 읽어** `docxtemplater`로
렌더링합니다. 이 폴더는 `public` 아래로 옮기지 마세요.

## 필수 파일

- `song-review-request.docx`
- `review-form.docx`
- `lyrics-all.docx`
- `lyrics-track.docx`
- `tbs-integrated.docx`
- `wbs-integrated.docx`
- `pbc-integrated.docx`
- `lyrics-mv.docx` (영등위 가사 전용 모드만 사용)

파일이 없거나 손상되면 임의 양식으로 대체하지 않고 관리자 다운로드 요청을
실패시킵니다. 파일명은 코드와 연결되어 있으므로 유지해야 합니다. 방송사 양식
교체 시에는 같은 파일명과 아래 placeholder 계약을 지킨 DOCX로 교체하세요.

`review-form.docx`는 심의폼과 앨범정보에 공통으로 사용합니다. 심의폼에는
`company_name=빈티지코드`, 앨범정보에는 신청 데이터의 실제 회사명이 들어가며,
나머지 표 구조와 서식은 동일합니다.

## 렌더 규칙

- 문법: `docxtemplater`
- 옵션: `paragraphLoop: true`, `linebreaks: true`, `nullGetter: () => ""`
- 값이 없는 placeholder는 빈 문자열로 렌더링됩니다.
- 트랙/앨범 반복 태그는 현재 표 행 또는 문서 블록의 경계를 결정하므로, Word에서
  태그 위치를 옮긴 뒤에는 단일·복수 데이터로 반드시 검수해야 합니다.
- `{#tracks}`와 `{/tracks}` 또는 `{#albums}`와 `{/albums}`를 삭제하면 해당 반복
  데이터가 출력되지 않습니다.

## 공통 placeholder

- `{today_korean}`, `{today_year}`, `{today_md}`
- `{album_title}`
- `{artist_display}`, `{artist_name}`, `{artist_name_kr}`, `{artist_name_en}`
- `{release_date_full}`, `{release_date_short}`, `{release_date_md}`
- `{production_date_long}`, `{production_date_short}`
- `{production_company_for_review}`, `{production_company_actual}`
- `{company_name}`, `{company_actual}`
- `{distributor}`, `{genre}`, `{genre_checkbox_line}`
- `{track_count}`, `{track_count_label}`
- `{manager_name}`, `{manager_phone}`, `{manager_email}`
- `{title_track_title}`, `{title_tracks_text}`, `{review_songs_text}`

## 트랙 반복 및 트랙 문서 placeholder

```text
{#tracks}
{track_no}
{track_no_padded}
{track_title}
{track_title_with_title_mark}
{featuring}
{lyricist}
{lyricist_display}
{composer}
{arranger}
{performer}
{lyrics}
{lyrics_with_translation}
{credit_line}
{notes}
{is_title}
{is_title_text}
{is_instrumental}
{/tracks}
```

`lyrics-track.docx`는 반복 태그 없이 위 트랙 필드를 최상위에서 사용합니다.
`track_title_with_title_mark`는 제목 표시가 선택된 경우 `(타이틀)`을 붙입니다.
독립 관리자 작업은 확인된 `instrumentalConfirmed`와 `lyricStatus`만 사용합니다.
기존 신청 다운로드도 빈 가사·작사 공백이나 `Mr. Sunshine`을 연주곡으로 추측하지
않습니다. 제목에 임의의 `(Inst.)`를 추가하지 않습니다. `credit_line`은 확인된
Inst./MR의 작사자를 제외해 완성된 한 줄로 전달됩니다.

`lyrics-mv.docx`는 기존 개별 가사 템플릿의 글꼴·용지·여백을 보존하면서 요청된
최소 구성(`{artist_display} - {track_title}`, `{lyrics_with_translation}`)만 남긴
별도 템플릿입니다. 담당자·회사명·크레딧·앨범정보·타이틀 표시가 없습니다.

## 가요심의요청서 배치 변경 (2026-11-03)

`song-review-request.docx`는 심의 데스크가 원본 HWP에서 복원한 15열 양식으로
교체했다. 음반제목 칸이 두 행에 걸치고, 발매일 아래 제작일, 기획사(제작사) 아래
유통사가 오며, 심의요청곡수 행에 담당자(연락처)와 음반형태가 함께 있다.
담당자 이메일 칸은 원본에 없어 출력하지 않는다. 머리글의 `음반접수용(KBS가요심의곡)`은
공백 대신 본문 오른쪽 여백(15138 twip) 위치의 오른쪽 탭으로 정렬한다. 트랙 곡명은
`{track_title_request}`를 사용해 타이틀곡 앞에 `[T]`를 붙인다. 글꼴은 다른 서식과
같은 맑은 고딕으로 통일하고 theme 파트를 넣었다. 같은 파일을 `tools/onside-desk/templates`에
두어 데스크와 서버가 같은 양식을 생성한다. 검증은 `tests/review-docs-docx.test.ts`의
행·칸 구성 검사와 LibreOffice 렌더 확인(글꼴 대체 환경)으로 했다.

## 최소 서식 정상화 (2026-09)

방송국 양식과 가요심의요청서는 기존 파일을 유지했습니다. `review-form.docx`는
요청에 따라 본문·표 텍스트를 11pt로 맞추고, 가사 행의 `cantSplit`과 최소 높이를
제거해 가사가 페이지를 넘어 이어지게 했습니다. 표의 위치·너비·열·병합·테두리와
담당자 표는 보존했습니다. 기존 템플릿에는 플로팅 표가 없습니다.

`lyrics-all.docx`와 `lyrics-track.docx`는 가사 줄간격을 1.15배로 맞추고 다음 곡
제목 앞 여백, 제목·크레딧 `keepNext`만 조절했습니다. 글자 크기는 각각 기존
11/10pt 및 11pt를 유지했습니다. 전체 가사 파일은 곡별 강제 페이지 나눔을 하지
않습니다. 원문 번역은 공통 데이터의 구간 위치를 검증한 뒤 한 번만 합칩니다.
가사 문단은 명시적으로 왼쪽 정렬하고 격자 맞춤을 꺼서 강제 줄바꿈 뒤 글자 간격이
양끝으로 벌어지지 않으며 지정한 줄간격이 적용됩니다. 이는 실제 PDF 렌더 검수에서
발견한 기존 기본 문단의 양쪽 정렬 영향을 수정한 것입니다.

### 최신 프롬프트와 긴 내용의 페이지 흐름 (2026-09-09)

첨부된 `음반심의_서류생성_최신프롬프트.docx`를 출력 규칙으로 반영했습니다.
심의폼·앨범정보의 가사뿐 아니라 앨범명, 회사명, 크레딧 및 방송사 신청서 등
값을 채우는 모든 표 행의 `cantSplit`을 제거했습니다. 해당 행의 문단에는
`keepNext=0`, `keepLines=0`을 명시해 긴 내용이 다음 페이지로 이어집니다.
기존 표의 최소 높이, 글자 크기, 병합과 테두리를 유지하며 고정 높이, 글자 축소,
플로팅 표로 공간을 맞추지 않습니다. 가사 문단도 같은 페이지 흐름을 사용합니다.
가사집의 곡 제목·크레딧을 다음 문단과 묶는 기존 설정은 유지합니다.

PBC·WBS의 제목 행과 TBS의 두 제목 행은 다음 페이지에도 반복됩니다.
템플릿 교체 후 값이 들어가는 표 행에 `cantSplit`, `keepNext`, `keepLines`,
`noWrap`, `tcFitText`가 켜져 있으면 생성 단계에서 오류를 표시합니다.

### TBS·PBC 양식 대응 (2026-11-15 확정)

2026-11-15 운영자가 실제 방송사 양식 이미지로 아래 대응을 다시 확정했다. 첨부 HWP의
파일명(`TBS신청서_예시.hwp`, `PBC신청서_예시.hwp`)과 같은 대응이다. 2026-11-06에는
최신 프롬프트의 설명을 따라 반대로 두었으나 실제 양식과 달랐다. 심의 데스크
2.14.0부터 같은 파일을 쓴다(2.11.0–2.13.x 데스크와 이 날짜 이전 웹은 반대로 만들었다).

- TBS: `음원심의신청서` — 첨부 `TBS신청서_예시.hwp`의 세로 양식.
  원본의 6열, 일자·가수 세로 병합, 신청자/연락처 2단 구성, 앨범명과 타이틀
  2칸을 복원했습니다. 이 예시에는 회사명 칸이 없으므로 새 회사명 칸을 만들지
  않으며 실제 회사명도 TBS에는 출력하지 않습니다. 값 칸은 모두 세로 가운데
  맞춤입니다(2026-11-06 28개 앨범 렌더에서 페이지를 넘는 병합 셀 겹침 없음).
- PBC: `심의 음반 접수 목록` — 첨부 `PBC신청서_예시.hwp`의 **가로** 6열 목록.
  `scripts/review-docs/build-pbc-receipt-list.mjs`가 원본 HWP 수치로 본문을
  만든다: 가로 A4(좌우 여백 700twip), 열 너비 비율 6692:28200:6126:14333:14666:10421,
  제목 13pt 굵게, 머리행 12pt 굵게(음영 없음), 값 10pt, 얇은 실선 테두리.
  일자 `{today_md}`, 가수명/타이틀명 `{artist_display} / {title_track_title}`,
  CD수량 1, 기획사 `{company_actual}`, 연락처 `{manager_phone}`,
  비고(발매예정일) `{release_date_md}`.

TBS의 첫 타이틀 칸은 `{title_track_title_primary}`, 두 번째 칸은
`{title_track_title_secondary}`입니다. 두 번째 칸에는 나머지 지정 타이틀이
들어가며, 타이틀이 하나면 빈칸입니다.

## 통합신청서 placeholder

```text
{station_code}
{station_name}
{submission_count}
{album_count}
{track_count}
{#albums}
{row_no}
{today_md}
{artist_display}
{album_title}
{title_track_title}
{title_tracks_text}
{title_track_title_primary}
{title_track_title_secondary}
{company_actual}
{manager_name}
{manager_phone}
{release_date_md}
{genre}
{review_songs_text}
{/albums}
```

현재 통합 양식은 표의 첫 번째 데이터 셀에서 `{#albums}`를 열고 마지막 데이터
셀에서 `{/albums}`를 닫아 열 너비, 높이, 테두리, 정렬을 보존합니다. PBC/WBS는
앨범당 1행, TBS는 세로 병합을 포함한 2행을 한 단위로 반복합니다.

## 무결성 검사

다음 명령은 파일을 생성하거나 덮어쓰지 않고 8개 템플릿의 존재와 DOCX 구문만
검사합니다.

```sh
node scripts/validate-review-doc-templates.mjs
```

실제 생성 시 필수 곡명·전체 가사, 구성 XML, 미치환 필수 태그, 플로팅 표/고정 행,
예상 DOCX 수와 ZIP CRC를 검사합니다. `validation.rendered`는 항상 `false`이며
이를 육안 검수 완료로 표시하지 않습니다. 템플릿 SHA-256을 작업 결과에 기록합니다.

합성 렌더링 fixture (고객 데이터·외부 API 미사용):

```sh
node --import tsx scripts/review-docs-render-fixtures.ts
```

생성 파일은 `tmp/review-docs-qa/generated`에만 저장합니다. 배포 전 DOCX를
LibreOffice/Word로 PDF·PNG 렌더링하고 모든 페이지의 겹침·잘림·글꼴을 검수해야 합니다.
fixture에는 번역을 포함한 65줄 가사, 한 페이지보다 긴 작곡자 내용, 여러 페이지로
이어지는 8개 앨범의 통합신청서가 포함됩니다. QA용 PDF/PNG는 ZIP에 넣지 않습니다.

2026-09-09 검수: 위 fixture로 생성한 22개 DOCX, 최종 51개 페이지의 PNG를
전부 확인했습니다. 담당자 표 겹침, 번역 가사와 긴 작곡자 셀의 페이지 연결,
TBS/WBS/PBC 반복 제목과 전체 앨범 출력에 잘림·겹침이 없었습니다. PBC는 최초
렌더에서 발견한 세로 병합 셀 겹침을 수정한 뒤 일반·긴 내용 두 경우를 다시
렌더링했습니다. 전용 런타임 로더가 없는 환경이므로 기존 격리 Docker 작업자
이미지의 LibreOffice와 documents 스킬의 `render_docx.py`를 사용했습니다.
사용자의 데스크톱 LibreOffice는 사용하지 않았습니다. 이는 배포 전 fixture
검수이며, 개별 다운로드를 실시간 렌더링했다는 뜻은 아닙니다.

2026-11-15 TBS·PBC 교체 검수: 같은 fixture의 TBS·PBC 통합신청서(2개 앨범, 8개
앨범)를 Mac LibreOffice 26.8로 렌더링했다. Docker 작업자 이미지는 디스크 정리로
지워져 있었고, 이 LibreOffice는 fontconfig를 쓰므로 `FONTCONFIG_FILE`로
`/System/Library/Fonts`와 「맑은 고딕 → Apple SD Gothic Neo」 대체를 지정해야
한글이 보인다. PBC는 가로 A4 한 쪽(2개 앨범)·네 쪽(8개 앨범), TBS는 세로 A4로
나왔고 반복 머리행, 페이지를 넘는 행, 긴 기획사 이름 줄바꿈에 겹침·잘림이 없었다.

2026-11-19 Windows 호환 정리: Windows의 MS Word에서 일부 문서가 열리지 않고 표
선이 보이지 않는다는 보고로 16개 양식(웹 8, 데스크 8)을 ISO/IEC 29500 XSD로
검증했다. 원인은 (1) 가요심의요청서의 `mc:Ignorable`이 선언되지 않은 접두어
(w14·wp14·w15)를 가리킴 — Word가 문서를 거부, (2) 심의폼·TBS·WBS의
`w:tblBorders`가 `w:tblLayout` 뒤에 있어 Word가 테두리를 무시, (3) 테마의 스타일
목록이 1개뿐(3개 필요), (4) `w:pPr`·`w:rPr`·`w:tcPr` 자식 순서 위반, (5) 좌우
테두리를 start/end로 표기, (6) ZIP 폴더 항목이었다. LibreOffice·Pages·Polaris는
모두 너그럽게 열기 때문에 드러나지 않았다. `tools/onside-desk/ooxml-normalize.mjs`
가 이를 바로잡고 표와 칸마다 선을 명시하며, 생성되는 모든 DOCX도 저장 전에
같은 정리를 거친다. 양식을 교체·수정한 뒤에는 아래를 실행한다(멱등).

```bash
node scripts/review-docs/normalize-ooxml.mjs templates/review-docs/*.docx tools/onside-desk/templates/*.docx
```

정리 전후를 같은 fixture로 LibreOffice 렌더링해 20쪽이 픽셀 단위로 같음을
확인했고, 양식 16개와 생성 문서(웹 24종, 데스크 11종)가 XSD 검증을 통과했다.
