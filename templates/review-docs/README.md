# Review Docs Templates

관리자 심의자료 자동 생성 기능은 이 폴더의 DOCX 템플릿을 사용합니다.
이 폴더는 `public` 아래에 두면 안 됩니다.

필수 파일:

- `song-review-request.docx`
- `review-form.docx`
- `lyrics-all.docx`
- `lyrics-track.docx`
- `tbs-integrated.docx`
- `wbs-integrated.docx`
- `pbc-integrated.docx`

위 파일 중 하나라도 없으면 API는 ZIP을 생성하지 않고 다음 메시지를 반환합니다.

`심의자료 템플릿 파일이 없습니다. templates/review-docs를 확인해주세요.`

## Placeholder Rules

템플릿은 `docxtemplater` 문법을 사용합니다.

기본 예:

- `{title}` 또는 `{album_title}`
- `{artist_name}`
- `{artist_name_kr}`
- `{artist_name_en}`
- `{release_date}`
- `{genre}`
- `{distributor}`
- `{production_company}`
- `{company_name}`
- `{planning_company}`
- `{agency_company}`
- `{label_company}`
- `{applicant_name}`
- `{applicant_email}`
- `{applicant_phone}`
- `{guest_name}`
- `{guest_company}`
- `{guest_email}`
- `{guest_phone}`
- `{contact_name}`
- `{contact_email}`
- `{contact_phone}`
- `{generated_at}`

트랙 반복 예:

```text
{#tracks}
{track_no}. {track_title}
작곡: {composer}
작사: {lyricist}
편곡: {arranger}
가사:
{lyrics}
번역 가사:
{translated_lyrics}
{/tracks}
```

단일 트랙용 `lyrics-track.docx`에서는 아래 placeholder도 사용할 수 있습니다.

- `{track_no}`
- `{track_no_padded}`
- `{track_title}`
- `{featuring}`
- `{composer}`
- `{lyricist}`
- `{arranger}`
- `{lyrics}`
- `{translated_lyrics}`
- `{notes}`
- `{is_title_label}`
- `{title_role}`
- `{broadcast_selected_label}`

통합 신청서 템플릿에서는 아래 값을 사용할 수 있습니다.

- `{station_code}`
- `{station_name}`
- `{submission_count}`
- `{album_count}`
- `{track_count}`
- `{#submissions}...{/submissions}`
- `{#albums}...{/albums}`
- `{#tracks}...{/tracks}`

`review-form.docx`는 `심의자료.docx`와 `앨범정보.docx` 생성에 재사용됩니다.
두 문서는 `document_title`, `document_kind`, `company_name`,
`planning_company`, `production_company`, `agency_company`,
`label_company` 값이 다르게 주입됩니다.
