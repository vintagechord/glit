# 심의자료 워커 연결

## 2026-09-10: 기존 웹 서버 자동 처리 추가

전용 워커가 없는 기존 Node 웹 서비스에서도 **DOCX와 멜론·지니 URL의 분석,
번역 요청, DOCX/ZIP 생성**을 실행한다. `0103_review_document_web_dispatcher.sql`을
적용하고 웹을 배포하면 별도 서비스 개설이나 플랜 변경 없이 사용할 수 있다.
`after()`가 저장된 작업을 시작하며, 기존 Render `npm start`에서는 15초 주기
dispatcher가 브라우저를 닫거나 서버가 재시작된 뒤에도 대기열을 재개한다.

웹 처리기는 전용 워커와 같은 데이터베이스 단일 lease를 사용하지만 전용 워커의
heartbeat는 기록하지 않는다. 전용 워커가 연결되면 그 워커가 우선한다. DOCX는
Node에서 표·가사·체크박스와 근거 위치를 읽으며, 압축 크기·CRC·XML·매크로 및
외부 엔티티를 검증한다. 외부 관계 링크나 삽입 개체는 실행하지 않는다.
설정 검사는 읽기 전용 RPC로 실제 0103 함수 설치 여부와 DOCX 템플릿을 확인한다.

**기존 Node 배포에서 DOC/HWP/PDF 분석은 여전히 전용 변환기가 필요하다.**
공개 `/forms`의 DOC/HWP 신청서도 이 제한에 해당한다. Word/한글에서 작성한
자료를 DOCX로 저장하면 바로 업로드할 수 있으며 화면에도 이 형식 제한을 표시한다.
이미 분석된 DOC/HWP/PDF 작업의 번역과 문서 생성은 웹에서도 가능하다.
`OPENAI_API_KEY`가 없으면 외국어 번역을 직접 입력·확인해야 한다.
`REVIEW_DOCS_WEB_DISABLED=true`는 웹 자동 처리를 끄고 기존 전용 워커만 사용한다.

### 기존 웹 서비스를 Docker로 실행하여 전체 형식을 지원하는 선택 경로

`services/review-docs/Dockerfile.web`은 웹과 전체 변환기를 같은 서비스 이미지에
설치한다. `scripts/review-docs/start-web.mjs`는 웹과 사전 검사를 통과한 워커를
함께 시작하고 워커가 종료되면 15초 후 다시 시작한다. 웹 종료/배포 시 양쪽
프로세스에 종료 신호를 전달하며 10초 후 남은 프로세스를 정리한다.

이 경로는 **최소 2GB 메모리** 환경용이다. 현재 `render.yaml`의 512MB starter에서
전체 DOC/HWP/PDF/OCR 실행을 보장하지 않으며 무리하게 함께 실행하도록 바꾸지
않았다. 기존 서비스의 Docker 런타임 전환과 자원 검토는 운영 변경이고 이번 소스
작업에서는 실행하지 않았다. 새 서비스나 플랜 변경을 자동 수행하는 Blueprint도
추가하지 않았다.

검증/실행 순서는 다음과 같다. 공개 Supabase 설정만 빌드 인자로 전달하고 서비스
키·B2 키·번역 키는 빌드 인자에 넣지 않는다. `.dockerignore`는 `.env*`를 제외한다.

```sh
docker build --platform linux/amd64 -f services/review-docs/Dockerfile.web \
  --build-arg NEXT_PUBLIC_SUPABASE_URL \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY \
  -t onside-review-web .
docker run --rm --memory=2g --pids-limit=256 \
  --env-file /path/to/review-web.env onside-review-web npm run review-docs:check
docker run --rm --memory=2g --pids-limit=256 -p 3000:3000 \
  --env-file /path/to/review-web.env onside-review-web
```

운영에는 0103 적용과 웹 배포가 필요하다. 운영 heartbeat·실제 고객 자료의 분석과
다운로드를 확인하지 않았으므로 소스 검증과 운영 복구를 구분한다.

## 2026-09-08 장애 원인

운영 DB의 `review_document_worker_heartbeat`는 비어 있었고 생성 작업도 없었다.
웹 시작 명령 `next start`는 별도 워커를 실행하지 않는다. 최초 배포는 추가 비용 없이
웹·DB만 반영하기로 하여 전용 워커를 만들지 않았다. 따라서 웹 재배포나 DB 재적용만으로는
문서 생성 기능이 켜지지 않는다. 경고를 숨기거나 heartbeat만 기록해서는 안 된다.

이번 변경은 연결 후 관리자 화면을 자동 복구하고, 실행 환경이 준비되기 전에 워커가
준비 완료로 표시되는 것을 막는다. 새 DB 마이그레이션은 필요하지 않다.

## 적용할 운영 구성

- 서비스: `onside-review-docs-worker`, Background Worker / Docker, 1대.
- 사양: `standard` (현재 이름 `1c-2g`), 1 CPU / 2GB RAM.
- 기본 실행 비용: 월 US$25. 자동 번역 API 및 기존 저장소의 사용량 과금은 별도.
- 저장소: `vintagechord/glit`, 검증된 변경이 반영된 `main`.
- Dockerfile: `services/review-docs/Dockerfile`, context: 저장소 루트.
- 실행 명령: 이미지의 `npm run review-docs:worker`.
- 환경 그룹: 기존에 준비한 `onside-review-docs`를 연결한다.
- 리전: 인증 후 기존 `glit`의 리전을 확인해 맞춘다.
- 추가 DB·Redis·디스크는 만들지 않는다. 워커 자동 배포는 꺼 둔다.

2026-09-08 확인한 [Render 가격표](https://render.com/pricing)의 Services & Workers 기준이다.
[`standard` 호환 이름](https://render.com/docs/compute-plans#legacy-plan-names)은 계속 지원된다.
새 워커 생성은 이전의 추가 비용 없음 조건을 변경하므로 비용 확인 후 진행한다.

별도 Blueprint 파일은 `render.review-docs.yaml`이다. Render의 New → Blueprint에서
이 파일을 선택하고 생성 대상이 위 워커 1개인지 확인한다. 기존 웹의 `render.yaml`은
이번 워커 연결에 사용하지 않는다. Blueprint Auto Sync도 꺼 두어 수동 배포와 일치시킨다.

환경 그룹에는 웹과 같은 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `B2_S3_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_PREFIX`,
`B2_KEY_ID`, `B2_APPLICATION_KEY`가 필요하다. 비밀값을 로그·문서·이슈에 복사하지 않는다.
버킷은 `allPrivate`여야 하며 B2 키의 `listBuckets` 권한으로 확인한다.
`REVIEW_DOCS_B2_BUCKET`은 별도 비공개 버킷을 사용할 때만 지정한다.

`OPENAI_API_KEY`가 없으면 자동 번역은 사용할 수 없다. 파일 분석과 DOCX/ZIP 생성은
가능하며, 외국어 가사는 관리자가 번역을 입력·확인한 후 생성할 수 있다.

## 실행 전 검사와 완료 확인

```sh
docker build --platform linux/amd64 -f services/review-docs/Dockerfile -t onside-review-docs-worker .
docker run --rm --init --memory=2g --pids-limit=128 \
  --env-file /path/to/review-worker.env onside-review-docs-worker \
  npm run review-docs:check
```

`--check`는 Python/DOC/HWP/PDF/OCR 의존성·한국어/영어/일본어 언어팩·템플릿,
DB 테이블 읽기, B2 비공개 설정을 검사한다. 작업 claim, heartbeat 기록, 자료 생성·삭제,
번역 API 호출은 하지 않는다. 실패 시 고정된 오류 코드와 설정 안내를 출력하고 종료한다.

실제 워커가 실행된 후 다음을 모두 확인해야 운영 복구 완료로 기록한다.

1. 사전 검사 통과 후 워커 프로세스가 계속 실행되고 heartbeat가 90초 이내로 갱신된다.
2. 관리자 화면의 경고가 새로고침 없이 사라지고 업로드·분석 시작이 활성화된다.
3. 합성 검증 문서의 분석 → 관리자 확인·저장 → 생성 → 개별 DOCX/ZIP 다운로드를 확인한다.
4. 사용한 검증 작업과 만료 자료는 기존 보관 정책으로 정리하며 고객 작업을 삭제하지 않는다.

현재 코드 배포와 워커 서비스 개설은 별도 상태다. 워커의 실시간 heartbeat와 실제 작업
완료를 확인하기 전에는 문서 생성 장애가 해결됐다고 기록하지 않는다.
