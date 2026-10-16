# 온사이드 운영 반영 기록

## 2026-10-17 온라인 뮤직비디오 MBC 옵션 종료

`de2ff5b1c3bd05b97ab8e3fffbb1bd0acb171401`를 기존 Render 서비스에 배포했다.
[Render 기록](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-db952cmq1p3s73cs8j3g)에서
2026-10-17 01:33:14 KST `Deploy succeeded | Live` 확인, 소요 2분 32초.

- 온라인 MV 신청 화면·서버 허용 목록에서 MBC를 제거했다. TV 방송용 MV·음반 MBC는 유지한다.
- 기존 임시저장 복원에서 종료 옵션과 요금을 제외하며 다른 입력·선택을 보존한다.
  과거 온라인 MBC 미결제 건은 카드·무통장·PayPal 시작 전에 옵션 수정을 안내한다.
- 전체 회귀 758개 통과·6개 환경 의존 제외·실패 0개, 신규/복원 브라우저 3개 통과.
  production build·TypeScript·diff·ESLint 오류 0개. 기존 경고는 점검 기록에 남겼다.
- 운영 390/1440px 화면에서 온라인 MBC 제외·Mnet/ETN 유지·TV MBC와 30,000원·가로 넘침
  없음을 확인했다. 자동 임시저장 등 변경 요청은 모두 모의 처리하여 실제 접수를 생성하지 않았다.
- `/api/health` HTTP 200·`ok:true`·오류 0건·기존 알림 설정 경고 2건, MV 접수 화면 HTTP 200.
- 기존 접수·결제 이력, DB 스키마·환경변수·무료 서비스 구성과 타 프로젝트 변경 없음.
  기존 로컬 이미지 삭제는 커밋에서 제외했다.

## 2026-10-17 라디오 팝업 시각 정돈

`38eedf4b3606637a34163a557f312f668fcf9e60`를 기존 Render 서비스에 배포했다.
[Render 기록](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-db94qpbbc2fs73bn4sag)에서
2026-10-17 01:16:54 KST `Deploy succeeded | Live` 확인, 소요 2분 25초.

- 밝은 뉴트럴 바탕·얇은 테두리·부드러운 그림자로 정돈하고 주요 버튼에 파란색을 사용한다.
  프로그램 카드는 사용 가능한 너비에 따라 나란히 또는 세로로 배치한다.
- 부가 안내는 펼쳐 보기로 정리하고, 기존 적격 건의 개별 곡 정보 부족 안내는 보조 위치로 옮겼다.
  프로그램 소개·공식 참여 링크·국영문 초안 보존·복사·자료 다운로드 동작을 유지했다.
- 관련 브라우저 34개, ESLint·diff·production build·TypeScript 검사 통과.
  320~1440px·다크 모드 및 실제 로그인된 운영 Arirang 팝업의 화면·링크를 확인했다.
- `/api/health` HTTP 200·`ok:true`·오류 0건·기존 알림 설정 경고 2건.
  공개 홈·로그인 정상. 실제 외부 게시·고객 기록 수정은 수행하지 않았다.
- DB·환경변수·무료 서비스 구성, 아트멜론·워터멜론 변경 없음.
  기존 로컬 이미지 삭제는 커밋에서 제외했다.

## 2026-10-17 방송국별 라디오 신청 가이드 개선

최종 커밋 `8a4d48063bc4f887d3ad2e11c041c96e656f2f8f`를 기존 Render 서비스에 배포했다.
[Render 기록](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-db947cg473hc73auql50)에서
2026-10-17 00:35:23 KST `Deploy succeeded | Live`와 정상 기동 로그 확인, 소요 시간 2분 16초.

- 선택한 심의 방송국을 유지하는 접근성 팝업, 선명한 헤더와 모바일·다크 모드 배열을 반영했다.
- Arirang 두 프로그램의 공식 메시지 게시판·선곡표, KBS/MBC/SBS/CBS의 참여 안내를 추가했다.
  적격 곡의 국영문 초안 편집·복사를 제공하며 팝업을 닫아도 현재 페이지의 작성 내용은 유지한다.
- 첫 개선 배포(`97eed1a`)를 실제 운영 자료로 확인하다 개별 트랙 없는 기존 적격 건을 발견했다.
  최종 버전에서는 해당 건에도 프로그램·게시판·작성 요령을 제공하고 곡 정보를 추정하지 않는다.
- 전체 회귀 750개 통과·6개 환경 의존 제외·실패 0개, 관련 브라우저 시나리오 32개 통과.
  최종 보완 관련 7개 브라우저 검사 및 ESLint·TypeScript·production build 통과.
- 인증된 운영 Arirang 결과 화면에서 새 팝업을 열고 두 프로그램 카드·각 공식 게시판과 선곡표
  링크가 표시되는 것을 확인했다. 외부 게시판에 글을 보내거나 심의 자료를 수정하지 않았다.
- 최종 `/api/health`: HTTP 200, `ok:true`, `errorCount:0`, 기존 알림 설정 경고 2건.
  비로그인 상세 접근 제한과 공개 화면·정적 자산 응답도 정상이다.
- DB·환경변수·무료 서비스 구성 및 아트멜론·워터멜론 변경 없음. 기존 이미지 삭제는 커밋에서 제외했다.

## 2026-10-17 빈티지하우스 녹음실 사용권 운영 종료

`fea8055b9085903903c9c6c1103ea4913e2cef79`를 기존 Render 서비스에 배포했다.
[Render 기록](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-db93pnavcj2c73bpl850)에서
2026-10-17 00:05:53 KST 서비스 기동 완료 및 `Deploy succeeded | Live` 확인, 소요 시간 1분 55초.

- 온사이드 DB의 메인·셀프 녹음실 사용권 두 행만 `is_active=false`로 변경했다.
  신규 교환 차단과 앱의 목록·신청·관리자 재노출 방어를 반영했다.
- 크레딧·매거진·관리자 서비스 목록에서 해당 상품을 제외하고 녹음실 홍보·위치 링크를 제거했다.
  기존 이력·잔액과 매거진·다른 연계 서비스 처리는 유지한다.
- 관련 테스트 27개, ESLint·TypeScript·production build 통과. 기존 변환기 추적 경고 3건 유지.
- 운영 `/magazine?tab=services` HTTP 200: 새 일반 서비스 문구 확인, 두 사용권 제목·녹음실 홍보·위치 링크 없음.
  `/api/health` HTTP 200, `ok:true`, 오류 0건·기존 알림 설정 경고 2건.
  마이페이지·관리자 크레딧의 비로그인 접근은 로그인으로 307 이동한다.
- 다른 프로젝트·DB 스키마·서비스 구성·환경변수 변경 없음. 기존 로컬 이미지 삭제는 커밋에서 제외했다.

## 2026-10-16 모바일 UI/UX 정돈 운영 배포

`3c7d4a994f4ccdc0d916869286501f7e1a393e53`
(`Polish responsive review, checkout and results layouts`)를 기존 서비스에 배포했다.
[Render 기록](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-db931mbrjlhs73e1pueg)에서
2026-10-16 23:15:06 KST `Deploy succeeded | Live` 확인, 소요 시간 2분 24초.

- 모바일 접수 단계·트랙 입력·긴 파일명, 장바구니와 내역, 결과 모달·관리자 입력·라디오 도구의
  배열을 개선하고 주요 조작 영역을 44px로 확보했다. 메뉴·제목·약관 모달·채팅 위치도 정리했다.
- 전체 회귀 748개 통과·6개 환경 의존 제외·실패 0개, 관련 브라우저 시나리오 39개 통과.
  320~1440px 화면 점검과 로컬 운영 빌드의 320/768px 접수·조회·영문·모달·채팅 검사 통과.
- production build·TypeScript 통과, ESLint 오류 0개. 기존 이동 관련 경고 9개와 변환기 파일
  추적 경고 3개는 유지된다. 처음 sandbox 포트 차단으로 실패한 빌드는 해당 캐시를 분리하고
  정상 권한으로 다시 실행하여 통과했다.
- 배포 후 `/api/health` HTTP 200, `ok:true`, `errorCount:0`. 기존 알림 설정 경고 2건 유지.
- 운영 공개 화면 7곳 HTTP 200, JavaScript 24개·CSS 1개 정상 응답. 축약 메뉴와 모바일
  트랙 카드·진행 단계의 새 코드 및 반응형 CSS 반영을 확인했다.
- DB·환경변수·무료 서비스 구성 변경 없음. 아트멜론·워터멜론 변경 없음.
  기존 로컬 이미지 삭제는 커밋에서 제외했다. 실제 결제·접수·업로드 쓰기는 실행하지 않았다.

## 2026-10-16 결제·접수·심의 결과·라디오 지원 운영 배포

사용자 요청으로 `acedc8d98f35858a4bd1bcf3b9f3668841c7b6bb`
(`Fix review payments and uploads, clarify results and add radio request tools`)를
main에 push하고 기존 Render 서비스에 해당 커밋을 수동 배포했다.

- [Render 배포 기록](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-db92pm7f3r2c73ft6f80):
  2026-10-16 22:58:33 KST `Deploy succeeded | Live`, 소요 시간 2분 57초.
- 기존 Docker / Free 서비스와 환경설정을 유지했다. DB 마이그레이션·새 서비스·유료 플랜은 없다.
- 배포 전 전체 회귀 754개 중 748개 통과, 환경 의존 6개 건너뜀, 실패 0개.
  브라우저 시나리오 19개와 production build·TypeScript 검사도 통과했다.
- 배포 후 `/api/health`: HTTP 200, `ok:true`, `errorCount:0`.
  기존 이메일·카카오 알림 설정 경고 2건은 유지된다.
- 홈·양식·음반·MV 접수·장바구니·영문 음반 접수 HTTP 200. 관리자 비로그인 접근은
  로그인으로 이동하며 현황·관리자 파일 API는 401이다. 운영 JavaScript 23개가 정상
  응답하고 업로드 재시도·빈 파일 차단·모바일 카드 안내의 새 코드 반영을 확인했다.
- 아트멜론·워터멜론은 변경하지 않았다. 기존 로컬 `public/media/mv-ratings/19.png`
  삭제도 배포 커밋에서 제외했다.

실제 PG 승인·취소, 운영 파일 업로드, 고객 기록 수정과 알림 발송은 이번 배포 검증에서
실행하지 않았다. 모바일 카드 결제는 가맹점 계약·HashKey 확인 전까지 비활성 상태이며
모바일 무통장 입금/PC 카드 안내를 제공한다. 상세 범위와 제한은
[점검 기록](../onside-review-audit-2026-10-16.md)에 남겼다.

## 2026-09-12 음악 관리·신청 UX 운영 배포

사용자의 운영 배포 요청에 따라 `244dd60d0e1d95f0690b3d6800ea6bf635ca92cd`
(`Improve music metadata recovery and member management workflows`)를 main에 push하고
기존 Render 서비스에 해당 커밋을 수동 배포했다.

- [Render 배포 기록](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dai398pijrss738gb1b0):
  2026-09-12 02:07:08 KST `Deploy succeeded | Live` 확인.
- 기존 Docker / Free 서비스, URL과 환경변수, Auto-Deploy Off 설정을 유지했다.
  새 서비스·유료 플랜·DB 마이그레이션은 추가하지 않았다.
- 배포 전 전체 회귀 715개 중 710개 통과, 환경 의존 5개 건너뜀, 실패 0개.
  관련 브라우저 검사 56개, production build, TypeScript, 변경 파일 ESLint 통과.
- 배포 후 `/api/health`: HTTP 200, `ok:true`, `errorCount:0`.
  기존 이메일·카카오 설정 경고 2건은 유지된다. 홈·로그인·음반·MV 신청은 HTTP 200.
  비로그인 내 음악·관리자 페이지는 로그인으로 이동하며 음악·주문·심의자료 API는 401.
- 운영 관리자 로그인 화면에서 DOC·DOCX·HWP·PDF 및 URL 분석 지원 안내와
  활성화된 `업로드·분석 시작` 버튼을 확인했다. 음악 관리의 분류 메뉴와
  `앨범 정보 다시 가져오기` 버튼, 관리자 회원 검색·필터·페이지 분할도 확인했다.
- 운영 JS에서 새 초록색 첨부 버튼 스타일, 이메일 대체 업로드 안내,
  선택 상태 접근성 속성이 반영된 것을 확인했다.

이번 배포 검증에서는 실제 결제·파일 업로드·문서 생성·회원 기록 저장을 실행하지 않았다.
문서 전체 형식의 실제 생성 검증은 아래 2026-09-10 기록을 따른다.

## 2026-09-12 심의자료 연결 재확인

운영 관리자 브라우저에서 `/admin/review-docs`를 읽기 전용으로 확인했다.
DOC·DOCX·HWP·PDF 지원 안내와 활성화된 `업로드·분석 시작` 버튼이 표시되며,
보고된 작업자 미연결 배너는 재현되지 않았다. 기존 작업을 생성·수정하지 않았다.
운영 DB의 기존·전체 형식 RPC는 `p_check_only=true` 호출을 모두 통과했고
전용 워커 heartbeat는 기존 무료 웹 구성에 맞게 비어 있었다. 공개 health는
HTTP 200 / errorCount 0이다.

추가 로컬 보완: 0105만 누락된 환경의 DOCX·URL 처리 자동 전환, 연결 재확인
버튼과 초기 확인 상태 안내, Blueprint의 웹 처리 활성화 명시. 이 읽기 전용 사전
점검 이후 위 기록과 같이 운영 배포를 완료했다.

## 2026-09-10 추가 요금 없는 전체 형식 연결

사용자가 추가 요금 금지를 확정했다. 유료 워커는 개설하지 않았고, 새 유료
서비스를 선언하던 Blueprint를 제거했다. 기존 `glit` Free 웹 안에서 변환기를
필요할 때만 실행하도록 구성했다. 운영 DB에 0105를 적용했고 기존 DOCX 전용
호출과 새 전체 형식 호출의 격리 SQL 검증을 통과했다.

Render 확인: 활성 서비스 1대, Free/Oregon, 월 현재·예상 청구액 $0,
추가 빌드 지출 한도 $0. 이번 연결에는 서버·DB·디스크·계정·유료 API를 추가하지 않는다.
운영 Docker 전환과 실제 웹·문서 작업의 최종 결과는 아래에 별도로 기록한다.
실행 구성과 복구 방법은 [무료 변환 연결 문서](worker-connection.md)를 따른다.

### 배포 전 검증

- 최종 Docker production build, TypeScript, 변경 파일 ESLint, diff 검사 통과.
- 관련 회귀 95개 중 90개 통과, 호스트 변환 환경 의존 5개는 건너뜀.
  실제 Linux 이미지의 자원·취소 검사 8개와 OCR 검사 3개는 모두 통과했다.
- 격리 PostgreSQL에서 기존·신규 RPC 권한, DOCX 호환, 전체 형식 claim 검증 통과.
  운영에는 0105만 적용했고 두 호출 모두 읽기 전용 점검을 통과했다.
- Linux amd64 / 512MB / 추가 swap 없음 / 0.1 CPU에서 실제 Next 단일 프로세스를
  실행했다. 홈·로그인·앨범·MV 신청 화면을 읽은 뒤 기존 dispatcher로 DOC·HWP·
  텍스트 PDF·스캔 PDF 4건 모두 원본 기대값과 일치했다. DB/B2는 로컬 모의 전송을
  사용했고 외부 네트워크는 차단했다. 동시 claim 최대 1건, lease 갱신 6회,
  컨테이너 working set 최고 344.2MiB, OOM 0건. 스캔 PDF는 약 135초가 걸렸다.
- 별도 0.1 CPU / 512MB 생성 검사에서 최대 100곡·135문서 생성도 통과했다.
  이 검사는 웹과 동시 실행한 검사가 아니며 실제 운영 결과와 구분한다.

### 운영 반영

- 코드 `333e162`를 main에 push하고 기존 서비스의 Runtime만 Docker로 변경했다.
  Render 화면에서 같은 서비스 ID·URL 및 Docker / Free 상태를 확인했다.
- 중복 Node 빌드를 피하려고 Auto-Deploy를 잠시 Off로 설정한 후 최신 커밋을
  수동 배포했다. 브라우저 화면 접근 복구 후 On Commit 원복 확인이 남아 있다.
- 운영 인증 API에서 `workerReady=true`, `workerMode=web`,
  `supportedFormats=doc/docx/hwp/pdf`를 확인했다. 2026-09-10 13:58 KST 운영 QA:
  DOC 2곡·HWP 2곡·텍스트 PDF 1곡·스캔 PDF OCR 1곡이 모두 기대값과 일치했다.
  외국어 번역 구간은 모두 0건이며 유료 번역 제공자를 추가하지 않았다.
- 검증한 DOC 자료로 9개 DOCX와 ZIP을 생성했다. ZIP CRC·각 DOCX 구조 검사 및
  개별 다운로드와 ZIP 내부 파일의 동일성까지 통과했다.
- 자기 QA 작업만 취소·삭제하고 B2 모든 버전 0건, jobs/events/artifacts 0건,
  QA 계정 404와 profile 0건을 확인했다. 정리 실패 없음, 복구 journal도 제거됐다.
- 공개 홈·로그인·앨범 신청·MV 신청은 HTTP 200. `/api/health`는 HTTP 200,
  errorCount 0이다. 별도 이메일·카카오 알림 설정 경고 2건은 이 변환 배포의
  정상 여부와 구분하며 이번 연결에서 알림 제공자나 유료 키를 추가하지 않았다.

## 이전 배포 기록

2026-09-07 사용자가 운영 배포를 승인했다. 이후 신규 비용 없이 웹·DB만 배포하도록
확정했으므로 유료 워커는 개설하지 않았다.

## 반영 내용

- 운영 코드: `3f56e88` (`Fix authentication and add independent review document jobs`).
- 웹: Render `glit`, `https://glit-b1yn.onrender.com`, 기존 main 자동 배포.
- Supabase resume 후 Auth health 및 상품 catalog API: HTTP 200.
- 운영 DB dry-run에서 0094만 미적용임을 확인한 뒤 적용 완료.
- 추가 테이블 4개 정상 조회. 기존 고객 테이블/계정/결제 데이터 변경 없음.
- B2: 기존 비공개 버킷과 키를 유지하고 B2_PREFIX 아래 전용 작업 경로 사용.
- 비용 변경 없음. 새 유료 서비스/워크플로/번역 제공자 개설 없음.
- 기존 Supabase/B2 변수 9개를 복사한 `onside-review-docs` 환경 그룹만 준비했다.
  어떤 워커에도 연결하지 않았고 기존 웹 환경변수도 변경하지 않았다.

## 운영 검증

2026-09-07 12:59 KST 배포 후 공개 요청으로 다음을 확인했다.

- `/api/health`: HTTP 200, ok:true, errorCount:0. 메일 설정 검사 통과.
- 홈·로그인·가입·비밀번호 찾기·재설정·앨범 신청·MV 신청 화면: HTTP 200.
- `/dashboard/new/album`: 3/7/10/13/15개 패키지 5개 정상 표시, 상품 오류 안내 없음.
- Supabase 공개 catalog: 활성 상품 5개 및 방송사 매핑 모두 정상.
- 신규 심의자료 API가 배포 전 404에서 배포 후 401/AUTH_REQUIRED로 변경됨.
- 운영 주소 대상으로 API 10개 인증 차단 및 관리자 페이지 로그인 리다이렉트 검증:
  `tests/e2e/review-docs-auth.spec.ts` 2개 테스트 통과.
- 배포 직전 B2 경로 보완 관련 테스트 11개, TypeScript, ESLint 검사 통과.
- 앞선 전체 회귀·Docker·문서 렌더링 검증은 구현 보고서에 기록했다.

고객 계정 생성/비밀번호 변경, 실제 결제, 테스트 메일 발송은 실행하지 않았다.
실제 계정 로그인 성공과 재설정 메일 수신까지 검증한 것으로 해석하지 않는다.

## 현재 제한

심의자료 화면/API/DB는 배포됐지만 별도 워커는 사용자 선택에 따라 실행하지 않는다.
workerReady=false 상태에서는 신규 파일 분석·문서 생성 작업을 시작할 수 없다.
워커 Docker와 실행 설정은 저장소에 준비돼 있다. 운영 웹에는 OPENAI_API_KEY가
설정돼 있지 않아 향후 워커 도입 시 번역 환경도 확인해야 한다.
현재 코드가 존재하는 기존 멜론·지니 원클릭 기능은 유지한다.

실제 계정 로그인·재설정 메일 수신, 실제 번역 API, 최대 스캔 PDF 및
제출 환경의 Word/맑은 고딕 검증은 별도 확인 항목이다.

## 2026-09-08 워커 연결 장애 보완

운영 DB 재확인 결과 heartbeat 0건, 생성 작업 0건이었다. 최초 배포에서 워커를
개설하지 않은 상태가 이어진 것이며 DB 마이그레이션 누락이나 대기 작업 정체가 아니다.

- 관리자 화면이 15초마다 연결을 확인하고 탭 복귀 시 갱신한다. 수정 중 자료는 보존한다.
- DB 조회 오류를 워커 미연결로 오인하지 않으며, 연결이 확인되기 전에는 새 처리를 막는다.
- 워커는 Python/DOC/HWP/PDF/OCR·템플릿·DB·비공개 B2 검사를 통과한 뒤 작업을 받는다.
- `npm run review-docs:check`는 작업 실행이나 heartbeat 기록 없이 준비 상태만 검사한다.
- 별도 워커 Blueprint에서 기존 `onside-review-docs` 환경 그룹을 연결하도록 보완했다.

Node 회귀 테스트 553개 중 552개 통과, converter 환경 검사 1개는 로컬에서 건너뛰었다.
실제 Linux 변환 환경의 입력·생성·저장 테스트는 22개 모두 통과했다. 관리자 화면의
자동 연결 복구·수정 보존·중복 요청 차단·이탈 정리 브라우저 테스트 4개,
격리 PostgreSQL 작업 큐 검사, TypeScript·ESLint·Next production build가 통과했다.

준비된 Linux 런타임에 운영 Supabase/B2 설정을 주입한 읽기 전용 사전 검사도 통과했다.
변환기·템플릿·DB·비공개 저장소는 확인됐고 번역 키는 미설정 경고였다.
이 검사는 Render 환경 그룹의 현재 값을 확인한 결과가 아니며, 실행 후에도 운영
heartbeat와 작업은 0건이었다. 따라서 워커가 가동됐다고 해석하지 않는다.

당시 전용 워커의 운영 연결은 완료되지 않았다. 이후 2026-09-10 사용자가
추가 비용 금지를 확정하여 기존 무료 웹 안에서 실행하는 구성으로 변경했다.
구성·실행 전 검사·복구 완료 기준은 [워커 연결 문서](worker-connection.md)에 정리했다.
