# 이메일 운영 활성화 진행 기록

최신 상태: **2026-10-25 KST. 실제 SMTP 발송 성공·수신 확인은 아직 없으며, 운영 이메일은 `manual` 모드를 유지한다.** 아래 과거 단계의 실패·미설정 기록과 현재 상태를 구분한다.

## 현재 상태

- 저장소 `main`에는 `6b19cd9`까지 반영됐다. 발신 계정 정정은 `9efcfb2`, Daum 접속 아이디만으로 SMTP 로그인할 수 있도록 한 변경은 `6b19cd9`다. **운영 웹은 여전히 `9eba890`이고 `manual` 모드다. 중계 함수는 최신 `6b19cd9` 번들로 배포를 완료했다.** Supabase 편집기에 전체 번들을 입력해 Deploy updates를 실행한 뒤 최근 배포 시각과 수정 표시가 사라진 것을 확인했다.
- Supabase의 `SMTP_USER`는 계정 화면의 접속 아이디인 **`iamonside`로 저장 완료**했다. Secrets 목록의 갱신 시각은 **16:23:51 UTC**였다. `SMTP_FROM=온사이드 <iamonside@daum.net>`와 Render의 발신자·고객센터 주소 정정도 저장된 상태다.
- Daum 계정의 POP3/SMTP는 **사용함**이다. 새로고침 후에도 설정이 유지되고 저장 버튼이 비활성화된 것을 확인했다.
- 사용자는 기존 `SMTP_PASS`에 넣은 값이 **평소 로그인 비밀번호**라고 최종 확인했다. 이후 앱 비밀번호 저장을 완료했다고 답했지만 실제 발송은 다시 실패했다. Secrets 목록에는 `온사이드`라는 새 이름이 **16:20:44 UTC**에 추가됐고, 정작 함수가 읽는 `SMTP_PASS`의 갱신 시각은 기존 **14:33 UTC** 그대로였다. 이름·갱신 시각만 확인했으며 비밀번호 값은 읽지 않았다.
- 현재 사용자 입력 화면에는 Name을 정확히 **`SMTP_PASS`**로 준비했다. 사용자가 새 앱 비밀번호를 Value에 직접 입력하고 **Save → Replace**로 기존 항목을 교체하도록 요청한 상태다. **교체 완료는 아직 확인하지 않았다.** 비밀번호 값은 문서·채팅·저장소에 기록하지 않는다.
- 배포한 `6b19cd9` 파일은 `/private/tmp/glit-email-relay-editor.ts`, **12,273 bytes**, SHA256 `44abb1c774733bc71b3ffa17680ad7898ad7f3b9f7df52cce1b0fad4c571dace`다. 릴레이 테스트 10개, 소스·단일 파일 Deno 검사, ESLint 및 diff 검사를 통과했고 별도 보안 검토도 완료했다.
- 배포 후 `Verify JWT with legacy secret`이 **OFF**이고 Save 버튼이 비활성 상태임을 확인했다. 인증값 없는 GET과 잘못된 인증값의 GET은 각각 **401**, 올바른 전용 인증값의 빈 POST `{}`는 **400**이었다. 별도 서버 비밀키 검증이 유지되고 bare ID 설정의 구성 검증이 통과함을 확인했으며, 이 점검에서는 메일을 발송하지 않았다. 실제 SMTP 인증·발송·수신 확인은 `SMTP_PASS` 교체 후에 남아 있다.

## 완료

- 검증한 이메일 관련 50개 파일을 별도 작업 트리에서 커밋했다. 기존 `19.png` 삭제와 Supabase CLI 캐시 변경은 제외했다.
- `vintagechord/glit`의 `main`을 `7848536cebfcb437a2410ef39e4bb2601628f022`에서 `9eba8902f021c151a08cac8d9e151fb96d80bb72`로 강제 푸시 없이 반영했다.
- 해당 커밋은 관련 테스트 59개, 변경 파일 ESLint, transactional 모드의 운영 webpack 빌드 및 TypeScript 검사를 통과했다. 앞선 전체 테스트 결과는 923 통과, 6 건너뜀이다.
- 브라우저로 온사이드 Supabase 프로젝트 `rwysjsmxtpuqekeltwxi`에 처음 접근했을 당시 Edge Functions와 custom secrets가 없음을 확인했다.
- 최초 중계 함수를 단일 파일로 준비하고 Supabase 새 함수 편집기에 입력했다. 당시 파일의 SHA256은 `4ac190cf3bc46d1558b0a013a9bfef79bccab26bb412193ec41cddd272b616ec`였고, 단일 파일도 Deno 타입 검사를 통과했다. 같은 임시 경로의 현재 파일은 위 최신 번들로 교체했다.

## 승인 후 진행

- 사용자가 Daum 앱 비밀번호를 직접 입력하겠다고 답했고, 중계 함수를 서버 전용 비밀키 인증으로 배포하는 것을 명시적으로 승인했다.
- Supabase Dashboard에서 `send-transactional-email` 배포가 성공했다. 함수 Settings에서 `Verify JWT with legacy secret`을 OFF로 바꾸고 저장 완료를 확인했다.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM` 네 설정을 저장했다. `EMAIL_RELAY_SECRET`도 생성해 저장했다. 비밀값은 문서·대화 출력에 기록하지 않았다.
- 배포 직후 비밀값 등록 전 GET 및 POST `{}` 요청은 함수 자체의 `503 {ok:false,reason:configuration}`을 반환했다. 부팅·패키지 import 오류는 없었다.
- 이 단계에서 Render Dashboard의 운영 커밋은 `7848536`이었고 `9eba890` 배포는 시작 전이었다. 이후 수동 배포 결과는 다음 항목에 기록했다.

## 운영 웹 배포 확인

- 사용자와 브라우저 조작 시간을 조율한 뒤 Render에 `EMAIL_PROVIDER=supabase-smtp`, 함수 URL, 전용 중계키, 발신자와 고객센터 주소를 저장했다. Supabase도 동일한 중계키로 맞췄다.
- 전용키 인증 GET은 405, 빈 POST는 SMTP 비밀번호 등록 전 503, 등록 후 400을 반환했다. 인증이 통과하고 메일 payload 검증이 실행됨을 확인했다. 이 점검에서는 메일을 발송하지 않았다.
- [Render 배포 dep-dbec2jo473hc73cqu5a0](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dbec2jo473hc73cqu5a0): `9eba890` 배포 성공, 로그의 Live 시각 **2026-10-24 23:34:34 KST**.
- 23:36:04 KST 공개 확인: `/find-id`, `/confirm-email`, `/track` 모두 HTTP 200. `/api/health` 정상·오류 0건이며 이메일은 수동 모드로 유지했다.
- 사용자가 `SMTP_PASS`를 직접 저장했다고 알렸고, Secrets 목록에서 해당 이름의 존재만 확인했다. 비밀번호 값은 읽지 않았다.
- 고객센터 본인 주소로 공통 앱 알림 경로의 실제 발송 테스트를 두 번 시도했으나, 모두 중계 함수의 `503 configuration`으로 실패했다. 이후 빈 POST가 400인 점과 함수의 EAUTH 매핑을 고려하면 SMTP 인증이 거부된 것으로 판단한다. 발송 성공·수신함 도착으로 기록하지 않는다.
- 최신 Daum 공식 도움말(35945)에 따라 Daum 회원정보의 앱 비밀번호와 POP3/SMTP 사용함 설정을 사용자에게 확인 요청했다. 일반 비밀번호 또는 예전 카카오계정 앱 비밀번호와 구분해야 한다.

## 이전 단계의 장애 기록

아래는 초기 진행 중의 기록이다. 함수 배포, 비밀값 등록, Render 설정 저장, 두 서비스의 중계키 일치와 웹 경로 배포는 이후 완료했으며, 현재 미완료 작업은 다음 절을 따른다.

- 첫 Deploy 클릭은 인증 설정 미확인을 이유로 자동 승인 검토에서 거절됐으나, 위 사용자 승인 후 배포와 설정 저장은 완료했다.
- 당시 `SMTP_PASS`는 등록 전이어서 사용자 직접 입력을 요청했다. 이후 값은 등록됐으나, 현재 확인된 일반 로그인 비밀번호를 앱 비밀번호로 교체해야 한다.
- Render CLI v2.25.0에는 로그인 정보가 없었지만 브라우저 대시보드 접근은 가능했다. 사용자와 브라우저를 동시에 조작하면서 도구가 반복 시간 초과·사용자 화면 변경을 반환해 당시 Render 설정 저장이 지연됐다.
- 첫 메모리 전용 중계키를 만든 도구 세션이 시간 초과로 초기화되어, 당시 Supabase와 Render의 최종 키 일치를 다시 확인해야 했다. 이후 동일한 키로 저장·인증 검증했다.
- 초기 운영 `/api/health` HTTP 200, 오류 0건은 확인했지만 새 `/find-id` 및 `/confirm-email` 경로는 404였다. `9eba890` 웹 배포 후 두 경로의 HTTP 200을 확인했다.
- 이 초기 단계에는 실제 발송 테스트와 Render 환경변수 변경을 하지 않았다. 이후 설정 저장과 발송 시도는 위 운영 웹 배포 기록에 남겼으며 실제 SMTP 성공은 아직 없다.

## 남은 작업

1. 사용자가 **Daum 마이페이지 → 계정 보안**에서 현재 Daum 계정용 앱 비밀번호를 발급하고 Supabase `SMTP_PASS`에 직접 저장한다. 기존 평소 로그인 비밀번호를 교체하며 값을 읽거나 대화·저장소에 기록하지 않는다.
2. 검증된 `6b19cd9` 중계 번들을 배포하고, 현재 계정의 POP3 설정 화면에 표시된 접속 아이디에 맞춰 `SMTP_USER=iamonside`로 저장한다. 고정 발신자는 `iamonside@daum.net`을 유지한다.
3. 전용 중계키·입력 검증을 다시 확인한 뒤, 승인된 고객센터 본인 주소로 공통 앱 경로의 실제 발송 성공과 수신함 도착을 확인한다. 환경값 존재나 빈 POST의 400만으로 SMTP 성공을 판단하지 않는다.
4. SMTP 발송·수신 검증을 통과하면 Render의 `NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional`을 저장하고 최신 소스로 재빌드·재배포한다. 그 전까지 발송 불가 상태에서 가입·복구가 막히지 않도록 `manual`을 유지한다.
5. 실제 운영 비밀번호 찾기·비회원 코드 찾기 화면과 테스트 수신 흐름을 확인한다.

## 최초 작업 순서 (실행 이력 참고)

1. [Supabase Secrets](https://supabase.com/dashboard/project/rwysjsmxtpuqekeltwxi/functions/secrets)에 Daum 앱 비밀번호와 나머지 서버 설정을 저장한다. 정확한 값과 설명은 `auth-email-configuration.md`의 선택한 경로를 따른다.
2. 준비된 `send-transactional-email` 함수를 배포하고 자체 비밀키 인증과 일치하는 JWT 설정을 확인한다. 비밀값 없는 요청·틀린 키 요청이 거부되는지 검증한다.
3. [Render glit 서비스](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug)에서 웹 배포 커밋과 환경변수를 확인한다. 중계 URL과 공용 서버 비밀값을 연결한다.
4. 발송 연결을 확인한 뒤 `NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional`로 **재빌드·재배포**한다.
5. 승인된 테스트 수신자에게 메일 발송을 검증하고, 운영 비밀번호 복구 및 비회원 코드 찾기 화면·수신 흐름을 확인한다.

도메인 구매나 Resend는 이 Daum + Supabase 중계 구성의 필수 조건이 아니다. SMTP 인증과 실제 클라우드 접속·수신 확인은 여전히 필요하다.

## 발신 계정 정정

사용자가 실제 고객센터·SMTP 계정은 **`iamonside@daum.net`**이라고 정정했다. 앞선 두 차례 실패 당시 설정된 `myonside@daum.net`은 잘못된 계정명이었으므로, 그 결과를 실제 계정의 비밀번호 오류로 단정하지 않는다. 당시에는 앱 비밀번호가 맞다고 설명했지만 이후 평소 로그인 비밀번호를 넣었다고 최종 확인했다. 위 실패 기록은 당시 설정으로 실행한 이력으로 남긴다.

앱 고객센터 기본값, 설정 예시와 현재 구성 안내를 올바른 주소로 고쳤다. Docker 빌드에도 `NEXT_PUBLIC_SUPPORT_EMAIL`을 전달하여 브라우저의 고객센터 안내와 서버의 Reply-To가 같은 설정을 사용하도록 했다. 이 소스는 `9efcfb2`에 반영됐지만 운영 웹은 아직 `9eba890`이다. Supabase의 SMTP 로그인·발신자와 Render의 발신자·고객센터 설정 저장은 완료했다. 앱 비밀번호 교체, 새 중계 배포와 실제 발송·수신 검증이 남았으며 자동 이메일은 아직 활성화하지 않았다.
