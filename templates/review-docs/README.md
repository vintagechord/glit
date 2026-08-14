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
트랙명이 Inst./MR 계열이거나 가사와 작사자가 모두 비어 Inst./MR로 판정됐는데
트랙명에 표시가 없으면 `(Inst.)`를 붙입니다. `credit_line`은 Inst./MR의 작사자를
제외해 완성된 한 줄로 전달됩니다.

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
{company_actual}
{manager_name}
{manager_phone}
{release_date_md}
{genre}
{review_songs_text}
{/albums}
```

현재 통합 양식은 표의 첫 번째 데이터 셀에서 `{#albums}`를 열고 마지막 데이터
셀에서 `{/albums}`를 닫아 행 전체의 열 너비, 높이, 테두리, 정렬을 보존합니다.

## 무결성 검사

다음 명령은 파일을 생성하거나 덮어쓰지 않고 7개 템플릿의 존재와 DOCX 구문만
검사합니다.

```sh
node scripts/validate-review-doc-templates.mjs
```
