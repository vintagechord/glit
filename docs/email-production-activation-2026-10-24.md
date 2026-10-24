# 이메일 운영 활성화 진행 기록

최종 확인: **2026-10-25 01:40:44 KST. Daum SMTP 실제 발송·수신을 확인했고, 운영 웹의 `transactional` 모드 배포를 완료했다.** 아래 과거 실패 기록은 현재 장애를 뜻하지 않는다.

## 현재 운영 상태

- 운영 웹 소스는 **`6b19cd9`**다. [최종 Render 배포 `dep-dbedu00m7kps73dj5au0`](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dbedu00m7kps73dj5au0)는 Deploy succeeded이며 로그의 Live 시각은 **2026-10-25 01:40:26 KST**다. `NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional`로 재빌드·배포했다.
- 공급자는 `supabase-smtp`다. `Render → HTTPS → Supabase Edge Function → Daum TLS/465` 경로를 사용하며, 새 도메인 구매나 Resend 연동 없이 운영한다.
- Supabase 중계 함수도 `6b19cd9` 번들로 배포했다. `Verify JWT with legacy secret`은 OFF이고, 함수 자체의 별도 서버 비밀키 인증을 유지한다. 일반 Supabase 공개 키나 회원 토큰으로 메일을 보낼 수 없다.
- Daum의 POP3/SMTP는 **사용함**이며 새로고침 후에도 설정이 유지됨을 확인했다. `SMTP_USER=iamonside`, `SMTP_FROM=온사이드 <iamonside@daum.net>`을 사용한다. 사용자가 앱 비밀번호를 직접 교체한 `SMTP_PASS` 항목의 갱신 시각은 **2026-10-24 16:28:23 UTC**였다. 비밀번호 값은 읽거나 문서·채팅·저장소에 기록하지 않았다.
- Render의 `SMTP_FROM`과 `NEXT_PUBLIC_SUPPORT_EMAIL`도 올바른 `iamonside@daum.net` 값으로 저장·재빌드했다. 최종 공개 비밀번호 찾기·비회원 조회 화면의 고객센터 링크에 올바른 주소가 있고 이전 `myonside` 주소가 없음을 확인했다.
- 배포한 단일 파일은 `/private/tmp/glit-email-relay-editor.ts`, **12,273 bytes**, SHA256 `44abb1c774733bc71b3ffa17680ad7898ad7f3b9f7df52cce1b0fad4c571dace`다. 릴레이 테스트 10개, 소스·번들 Deno 검사, ESLint 및 diff 검사를 통과했고 별도 보안 검토도 완료했다.

## 검증 결과와 범위

| 검증 | 확인한 결과 | 범위 |
|---|---|---|
| 공통 앱 이메일 발송 | `sendSubmissionUpdateEmail`로 본인 주소 `iamonside@daum.net`에 발송: `ok: true`, `skipped: false`. 사용자가 실제 수신함 도착 확인 | 실제 SMTP 연결·인증·발송·수신 확인 |
| 중계 인증·입력 검증 | 인증값 없는 GET 401, 잘못된 인증값의 GET 401, 올바른 전용 인증값의 빈 POST `{}` 400 | 해당 요청은 메일을 발송하지 않음 |
| 최종 공개 health | **01:40:44 KST**, HTTP 200, 오류 0건, 이메일 환경 검사 `ok: true`; 기타 경고 1건 | 환경 검사이며 개별 메일 도착을 보증하지 않음 |
| 공개 페이지 | 한국어·영어의 비밀번호 찾기, 비회원 조회, 회원가입, 아이디 찾기 8개 페이지 HTTP 200 | 실제 운영 경로 접근 확인 |
| 비회원 조회 화면 | 비로그인 브라우저의 `/track?mode=guest`에서 이름·이메일 입력과 코드 이메일 발송 버튼 확인 | 실제 고객 접수를 조회하거나 코드를 재발송하지 않음 |
| 비밀번호 찾기 화면 | 비로그인 브라우저의 `/forgot-password`에서 이메일 입력·발송 버튼과 올바른 고객센터 주소 확인 | 운영 `transactional` 화면 확인 |
| 운영 비밀번호 재설정 요청 | 사용자가 지정한 기존 회원 주소를 Auth Users에서 확인한 뒤 운영 `/forgot-password` 폼으로 1회 요청. 일반 성공 안내·재요청 대기시간 표시와 사용자의 `[onside] 비밀번호 재설정 안내` 메일 도착 확인 | 등록 회원의 실제 복구 메일 발송·수신 확인. 링크 클릭이나 비밀번호 변경은 하지 않음 |
| 비회원 조회 입력 검증 | 빈 객체 요청 1회에 예상한 400 응답 | DB 조회·메일 발송 전 입력 검증만 확인 |

후속 진단에서 사용자는 01:28의 공통 SMTP 테스트 메일만 도착했고 재설정 메일은 오지 않았다고 확인했다. 운영 Supabase Auth Users에서 `iamonside@daum.net`과 `iamonside@kakao.com`을 각각 정확한 주소로 조회한 결과 모두 `No users found`, `Total 0`이었다. 소스 검토에서도 `generateLink`의 `user_not_found`를 일반 성공 안내로 처리하고 메일 발송 함수를 호출하지 않음을 확인했다. Render 실운영 로그에서도 **01:41:30 AM**, 인스턴스 `[2t6fj]`의 `[Auth] generate recovery link` 항목에 `{kind: 'provider', status: 404, code: 'user_not_found'}`가 기록된 것을 확인했다. 따라서 이번 미도착은 회원 부재에 따른 정상 동작으로 진단했으며, 이를 해결하기 위한 코드 변경이나 재배포는 필요하지 않다.

## 후속 확인 범위

1. 허가된 비회원 테스트 접수가 준비되면 일치하는 이름·이메일로 실제 접수 코드 재발송과 수신을 확인한다. 현재는 해당 테스트 접수가 없어 전체 흐름을 검증하지 않았다.
2. 공통 SMTP 알림과 기존 회원의 비밀번호 재설정 메일 수신은 확인했다. 가입·아이디 안내·관리자 변경 등 나머지 개별 업무 흐름은 모의 테스트와 공통 발송 경로 검증을 구분하며, 실제 업무 데이터로 모든 수신 시나리오를 실행한 것으로 기록하지 않는다.

현재 SMTP 설정이나 웹 배포를 다시 완료해야 하는 상태는 아니다. 후속 설정 방법과 재검증 절차는 [이메일 설정 문서](auth-email-configuration.md)를 따른다.

## 소스 반영과 최초 배포 이력

- 검증한 이메일 관련 50개 파일을 별도 작업 트리에서 커밋했다. 기존 `19.png` 삭제와 Supabase CLI 캐시 변경은 제외했다. `main`을 `7848536cebfcb437a2410ef39e4bb2601628f022`에서 `9eba8902f021c151a08cac8d9e151fb96d80bb72`로 강제 푸시 없이 반영했다.
- `9eba890`은 관련 테스트 59개, 변경 파일 ESLint, transactional 모드의 운영 webpack 빌드 및 TypeScript 검사를 통과했다. 앞선 전체 테스트 결과는 923 통과, 6 건너뜀이었다.
- 최초 Supabase 프로젝트 `rwysjsmxtpuqekeltwxi`에는 Edge Functions와 custom secrets가 없었다. 최초 단일 번들의 SHA256은 `4ac190cf3bc46d1558b0a013a9bfef79bccab26bb412193ec41cddd272b616ec`였고 Deno 검사를 통과했다. 현재 임시 경로의 파일은 위 최신 번들로 교체했다.
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
- 최신 중계 번들 배포 후 `SMTP_USER=iamonside`를 **16:23:51 UTC**에 저장했다. 이름·발신 주소의 정확한 일치만 허용하는 검증을 유지했다.
- 첫 transactional 웹 배포 [`dep-dbedqjbrjlhs73fcl8v0`](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dbedqjbrjlhs73fcl8v0)는 **2026-10-25 01:35:48 KST**에 Live가 됐지만 공개 고객센터 주소에 `myonside`가 남아 있었다. Render의 공개 설정 필드를 확인하니 `SMTP_FROM`과 `NEXT_PUBLIC_SUPPORT_EMAIL`의 이전 값이 남아 있었다. **이전에 두 값의 정정 저장이 끝났다고 판단한 기록은 이 확인으로 정정한다.**
- 두 필드를 정확한 `iamonside@daum.net` 값으로 입력·확인하고 다시 빌드했다. 최종 배포 `dep-dbedu00m7kps73dj5au0`의 성공과 공개 화면에서 이전 주소가 사라진 것을 확인했다.

이전 실패와 저장 착오는 해결됐으며 자동 이메일은 활성화됐다. 개별 업무 흐름에 대한 확인 범위는 위 검증 결과와 후속 확인 범위에 한정한다.
