# 온사이드 수정 및 심의자료 생성 작업 보고

작업일: 2026-09-07. 시작 브랜치는 `main`이며 시작 시 미커밋 변경은 없었다.
사용자가 2026-09-07 운영 배포를 승인하고 Supabase 프로젝트를 resume했다.
인증 health와 상품 catalog API는 모두 HTTP 200으로 복구를 확인했다.
운영 DB에는 미적용 마이그레이션이 0094 하나뿐임을 dry-run으로 확인하고 적용했으며,
새 테이블 4개가 모두 정상 조회된다. 웹 배포와 워커 구성은 진행 중이며 최종 상태는
[운영 배포 기록](deployment-report.md)에 기록한다.

인증 코드는 한국어 검증/오류 메시지, 기존 짧은 비밀번호 계정의 로그인 허용,
비밀번호 재설정 연결 오류의 중복 요청 제거, PKCE·OTP·implicit recovery 및
재설정 토큰 중복 교환 방지를 적용했다. 로컬에는 RESEND_API_KEY가 없지만
운영 Render에는 설정돼 있고 운영 health의 email 검사가 통과한다.
실제 계정 로그인 성공·회원가입 완료·메일 수신은 계정 기반 확인이 필요하다.

## A. 관리자 메뉴와 세 가지 탭

`/admin/review-docs`와 관리자 홈의 **심의자료 생성** 링크를 추가했다.

1. 기준파일로 음반 심의자료 생성: 여러 파일 업로드 → 분석 → 원문·근거 비교 → 수정 → 생성 → 다운로드.
2. 멜론·지니 URL로 생성: 여러 앨범 URL, 중복 차단, 곡 수 표시, 같은 편집·생성 화면.
3. 영등위 가사파일: 아티스트·곡명·가사로 곡별 DOCX 및 ZIP만 생성.

앨범 합치기/분리, 곡 이동/순서, 파일 연결, 메타데이터·크레딧·가사·번역 수정,
필수 확인 항목, 작업 상태, 최근 20개 이력, 취소·실패 재시도, 버전별 결과 표시를
구현했다. 실패한 원본만 다시 분석하며 수동 변경과 의도적으로 비운 값은 보존한다.
원본 추출 실패는 확인 체크만으로 무시할 수 없다.

## B. 실제 재사용한 함수

| 기능 | 실제 구현 | 재사용 방법 |
| --- | --- | --- |
| 멜론 | `src/lib/melon.ts`: `fetchMelonAlbumReviewData` | 기존 파서를 안전한 fetch adapter와 직접 호출 |
| 지니 | `src/lib/genie.ts`: `fetchGenieAlbumReviewData` | 동일, 부분 곡 수집 실패를 별도로 보존 |
| 원클릭 문서 | `src/lib/admin/review-docs.ts`: `buildReviewDocsZip` | 렌더링을 `renderPreparedReviewDocuments`로 분리해 기존/신규 경로가 공유 |
| 새 독립 생성 API | `generateReviewDocuments` | 확정 스냅샷만 입력, DB·결제·주문 부작용 없음 |
| DOCX | `renderReviewDocTemplate`, Docxtemplater/PizZip | 기존 템플릿과 반복 영역 유지 |
| ZIP | 기존 `yazl` | 공통 앨범/영등위 출력 ZIP |
| 번역 | `translateLyricsWithOpenAI` | 기존 제공자·환경설정, 원문 구간만 전달 |
| 인증 | `requireAdminForApi`, `requireAdminPage` | 모든 API와 페이지 진입점에서 확인 |
| 저장 | 기존 `getB2Config` / S3 client | 실제 private bucket 확인 후 전용 객체 저장 |

기존 멜론/지니 원클릭 UI·API는 유지했다. 새 도구는 공개 신청 API를 호출하지 않으며
가짜 신청서·주문·결제·submission_events를 만들지 않는다.

## C. 추가·수정 파일

전체 경로는 [변경 파일 목록](changed-files.md)에 기록했다. 주요 경계는 다음과 같다.

- `src/features/auth/`, `src/app/reset-password/`, `src/lib/supabase/`: 인증 수정/연결 진단.
- `src/app/admin/review-docs/`, `src/features/review-docs/`: 관리자 화면/편집 로직.
- `src/app/api/admin/review-docs/jobs/`: 작업 생성·조회·수정·재시도·다운로드.
- `src/lib/review-docs/`: 공통 모델, 파일/URL/번역, 영속 작업·비공개 저장.
- `src/lib/admin/review-docs*.ts`, `templates/review-docs/`: 공통 기존 생성기/양식.
- `services/review-docs/`, `scripts/review-docs/`: 격리 변환기와 명시적 작업 프로세스.
- `supabase/migrations/0094_review_document_jobs.sql`: 추가형 작업/이력/RLS/RPC.
- `tests/review-docs-*`, `tests/fixtures/review-docs/`, `tests/sql/review-document-jobs.sql`: 회귀/입력/권한/작업 검증.

격리 SQL 검증은 저장소 루트에서 `bash scripts/review-docs/test-jobs.sh`로 재실행할 수 있다.
이 스크립트는 전용 Docker PostgreSQL만 사용하고 종료 시 해당 컨테이너를 정리한다.

Next dev가 자동 작성한 `AGENTS.md`와 `CLAUDE.md`도 포함된다. QA PNG/PDF,
가상환경, Playwright 임시 결과는 버전 관리에서 제외했다.

## D. 입력 형식과 실제 검증

| 형식 | 구현/실제 fixture 검증 | 확인 범위 |
| --- | --- | --- |
| DOCX | 본문·표·병합 정보·체크박스·콘텐츠 컨트롤 | 2트랙/반복 가사, 여러 앨범, 수정본 충돌, 개수 불일치 |
| 바이너리 DOC | OLE WordDocument/암호화 확인 + antiword | LibreOffice Word97로 만든 실제 바이너리, 2트랙/표의 여러 줄 가사 |
| RTF 기반 DOC | 실제 RTF 판별 + striprtf | 한글/반복 가사, 필수 변환 검토 경고 |
| HWP 5 | pyhwp 전체 BodyText/표, 압축 사전 검사 | 실제 압축 HWP 2트랙, 전체 가사/표, 암호화 거절 |
| 텍스트 PDF | pdfplumber의 좌표·표·본문 정렬 | 한글, 페이지 내 앨범 제목/표의 순서, 2앨범 |
| 스캔 PDF | image-only 페이지에 Poppler/Tesseract | Docker에서 `kor+eng+jpn` OCR 실행 및 OCR block 반환 |

OCR fixture의 일부 텍스트는 부정확하게 인식되었다. OCR/복잡한 표/다단/혼합
이미지 PDF는 관리자 확인을 요구한다. 복잡한 임의 양식을 완전히 이해한다고
가정하지 않으며 대응되지 않은 원문은 보존한다. DOC/HWP의 렌더링 페이지 수는
추출만으로 확정하지 않는다. 80쪽 상한은 PDF에 적용한다. HWPX는 미지원이다.

입력 테스트 13개는 실제 Linux Docker 변환 환경에서 모두 통과했다. 멜론·지니는
저장된 HTML fixture로 기존 수집 경로를 검증했으며 반복 실사이트 수집은 하지 않았다.

## E. 음반 ZIP 구성

```text
[아티스트 - 앨범]/
  가요심의요청서_[아티스트 - 앨범].docx
  심의폼_[아티스트 - 앨범].docx
  앨범정보_[아티스트 - 앨범].docx
  가사전체파일_[아티스트 - 앨범].docx
  01_[곡명].docx
  ...트랙 수만큼...
통합신청서/
  TBS신청서_통합.docx
  WBS신청서_통합.docx
  PBC신청서_통합.docx
```

DOCX 수 = 앨범 수 × 4 + 총 트랙 수 + 3. 1앨범/2곡은 9개, 2앨범/3곡은
14개로 검증했다. 방송사 신청서는 전체 앨범을 합쳐 각각 한 개다.

## F. 영등위 가사 전용 출력

`영등위_가사/01_[아티스트] - [곡명].docx` 형식이다. 제목/가사 11pt, 곡마다
한 파일을 만든다. 한 곡이면 DOCX 개별 다운로드와 ZIP을 모두 제공한다.
앨범명·회사·발매일이 없어도 생성할 수 있으며, 담당자·크레딧·신청서는 넣지 않는다.
실제 영등위 신청·영상 분석·심의 판정은 하지 않는다.

## G. 번역·타이틀·Inst./MR·누락 정보

원문 문자열과 문자 위치를 연결한 번역 구간을 공유하여 반복 구절도 보존한다.
외국어 뒤에 `(번역 : 한글 번역)`을 붙이며 기존 inline 번역은 중복하지 않는다.
별도 번역은 줄번호만으로 합치지 않고 관리자가 구간을 확인한다. 제공자 실패나
빈 번역은 가짜 번역으로 대체하지 않는다. 새 번역은 확인 후 생성한다.

명시적 타이틀만 반영하며 빈 체크박스/단순 항목명/불명확 표시는 확정하지 않는다.
`Mr. Moon`은 연주곡으로 오인하지 않는다. Inst./MR 확인 시 작사 빈칸 및
`가사 없음 / Instrumental`을 적용한다. 가사 미제공·수집 실패·확인된 가사 없음은
구분한다. 회사 누락은 경고/빈칸이며 신청자명·유통사를 회사로 추측하지 않는다.
제작일 누락 시 발매일을 적용하고, `9월 중` 같은 원문은 그대로 보존한다.
신청일은 작업 시작 시 서울 날짜로 한 번 저장한다.

## H. 템플릿 보존과 렌더링

기존 템플릿 7개를 사용하고 영등위 최소 가사 양식 1개를 기존 가사 양식에서
분리했다. 심의폼과 앨범정보는 회사명만 달라야 한다는 실제 출력 검사를 통과했다.
표 구조·병합·너비는 보존하고, 지정 글자 크기/가사 행 분할/문단 정렬만 조정했다.

DOCX 16개를 PDF/PNG 29페이지로 렌더링하여 모두 열어 확인했다. 표 겹침·셀
침범·가사 잘림·완전히 빈 페이지는 없었다. 한국어 글꼴은 로컬 대체 폰트를 사용했다.
Windows Word/맑은 고딕 환경은 미검증이다. [자세한 검수 기록](generator-qa.md)을 참고한다.

런타임은 DOCX 구조·필수 텍스트·반복 항목·미치환 태그·ZIP CRC를 검사한다.
각 실제 생성 결과의 `rendered` 값은 `false`이며 자동 육안 검수 완료로 표시하지 않는다.
내부 QA PDF/PNG는 제출 ZIP에 포함하지 않는다.

## I. 권한·비공개 저장·다운로드

새 API 10개 모두 인증/관리자 확인을 거치며, 실제 Next 서버의 미로그인 요청은
401, 일반 회원 session fixture는 403이었다. 작업 생성자와 요청자 ID가 다르면
조회/수정/파일 접근을 차단한다. 클라이언트의 isAdmin 값은 사용하지 않는다.
상태 변경에는 Origin·요청량·실제 바이트 제한이 있다.

B2 Native API로 실제 버킷의 `allPrivate` 설정을 읽어 확인했다. 객체 경로는 서버가
생성하는 UUID와 기존 `B2_PREFIX` 아래 전용 `review-doc-jobs/` 경로이며, 공개 경로나 공유 URL을
반환하지 않는다. 다운로드 API가 파일을 읽고 해시를 검증해 직접 전달한다.
`Content-Disposition`, `Cache-Control: private, no-store`, `nosniff`를 설정했다.
공개 prefix만으로 비공개를 판단하지 않는다. [Backblaze 버킷 유형 문서](https://www.backblaze.com/apidocs/b2-list-buckets).

원본·출력·수정 데이터는 7일 후 접근을 차단하고 워커가 삭제한다. 삭제가 실패하면
다시 시도하며, 작업 메타데이터/이력은 90일 후 삭제한다. 정리 대상은 전용 작업
객체뿐이며 기존 고객 첨부·결제 파일은 포함하지 않는다. 관리자별 RLS와 서비스
역할 전용 쓰기/RPC도 로컬 PostgreSQL에서 검증했다.

## J. 의존성·설정·워커·마이그레이션

새 npm 패키지는 추가하지 않았다. 기존 Docxtemplater/PizZip/yazl/Busboy/S3/
Supabase/Zod/tsx를 사용한다. Python reader 의존성 13개는 버전을 고정했다.
antiword, Poppler, Tesseract와 한글·영어·일본어 언어팩, Noto CJK 및 LibreOffice는
전용 Docker 이미지에 설치한다. 구체적인 형식·자원 제한은 [변환기 안내](../../services/review-docs/README.md)에 있다.

- `REVIEW_DOCS_PYTHON`: 로컬 전용 가상환경의 Python 경로. Docker는 자동 지정.
- `REVIEW_DOCS_B2_BUCKET`: 선택 사항. 비공개 기존 B2_BUCKET을 그대로 쓰면 생략.
- `B2_PREFIX`: 웹과 워커가 같은 값을 사용한다. 심의자료 경로는 이 prefix 아래에
  배치되어 기존 애플리케이션 키의 경로 제한을 유지한다. 생성 후 prefix를 변경하지 않는다.
- 기존 Supabase URL/키, B2 endpoint/region/key 및 OPENAI 설정을 재사용한다.
- 신규 `0094_review_document_jobs.sql`에는 작업/이력/객체목록/heartbeat와 RLS,
  dedup·상태변경·단일 워커 claim RPC를 포함한다. 사용자 배포 승인 후 운영에 적용했다.

```sh
docker build -f services/review-docs/Dockerfile -t onside-review-docs-worker .
# 검증된 별도 환경변수 파일을 사용하는 로컬/테스트 실행 예
docker run --rm --env-file /path/to/review-worker.env --memory=2g --pids-limit=128 onside-review-docs-worker
# 변환기와 환경변수가 준비된 호스트에서는
npm run review-docs:worker
```

영속 작업은 Supabase에 저장하고 워커가 claim한다. Node 작업 자식 프로세스는
V8 384MiB/15분 제한이며, 변환기는 Linux 메모리 768MiB/90초 제한이다.
리스 갱신과 취소 시 프로세스 그룹 종료, 변환 자식의 부모 종료 연동을 적용했다.
HTTP 응답 후 웹 프로세스에서 임시 작업을 계속하는 구현은 사용하지 않는다.

초기 상한: 8파일/각 10MiB/총 40MiB, 8앨범/총 100곡, PDF 파일당 80쪽,
원문 총 600,000자, 번역 요청당 60,000자, 추가 번역 요청 3회,
관리자당 진행 중 3작업, 전체 변환 동시 1작업. 합성 8앨범/100곡/135 DOCX
검사는 Docker 2GiB·Node 384MiB에서 3.13초, peak RSS 196MiB,
ZIP 776,602바이트로 통과했다. 이 최대 곡 수 검사는 구조/자원 검사이며
135문서 전 페이지의 육안 검수는 아니다. 최대 크기 스캔 PDF의 처리 성능은 별도
실데이터 부하 검증이 필요하다.

`render.review-docs.yaml`은 별도 워커 Blueprint의 검토용 파일이다. 기존
`render.yaml`에는 추가하지 않았다. 신규 유료 서비스 승인 없이 적용하지 않는다.
[Render 워커 실행 방식](https://render.com/docs/background-workers)을 따르는 명시적
프로세스이며, 상태/파일을 Render 로컬 디스크에만 보관하지 않는다.

## K. 회귀와 통합 검증

- 변경 전 기존 테스트 362개 통과.
- 최종 Node 테스트: 421개 통과, 실제 converter 가상환경을 요구하는 1개 건너뜀.
- 건너뛴 형식 테스트를 포함한 입력 테스트 13개는 Docker에서 모두 통과, skip 없음.
- Next 실제 API 인증/관리자 리다이렉트 Playwright 2개 통과; 회원가입 한글 오류/잘못된 재설정 화면도 실제 브라우저 검증.
- 실제 UI 컴포넌트 + fixture API Chromium: 업로드 탭/URL 중복/원본 비교/수정 보존/저장/생성/다운로드/재시도/모바일 검사 통과.
- 일반회원 권한·인증 성공/실패 처리는 session/provider fixture로 검증했다.
- 워커 스냅샷→실제 DOCX·ZIP→저장 완료/취소 처리는 외부 저장·DB transport fixture로 검증했다.
- 실제 PostgreSQL 17에 추가 마이그레이션 적용, dedup/소유권/RLS/동시 실행/버전/재시도 상한/만료를 검증했다. 컨테이너를 실제 재시작한 뒤 저장 작업과 만료 리스 복구도 확인했다.
- TypeScript와 변경 범위 ESLint, Next production build 및 worker Docker build/start 통과.

기존 신청·결제·회원·업로드·관리자 회귀 테스트를 실행했다. 실제 결제/메일이나
운영 계정 변경은 테스트하지 않았다. 한글/Japanese 파일명은 유지하며 경로 탈출,
위장 확장자, XML 엔티티, 매크로, 공개 저장소, 잘못된 ID, 내부 URL 등을 검사했다.

## L. 남은 검증과 운영 상태

최신 배포 진행·운영 검증 결과는 [운영 배포 기록](deployment-report.md)을 따른다.
Supabase DNS 장애는 resume 후 해소됐으며 운영 0094 마이그레이션 적용을 완료했다.
B2의 기존 키 prefix 제한을 확인하고 동일 B2_PREFIX 아래 전용 경로를 쓰도록 보완했다.
웹·워커에는 같은 기존 B2_PREFIX를 사용한다.

실제 계정 로그인·재설정 메일 수신, 실제 번역 API, 최대 크기 스캔 PDF,
제출 환경의 Word/맑은 고딕은 별도 확인이 필요하다. OCR과 복잡한 양식의 추출 결과는
관리자가 원문과 비교해 확인해야 한다. 신규 유료 워커 개설은 원 요청의 별도 승인 조건을 따른다.
