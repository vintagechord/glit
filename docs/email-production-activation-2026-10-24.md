# 이메일 운영 활성화 진행 기록

2026-10-24 KST. **소스 반영과 운영 이메일 활성화는 별개이며, 실제 발송 활성화는 미완료다.**

## 완료

- 검증한 이메일 관련 50개 파일을 별도 작업 트리에서 커밋했다. 기존 `19.png` 삭제와 Supabase CLI 캐시 변경은 제외했다.
- `vintagechord/glit`의 `main`을 `7848536cebfcb437a2410ef39e4bb2601628f022`에서 `9eba8902f021c151a08cac8d9e151fb96d80bb72`로 강제 푸시 없이 반영했다.
- 해당 커밋은 관련 테스트 59개, 변경 파일 ESLint, transactional 모드의 운영 webpack 빌드 및 TypeScript 검사를 통과했다. 앞선 전체 테스트 결과는 923 통과, 6 건너뜀이다.
- 브라우저로 온사이드 Supabase 프로젝트 `rwysjsmxtpuqekeltwxi`에 접근했다. Edge Functions와 custom secrets가 아직 없음을 확인했다.
- 검증된 중계 함수를 단일 파일로 준비하고 Supabase 새 함수 편집기에 입력했다. 파일: `/private/tmp/glit-email-relay-editor.ts`, SHA256 `4ac190cf3bc46d1558b0a013a9bfef79bccab26bb412193ec41cddd272b616ec`. 단일 파일도 Deno 타입 검사를 통과했다.

## 승인 후 진행

- 사용자가 Daum 앱 비밀번호를 직접 입력하겠다고 답했고, 중계 함수를 서버 전용 비밀키 인증으로 배포하는 것을 명시적으로 승인했다.
- Supabase Dashboard에서 `send-transactional-email` 배포가 성공했다. 함수 Settings에서 `Verify JWT with legacy secret`을 OFF로 바꾸고 저장 완료를 확인했다.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM` 네 설정을 저장했다. `EMAIL_RELAY_SECRET`도 생성해 저장했다. 비밀값은 문서·대화 출력에 기록하지 않았다.
- 배포 직후 비밀값 등록 전 GET 및 POST `{}` 요청은 함수 자체의 `503 {ok:false,reason:configuration}`을 반환했다. 부팅·패키지 import 오류는 없었다.
- Render Dashboard에 접근해 운영 중인 커밋이 여전히 `7848536`이고 `9eba890` 배포가 시작되지 않은 것을 확인했다. 수동 배포가 필요하다.

## 운영 웹 배포 확인

- 사용자와 브라우저 조작 시간을 조율한 뒤 Render에 `EMAIL_PROVIDER=supabase-smtp`, 함수 URL, 전용 중계키, 발신자와 고객센터 주소를 저장했다. Supabase도 동일한 중계키로 맞췄다.
- 전용키 인증 GET은 405, 빈 POST는 SMTP 비밀번호 등록 전 503, 등록 후 400을 반환했다. 인증이 통과하고 메일 payload 검증이 실행됨을 확인했다. 이 점검에서는 메일을 발송하지 않았다.
- [Render 배포 dep-dbec2jo473hc73cqu5a0](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dbec2jo473hc73cqu5a0): `9eba890` 배포 성공, 로그의 Live 시각 **2026-10-24 23:34:34 KST**.
- 23:36:04 KST 공개 확인: `/find-id`, `/confirm-email`, `/track` 모두 HTTP 200. `/api/health` 정상·오류 0건이며 이메일은 수동 모드로 유지했다.
- 사용자가 `SMTP_PASS`를 직접 저장했다고 알렸고, Secrets 목록에서 해당 이름의 존재만 확인했다. 비밀번호 값은 읽지 않았다.
- 고객센터 본인 주소로 공통 앱 알림 경로의 실제 발송 테스트를 두 번 시도했으나, 모두 중계 함수의 `503 configuration`으로 실패했다. 이후 빈 POST가 400인 점과 함수의 EAUTH 매핑을 고려하면 SMTP 인증이 거부된 것으로 판단한다. 발송 성공·수신함 도착으로 기록하지 않는다.
- 최신 Daum 공식 도움말(35945)에 따라 Daum 회원정보의 앱 비밀번호와 POP3/SMTP 사용함 설정을 사용자에게 확인 요청했다. 일반 비밀번호 또는 예전 카카오계정 앱 비밀번호와 구분해야 한다.

## 이전 단계의 장애 기록

- 첫 Deploy 클릭은 인증 설정 미확인을 이유로 자동 승인 검토에서 거절됐으나, 위 사용자 승인 후 배포와 설정 저장은 완료했다.
- `SMTP_PASS`는 아직 등록되지 않았다. Daum 앱 비밀번호를 사용자에게 직접 입력하도록 요청했다. 비밀번호를 채팅이나 저장소에 기록하지 않는다.
- Render CLI v2.25.0에는 로그인 정보가 없지만 브라우저 대시보드 접근은 가능하다. 사용자와 브라우저를 동시에 조작하면서 도구가 반복 시간 초과·사용자 화면 변경을 반환해, Render 설정은 아직 저장하지 못했다. 잠시 Chrome 조작을 멈출 수 있는지 사용자에게 요청했다.
- Supabase와 Render가 동일한 중계 비밀키를 사용하도록 연결·검증하는 단계가 남았다. 첫 메모리 전용 키를 만든 도구 세션이 시간 초과로 초기화되어, 두 서비스의 최종 키 일치를 다시 확인해야 한다.
- 운영 `/api/health` HTTP 200, 오류 0건은 확인했다. 새 `/find-id` 및 `/confirm-email` 경로는 아직 404였으므로 새 웹 배포가 완료됐다고 판단하지 않는다.
- 실제 메일 발송·수신 검증은 하지 않았다. Render 환경변수는 아직 변경하지 않았다.

## 남은 작업

1. 사용자가 `myonside@daum.net`의 Daum 앱 비밀번호와 POP3/SMTP 허용을 확인·수정한다. 인증정보는 사용자 직접 입력으로 처리한다.
2. 동일한 앱 경로에서 고객센터 본인 주소로 발송 성공을 확인한다.
3. Render의 `NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional`을 저장하고 재빌드·재배포한다. 현재는 발송 불가 상태에서 가입·복구가 막히지 않도록 기존 수동 모드를 유지한다.
4. 실제 운영 비밀번호 찾기·비회원 코드 찾기 화면과 테스트 수신 흐름을 확인한다.

## 최초 작업 순서 (실행 이력 참고)

1. [Supabase Secrets](https://supabase.com/dashboard/project/rwysjsmxtpuqekeltwxi/functions/secrets)에 Daum 앱 비밀번호와 나머지 서버 설정을 저장한다. 정확한 값과 설명은 `auth-email-configuration.md`의 선택한 경로를 따른다.
2. 준비된 `send-transactional-email` 함수를 배포하고 자체 비밀키 인증과 일치하는 JWT 설정을 확인한다. 비밀값 없는 요청·틀린 키 요청이 거부되는지 검증한다.
3. [Render glit 서비스](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug)에서 웹 배포 커밋과 환경변수를 확인한다. 중계 URL과 공용 서버 비밀값을 연결한다.
4. 발송 연결을 확인한 뒤 `NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional`로 **재빌드·재배포**한다.
5. 승인된 테스트 수신자에게 메일 발송을 검증하고, 운영 비밀번호 복구 및 비회원 코드 찾기 화면·수신 흐름을 확인한다.

도메인 구매나 Resend는 이 Daum + Supabase 중계 구성의 필수 조건이 아니다. SMTP 인증과 실제 클라우드 접속·수신 확인은 여전히 필요하다.
