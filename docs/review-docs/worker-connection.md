# 추가 요금 없는 심의자료 변환

## 운영 구성

2026-09-10 사용자가 추가 요금 없이 연결하도록 확정했다. 유료 워커는 개설하지
않았고 해당 Blueprint도 제거했다. `render.yaml`에는 기존 `glit` 웹 서비스
한 대의 **Free / Oregon / Docker** 구성만 남긴다. 실제 생성하지 않았던 유료
맞춤법 서비스 선언도 제거하며, 기존 맞춤법 처리 코드는 유지한다.

- 저장소: `vintagechord/glit`, `main`.
- 기존 서비스: `srv-d5bvt5ggjchc73ccaaug`, `https://glit-b1yn.onrender.com`.
- Dockerfile: 저장소 루트 `Dockerfile`. 실제 파일인
  `services/review-docs/Dockerfile.web`에 연결되며 중복 정의하지 않는다.
- 실행: Next 프로세스 한 개. 별도 상주 tsx 워커나 새 서버·디스크·DB를 만들지 않는다.
- 변환기는 작업이 있을 때만 실행한다. 기존 15초 dispatcher와 응답 후 처리가
  동일 DB lease를 사용하여 한 번에 문서 작업 한 건만 실행한다.
- Supabase·B2·결제 등 기존 웹 환경 설정을 그대로 사용한다. 비밀값은 빌드 인자,
  로그, 문서에 넣지 않는다. 빌드에는 공개 Supabase URL·anon 키만 사용한다.

Render에서 현재 청구액과 예상 청구액은 $0, 빌드 월 추가 지출 한도도 $0로 확인했다.
새 유료 플랜으로 바꾸거나 서비스를 추가하는 작업은 하지 않는다.

## 전체 형식 연결과 중단 복구

`0105_review_document_web_converters.sql`은 기존 DOCX 전용 RPC를 유지하면서
확인된 지원 형식 배열을 받는 호출을 추가한다. `REVIEW_DOCS_WEB_CONVERTERS=true`
및 실제 Python·antiword·PDF·OCR·언어팩 점검을 모두 통과해야 DOC·DOCX·HWP·PDF가
활성화된다. API의 지원 형식과 화면의 파일 선택·설명, DB 작업 선택 조건이 같다.

기존 Node 환경이나 변환기 점검 실패 시 DOCX·멜론·지니 URL을 계속 처리한다.
변환기가 설치되어 있어도 0105 RPC가 아직 없으면 기존 0103 RPC로 자동 전환한다.
화면의 지원 형식 확인과 실제 작업 선택 모두 같은 전환을 사용하므로 지원하지
않는 파일을 처리 대기열에 넣지 않는다. DB 권한·연결 오류는 이 전환으로 숨기지 않는다.
잘못된 전용 워커 heartbeat를 만들지 않는다. 성공한 변환기 점검은 5분,
실패는 15초 캐시하며 동시에 들어온 점검은 한 번만 실행한다.

관리자 화면은 연결 확인 중인 상태와 실패 원인을 표시한다. `연결 다시 확인`은
입력한 파일·URL·미저장 편집을 유지하며 DB 준비 상태의 15초 캐시를 건너뛰고
다시 확인한다. 기본 자동 갱신도 유지한다. Blueprint는 웹 처리 비활성화 값을
명시적으로 해제하고 변환기를 활성화하여 이전 전용 워커 설정이 남지 않도록 한다.

작업·원본·생성 파일은 기존 DB와 비공개 B2에 저장한다. 서버가 재시작되면
만료된 lease를 제한된 횟수 안에서 복구한다. 취소·실행 시간 초과 시 변환기를
종료하고 임시 파일을 정리하며, 취소된 이전 결과가 나중에 저장되지 않도록
버전과 lease를 함께 확인한다.

## 무료 서버의 자원 보호

이미지에는 `REVIEW_DOCS_LOW_MEMORY=true`, Next heap 192MB, 캐시 8MB,
`OMP_THREAD_LIMIT=1`, `MALLOC_ARENA_MAX=2`를 설정한다. 원본 파일은 한 번에
한 개씩 읽고 분석한다. 변환기와 하위 OCR 프로세스의 메모리 및 컨테이너의
회수 불가능한 사용량을 감시해 웹 서버의 여유 메모리를 보호한다.
제한을 넘는 문서는 페이지를 나누거나 DOCX로 저장하도록 오류를 안내한다.

한 페이지 스캔에서 곡명이 누락되면 남은 시간 안에서 단일열 OCR을 추가
시도한다. 이미 인식된 곡명과 표준 한국어 항목을 보호하고, 최초 OCR 원문도
비교 근거로 보존한다. 다페이지 문서는 추가 OCR로 뒤 페이지 처리 시간을
소비하지 않는다. OCR·복잡한 표·다단 문서는 관리자의 원문 확인을 요구한다.

무료 서비스는 15분간 요청이 없으면 잠들 수 있으며 첫 접속 시 다시 시작하는
시간이 필요하다. 이 제한을 피하려고 유료 플랜이나 인위적인 keep-alive 요청을
추가하지 않는다. 큰 스캔 문서는 서버의 시간·메모리 상한에 맞춰 나눠야 한다.
[Render 무료 서비스 제한](https://render.com/docs/free)을 따른다.

## 검증과 배포

```sh
docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_SUPABASE_URL \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY -t onside-review-web:free .
```

검증은 Linux amd64, 512MB, 추가 스왑 없음, 실제 무료 플랜과 같은 0.1 CPU
조건으로 진행한다. 웹 화면을 읽는 동안 DOC·HWP·텍스트 PDF·스캔 PDF를
분석하고 생성·오류 복구를 확인한다. 실제 운영 연결과 검증 결과는
[배포 기록](deployment-report.md)에 별도로 기록한다.

기존 서비스의 Settings → Build → Source에서 같은 저장소와 `main`을 선택해
Runtime을 Docker로 바꾼다. Compute는 Free를 유지한다. 새 서비스 생성이나
Blueprint로 다른 서비스를 추가하는 방식은 사용하지 않는다.

되돌릴 때는 같은 서비스의 Runtime을 Node, build를 `npm ci && npm run build`,
start를 `npm run start`로 복구한다. 0105는 기존 RPC와 호환되므로 DB를 되돌릴
필요가 없다. Node 환경에서는 DOCX와 URL 처리를 계속 사용할 수 있다.
