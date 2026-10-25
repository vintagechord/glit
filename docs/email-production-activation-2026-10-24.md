# 이메일 운영 활성화 진행 기록

## 2026-10-25 안정성 보완 운영 반영 완료

최종 확인: **2026-10-25 11:05:24 KST. 새 웹·중계 함수·DB·스케줄러 배포를 완료했고, 허가된 본인 주소로 보낸 3건의 메일 서버 접수를 확인했다. 이번 3건의 사용자 수신함 확인은 아직 대기 중이다.** 이전 버전의 공통 알림과 비밀번호 복구 메일은 실제 수신까지 확인한 이력이 있으며, 아래에 과거 기록으로 구분한다.

### 현재 배포 상태

- 운영 소스는 **`04de307c7ae6ec04ccb4bc991d607b9689f4c46a`**다. [Render 배포 `dep-dbem5mom7kps73eb9bog`](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dbem5mom7kps73eb9bog)는 **2026-10-25 11:03:29 KST**에 Live가 됐다. 운영 모드는 `transactional`, 공급자는 `supabase-smtp`다.
- 앞선 `abc916c`의 배포 `dep-dbem0som7kps73eatp50`은 Turbopack의 `dynamic` 설정 재내보내기 처리에서 빌드에 실패했다. `04de307`에서 직접 상수 선언으로 수정한 뒤 실제 Render의 Turbopack·TypeScript·페이지 생성이 모두 통과했다. 별도 Node 22 Docker의 네트워크 없는 최종 빌드도 **87개 페이지** 생성까지 통과했다. 로컬 검증 로그는 `/private/tmp/email-hardening-docker-turbopack.log`다.
- 다음 세 마이그레이션을 운영 DB에 적용했다: `20261024174812_atomic_admin_review_notifications.sql`, `20261024174939_email_worker_and_rate_limits.sql`, `20261024175001_durable_email_outbox.sql`.
- 중계 v2도 배포했다. 번들은 **12,998 bytes**, SHA256 **`db8537348228914a6718d0d8a7a8e45cc72d97449d6a8df53b545ff9e6bc8455`**다. 이 함수의 JWT 검증은 OFF이며 별도 서버 비밀값 인증을 유지한다.
- 기존 Daum 앱 비밀번호·발신 계정과 `Render → HTTPS → Supabase → Daum TLS/465` 경로를 유지했다. 새 비밀번호 발급, 도메인 구매, Resend 연동은 필요하지 않았다.

### 반영한 보완

- 보완 요청·수락·재요청과 트랙 추가·삭제 알림, 회원 Auth 이메일 우선, 가입 완료 환영메일을 연결했다.
- MV/최종 결과와 방송국 상태·감사 기록을 원자적으로 저장하고, 일반 진행상황·결과 수동 재발송을 추가했다.
- 앱 메일의 DB 발송 대기열, 동일 이벤트 중복 등록 방지, 안전하게 실패한 건의 재시도, 접수 불확실 건 분리, `/admin/emails` 발송 관리, 요청 제한 DB 저장을 반영했다.
- 비회원 이름 일치 전에 최근 20건으로 잘리던 조회를 페이지 순회로 교체했다. 비밀번호 복구는 서명된 fragment와 명시적 비밀번호 제출을 사용하며, 안전하지 않은 미인증 계정의 일반 복구 링크 발급을 차단한다. **이전 방식의 재설정 링크는 새로 요청해야 한다.**
- 결제 완료·무통장 안내는 실제 주문에 묶인 키를 사용한다. 같은 주문의 재요청은 기존 주문을 중복 생성하지 않고 미등록 안내의 등록을 재시도한다.

### 이번 배포의 검증 결과

| 검증 | 확인한 결과 | 범위 |
|---|---|---|
| 운영 DB 권한 | 새 테이블 3개 RLS와 RPC 10개의 브라우저 역할 접근 차단 확인 | 고객 행·비밀값·메일 본문을 출력하지 않은 읽기 전용 점검 |
| 운영 스케줄러 | cron 매분 실행, 최근 실행 `succeeded`, 최근 HTTP 200·timeout 없음. worker `last_finished_at=2026-10-25 02:04:04.667 UTC`, `last_error=false` | 실제 운영 스케줄러→웹 worker 완료 확인 |
| 운영 발송 대기열 | **11:05:05 KST** 기준 `accepted=3`, 나머지 상태 0, 접수 완료 후 남은 HTML 0 | 메일 서버 접수·본문 삭제 확인이며 수신함 도착 보증은 아님 |
| 허가된 자기 주소 발송 | worker 테스트 **02:04:04.543132 UTC**, 기존 회원 아이디 안내 **02:03:57.449815 UTC**, 같은 회원 비밀번호 복구 **02:04:16.2601 UTC**에 각각 1회 접수 | 새 버전 공통 worker·아이디 안내·복구의 실제 발송. 사용자 수신함 확인은 대기 중 |
| 공개 health | **11:05:24 KST**, HTTP 200·오류 0·모든 이메일 검사 정상, 이메일과 무관한 Kakao 설정 경고 1건 | 읽기 전용 점검. 결과 파일 `/private/tmp/email-hardening-public-verification.json` |
| 공개 인증 화면 | 한국어·영어 인증/비회원 8개 페이지 HTTP 200. 두 언어 재설정 페이지의 `noindex`·`no-referrer` 확인 | 공개 경로·메타데이터 확인 |
| 접근 차단 | 인증 없는 worker 요청 401. 로그인한 일반 회원의 `/admin/emails` 접근은 `/dashboard`로 이동 | 실제 브라우저 일반 회원 권한 차단 확인. 실제 관리자 목록 화면은 열어 보지 않음 |
| 자동·격리 검증 | **960 통과·0 실패·6 기존 조건부 건너뜀**, 별도 인증 모의 브라우저 **7 통과**. PostgreSQL 17 원자성·권한·큐 전이·만료·동시 claim·동시 요청 제한 통과. TypeScript·ESLint·webpack·Deno 검사 통과 | 모의 공급자/인증과 격리 DB 테스트이며 고객의 실제 전체 업무 흐름을 실행한 것은 아님 |

### 남은 확인과 한계

1. 이번 자기 주소 발송 3건의 수신함 도착은 사용자 확인을 기다린다. `accepted`는 메일 서버 접수이며 실제 수신함 도착과 구분한다.
2. 실제 관리자 계정으로 발송 목록·재발송 화면을 보는 확인은 남아 있다. 서버 권한과 재발송 동작은 모의 테스트, 운영 DB 권한은 읽기 전용 점검으로 확인했다.
3. 새 가입 완료, 실제 비회원 접수 코드, 관리자 심의 변경, 결제의 전체 고객 흐름은 이번 운영 검증에서 실행하지 않았다. 허가된 테스트 계정·접수가 준비되면 별도로 확인한다.
4. DB 업무 저장과 큐 등록 사이까지 하나의 트랜잭션은 아니며, SMTP 접수 후 응답 유실까지 포함한 정확히 한 번의 수신을 보장하지 않는다. 접수 불확실 건은 자동 재시도를 멈추고 관리자가 확인하며, 미등록 안내는 진행상황·결과·동일 주문 안내의 명시적 재요청으로 복구한다.

배포와 현재 설정은 완료했다. 추가 수신 확인을 운영 장애나 미배포 상태와 혼동하지 않는다. 재설정 절차는 [이메일 설정 문서](auth-email-configuration.md)를 따른다.

---

## 이전 버전 `6b19cd9` 활성화·실수신 기록

아래는 **2026-10-25 01:40:44 KST**를 기준으로 한 최초 `transactional` 운영 기록이다. 현재 운영 소스·배포·검증 상태는 문서 최상단을 따른다. 과거 실패 기록은 현재 장애를 뜻하지 않는다.

### 당시 운영 상태

- 당시 운영 웹 소스는 **`6b19cd9`**였다. [최종 Render 배포 `dep-dbedu00m7kps73dj5au0`](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dbedu00m7kps73dj5au0)는 Deploy succeeded이며 로그의 Live 시각은 **2026-10-25 01:40:26 KST**다. `NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional`로 재빌드·배포했다.
- 공급자는 `supabase-smtp`다. `Render → HTTPS → Supabase Edge Function → Daum TLS/465` 경로를 사용하며, 새 도메인 구매나 Resend 연동 없이 운영한다.
- 당시 Supabase 중계 함수도 `6b19cd9` 번들로 배포했다. `Verify JWT with legacy secret`은 OFF이고, 함수 자체의 별도 서버 비밀키 인증을 유지한다. 일반 Supabase 공개 키나 회원 토큰으로 메일을 보낼 수 없다.
- Daum의 POP3/SMTP는 **사용함**이며 새로고침 후에도 설정이 유지됨을 확인했다. `SMTP_USER=iamonside`, `SMTP_FROM=온사이드 <iamonside@daum.net>`을 사용한다. 사용자가 앱 비밀번호를 직접 교체한 `SMTP_PASS` 항목의 갱신 시각은 **2026-10-24 16:28:23 UTC**였다. 비밀번호 값은 읽거나 문서·채팅·저장소에 기록하지 않았다.
- Render의 `SMTP_FROM`과 `NEXT_PUBLIC_SUPPORT_EMAIL`도 올바른 `iamonside@daum.net` 값으로 저장·재빌드했다. 최종 공개 비밀번호 찾기·비회원 조회 화면의 고객센터 링크에 올바른 주소가 있고 이전 `myonside` 주소가 없음을 확인했다.
- 당시 배포한 단일 파일은 `/private/tmp/glit-email-relay-editor.ts`, **12,273 bytes**, SHA256 `44abb1c774733bc71b3ffa17680ad7898ad7f3b9f7df52cce1b0fad4c571dace`다. 릴레이 테스트 10개, 소스·번들 Deno 검사, ESLint 및 diff 검사를 통과했고 별도 보안 검토도 완료했다.

### 당시 검증 결과와 범위

| 검증 | 확인한 결과 | 범위 |
|---|---|---|
| 공통 앱 이메일 발송 | `sendSubmissionUpdateEmail`로 본인 주소 `iamonside@daum.net`에 발송: `ok: true`, `skipped: false`. 사용자가 실제 수신함 도착 확인 | 실제 SMTP 연결·인증·발송·수신 확인 |
| 중계 인증·입력 검증 | 인증값 없는 GET 401, 잘못된 인증값의 GET 401, 올바른 전용 인증값의 빈 POST `{}` 400 | 해당 요청은 메일을 발송하지 않음 |
| 당시 공개 health | **01:40:44 KST**, HTTP 200, 오류 0건, 이메일 환경 검사 `ok: true`; 기타 경고 1건 | 환경 검사이며 개별 메일 도착을 보증하지 않음 |
| 공개 페이지 | 한국어·영어의 비밀번호 찾기, 비회원 조회, 회원가입, 아이디 찾기 8개 페이지 HTTP 200 | 실제 운영 경로 접근 확인 |
| 비회원 조회 화면 | 비로그인 브라우저의 `/track?mode=guest`에서 이름·이메일 입력과 코드 이메일 발송 버튼 확인 | 실제 고객 접수를 조회하거나 코드를 재발송하지 않음 |
| 비밀번호 찾기 화면 | 비로그인 브라우저의 `/forgot-password`에서 이메일 입력·발송 버튼과 올바른 고객센터 주소 확인 | 운영 `transactional` 화면 확인 |
| 운영 비밀번호 재설정 요청 | 사용자가 지정한 기존 회원 주소를 Auth Users에서 확인한 뒤 운영 `/forgot-password` 폼으로 1회 요청. 일반 성공 안내·재요청 대기시간 표시와 사용자의 `[onside] 비밀번호 재설정 안내` 메일 도착 확인 | 등록 회원의 실제 복구 메일 발송·수신 확인. 링크 클릭이나 비밀번호 변경은 하지 않음 |
| 비회원 조회 입력 검증 | 빈 객체 요청 1회에 예상한 400 응답 | DB 조회·메일 발송 전 입력 검증만 확인 |

후속 진단에서 사용자는 01:28의 공통 SMTP 테스트 메일만 도착했고 재설정 메일은 오지 않았다고 확인했다. 운영 Supabase Auth Users에서 `iamonside@daum.net`과 `iamonside@kakao.com`을 각각 정확한 주소로 조회한 결과 모두 `No users found`, `Total 0`이었다. 소스 검토에서도 `generateLink`의 `user_not_found`를 일반 성공 안내로 처리하고 메일 발송 함수를 호출하지 않음을 확인했다. Render 실운영 로그에서도 **01:41:30 AM**, 인스턴스 `[2t6fj]`의 `[Auth] generate recovery link` 항목에 `{kind: 'provider', status: 404, code: 'user_not_found'}`가 기록된 것을 확인했다. 따라서 이번 미도착은 회원 부재에 따른 정상 동작으로 진단했으며, 이를 해결하기 위한 코드 변경이나 재배포는 필요하지 않다.

## 소스 반영과 최초 배포 이력

- 검증한 이메일 관련 50개 파일을 별도 작업 트리에서 커밋했다. 기존 `19.png` 삭제와 Supabase CLI 캐시 변경은 제외했다. `main`을 `7848536cebfcb437a2410ef39e4bb2601628f022`에서 `9eba8902f021c151a08cac8d9e151fb96d80bb72`로 강제 푸시 없이 반영했다.
- `9eba890`은 관련 테스트 59개, 변경 파일 ESLint, transactional 모드의 운영 webpack 빌드 및 TypeScript 검사를 통과했다. 앞선 전체 테스트 결과는 923 통과, 6 건너뜀이었다.
- 최초 Supabase 프로젝트 `rwysjsmxtpuqekeltwxi`에는 Edge Functions와 custom secrets가 없었다. 최초 단일 번들의 SHA256은 `4ac190cf3bc46d1558b0a013a9bfef79bccab26bb412193ec41cddd272b616ec`였고 Deno 검사를 통과했다. 최초 임시 파일은 이후 `6b19cd9` 번들로 교체했다. 현재 운영 중계는 문서 최상단의 v2 번들이다.
- 사용자는 앱 비밀번호를 직접 입력하겠다고 답했고, 전용 서버 비밀키 인증으로 중계 함수를 배포하는 것을 승인했다. 함수 배포와 JWT 설정 저장을 완료했다. 비밀값 등록 전 GET 및 POST `{}`는 자체 `503 configuration`을 반환했으며 부팅·패키지 import 오류는 없었다.
- [최초 웹 배포 `dep-dbec2jo473hc73cqu5a0`](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dbec2jo473hc73cqu5a0)의 `9eba890` Live 시각은 **2026-10-24 23:34:34 KST**였다. 23:36:04 KST에 `/find-id`, `/confirm-email`, `/track` HTTP 200과 health 오류 0건을 확인했지만, 당시에는 `manual`을 유지했다.
- 발신 계정 정정과 Docker의 `NEXT_PUBLIC_SUPPORT_EMAIL` 전달은 `9efcfb2`, 발신자와 일치하는 bare SMTP ID 지원과 Message-ID 도메인 처리는 `6b19cd9`에 반영했다.

## 이전 장애와 해결 이력

- 첫 Deploy 요청은 인증 설정 미확인을 이유로 자동 승인 검토에서 거절됐다. 사용자 승인과 설정 확인 후 배포를 완료했다.
- Render CLI에는 로그인 정보가 없었지만 브라우저 대시보드로 접근했다. 사용자와 브라우저를 동시에 조작하면서 시간 초과·화면 변경이 발생해 초기 설정 저장이 지연됐으나 이후 완료했다.
- 첫 메모리 전용 중계키를 만든 도구 세션이 초기화돼 Supabase와 Render의 키 일치를 다시 확인해야 했다. 이후 동일한 키로 저장하고 전용 인증 경로를 검증했다.
- 초기에는 새 `/find-id`·`/confirm-email` 경로가 404였다. 최초 웹 배포 후 두 경로의 HTTP 200을 확인했다.
- 최초 고객센터 본인 주소 발송 두 차례는 중계의 `503 configuration`으로 실패했다. 빈 POST 400과 EAUTH 매핑에 따라 SMTP 인증 거부로 판단했지만, 당시 발신 계정 `myonside@daum.net`이 잘못됐으므로 그 결과를 올바른 계정의 비밀번호 오류로 단정하지 않았다.
- 사용자는 계정을 `iamonside@daum.net`으로 정정했다. 이후 기존 `SMTP_PASS`가 평소 로그인 비밀번호였다고 확인했다. Daum POP3/SMTP를 사용함으로 저장하고, 최신 공식 안내에 따라 Daum 계정의 앱 비밀번호를 사용하도록 수정했다.
- 앱 비밀번호를 저장했다는 첫 답변 후에도 발송이 실패했다. Secrets 목록에서 `온사이드`라는 새 이름만 **16:20:44 UTC**에 추가됐고, 함수가 읽는 `SMTP_PASS`는 **14:33 UTC** 그대로임을 확인했다. 값은 읽지 않았다. 정확한 이름 `SMTP_PASS`로 교체한 **16:28:23 UTC** 이후 공통 경로 발송과 사용자 수신 확인이 성공했다.
- 당시 `6b19cd9` 중계 번들 배포 후 `SMTP_USER=iamonside`를 **16:23:51 UTC**에 저장했다. 이름·발신 주소의 정확한 일치만 허용하는 검증을 유지했다.
- 첫 transactional 웹 배포 [`dep-dbedqjbrjlhs73fcl8v0`](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dbedqjbrjlhs73fcl8v0)는 **2026-10-25 01:35:48 KST**에 Live가 됐지만 공개 고객센터 주소에 `myonside`가 남아 있었다. Render의 공개 설정 필드를 확인하니 `SMTP_FROM`과 `NEXT_PUBLIC_SUPPORT_EMAIL`의 이전 값이 남아 있었다. **이전에 두 값의 정정 저장이 끝났다고 판단한 기록은 이 확인으로 정정한다.**
- 두 필드를 정확한 `iamonside@daum.net` 값으로 입력·확인하고 다시 빌드했다. 최종 배포 `dep-dbedu00m7kps73dj5au0`의 성공과 공개 화면에서 이전 주소가 사라진 것을 확인했다.

이전 실패와 저장 착오는 해결됐으며 자동 이메일은 활성화됐다. 현재 개별 업무 흐름의 확인 범위와 남은 검증은 문서 최상단을 따른다.
