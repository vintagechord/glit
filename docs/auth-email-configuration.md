# 회원 인증·찾기·심의 알림 이메일 설정

2026-10-24 확인: 기존 비밀번호 재설정·비회원 코드·심의 알림은 `8b68c86`에서 manual 모드로 보류됐다. 가입 이메일 확인은 최초 구현에서 존재했고 `a20544a`의 관리자 자동 승인으로 바뀌었다. 이번 변경은 확인 가입과 아이디 안내를 추가하고 모든 앱 메일을 동일한 공급자 설정으로 통합한다. 사용자는 기존 고객센터 **`myonside@daum.net`**을 발신자로 선택했다.

## 도메인 구매 없이 가능한 경로

| 공급자 | 새 도메인 | 현재 Render Free | 필요한 설정 |
|---|---|---|---|
| **`supabase-smtp` (선택)** | **불필요** | **HTTPS로 Supabase에 요청 → Daum TLS/465** | **Daum 앱 비밀번호·서버 간 중계 비밀값·Edge Function 배포** |
| `gmail` (Gmail API) | 불필요 | HTTPS 사용 가능 | 발신 Gmail 계정의 OAuth 허가·자격정보 |
| `smtp` (Daum/Gmail 등) | 불필요 | 465/587 차단으로 불가 | SMTP를 허용하는 호스트·메일 계정 인증정보 |
| `resend` | 운영 발신용 소유·인증 도메인 필요 | HTTPS 사용 가능 | DNS 인증·API 키·발신 주소 |

실제 운영 기록과 `render.yaml`은 Render Free다. [Render 공식 제한](https://render.com/docs/free)은 SMTP 25/465/587 송신 차단을 명시한다. [Vercel Node.js Functions](https://vercel.com/kb/guide/serverless-functions-and-smtp)는 465/587을 지원하지만 호스팅 이전이나 유료 전환은 이 코드 변경에 포함하지 않는다.

[Supabase 기본 메일](https://supabase.com/docs/guides/auth/auth-smtp)은 프로젝트 팀 주소만 허용하고 현재 시간당 2건으로 제한돼 일반 고객 운영용으로 사용할 수 없다. 인증 토큰 생성·검증은 Supabase를 사용하되 실제 발송은 선택한 공급자가 담당한다. 심의 알림·아이디 안내·비회원 코드에는 Auth 기본 메일을 대신 사용할 수 없다.

## 선택한 경로: 기존 Daum 주소 + Supabase 중계

`Render → HTTPS → Supabase Edge Function → TLS 465 → Daum`으로 발송한다. Supabase의 [Edge Function 제한](https://supabase.com/docs/guides/functions/limits)은 25/587 연결을 차단하며, Daum의 465는 차단 목록에 포함하지 않는다. Supabase도 [Nodemailer SMTP 예제](https://github.com/supabase/supabase/blob/master/examples/edge-functions/supabase/functions/send-email-smtp/index.ts)를 제공한다. 따라서 도메인 구입, Resend 가입, Render 유료 전환 없이 구성할 수 있다. 실제 클라우드 연결·메일 수신은 앱 비밀번호 설정 후 별도 확인해야 한다. 메일함 발송량 제한과 [Supabase 함수 사용량 제한](https://supabase.com/docs/guides/functions/pricing)은 적용된다.

### 1. Daum에서 앱 비밀번호 준비

Daum 메일의 외부 메일 프로그램 접속을 허용하고 계정 보안 설정에서 앱 비밀번호를 생성한다. [Daum 공식 안내](https://cs.daum.net/faq/service/43/category/9234/detail/30863)는 일반 로그인 비밀번호 대신 앱 비밀번호를 사용하도록 안내한다. 비밀번호를 채팅에 보내거나 저장소에 기록하지 않는다.

### 2. Supabase의 함수 비밀값 설정

[온사이드 Edge Function Secrets](https://supabase.com/dashboard/project/rwysjsmxtpuqekeltwxi/functions/secrets)에 다음을 저장한다. SMTP 비밀번호는 Supabase에만 저장하며 Render에는 복사하지 않는다.

```dotenv
SMTP_HOST=smtp.daum.net
SMTP_PORT=465
SMTP_USER=myonside@daum.net
SMTP_PASS=<Daum app password>
SMTP_FROM=온사이드 <myonside@daum.net>
EMAIL_RELAY_SECRET=<32 random bytes encoded as 64 hexadecimal characters>
```

`EMAIL_RELAY_SECRET`은 사용자 비밀번호와 다른 서버 전용 무작위 값이다. 같은 값을 아래 Render 설정에도 넣는다. 함수는 이 비밀값을 확인하기 전에는 본문을 읽거나 SMTP에 연결하지 않는다. 일반 회원 토큰이나 Supabase 공개 키만으로는 호출할 수 없다. 클라이언트가 발신자·첨부파일·다중 수신자·SMTP 호스트를 임의로 지정할 수 없도록 제한한다.

### 3. 함수 배포

CLI가 온사이드 프로젝트를 관리할 수 있는 계정으로 로그인된 상태에서 저장소 루트에서 실행한다:

```bash
supabase functions deploy send-transactional-email --project-ref rwysjsmxtpuqekeltwxi --use-api
```

`supabase/config.toml`의 이 함수는 `verify_jwt=false`다. 자체 서버 비밀값 검증을 사용하기 때문이며 인증 없는 공개 발송 API가 아니다. 다른 함수의 인증 설정은 변경하지 않는다. 기존 Supabase Auth SMTP 설정을 바꾸는 작업도 아니다.

### 4. Render 앱 연결

```dotenv
EMAIL_PROVIDER=supabase-smtp
SUPABASE_EMAIL_RELAY_URL=https://rwysjsmxtpuqekeltwxi.supabase.co/functions/v1/send-transactional-email
EMAIL_RELAY_SECRET=<same relay secret as Supabase>
SMTP_FROM=온사이드 <myonside@daum.net>
NEXT_PUBLIC_SUPPORT_EMAIL=myonside@daum.net
NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional
```

앱에 설정된 Supabase 프로젝트와 중계 URL의 호스트가 일치해야 한다. 외부 URL로 비밀값을 전송하거나 리다이렉트를 따라가지 않는다. 연결 확인 전에는 기존 운영 manual 설정을 유지하고, 준비 후 transactional로 바꾸어 재빌드·재배포한다.

2026-10-24 현재 로컬 CLI에는 Supabase 관리용 로그인 토큰이 없고, 연결된 MCP 계정으로 온사이드 프로젝트를 조회하면 권한 없음 응답이 나온다. 온사이드 프로젝트 권한이 있는 계정으로 Supabase를 연결해야 한다. Daum 앱 비밀번호도 아직 설정되지 않았다. 따라서 함수 배포·Secrets 저장·실수신 확인이 완료됐다는 의미는 아니다.

## Gmail API: 현재 호스팅을 유지하는 방법

1. 발신 Gmail 계정을 정하고 Google Cloud 프로젝트에서 Gmail API를 활성화한다. OAuth 동의 화면과 웹 애플리케이션 클라이언트를 구성한다.
2. 발신 계정으로 `https://www.googleapis.com/auth/gmail.send` 권한만 허가하고 offline access로 refresh token을 발급한다. 자체 OAuth 흐름 또는 **자신의 OAuth 클라이언트 자격정보를 사용하는** [Google OAuth Playground](https://developers.google.com/oauthplayground/)를 이용할 수 있다. Playground 사용 시 해당 callback을 OAuth 클라이언트에 등록한다. 기본 Playground 클라이언트의 임시 토큰을 운영에 넣지 않는다.
3. 외부 OAuth 앱의 Testing 상태에서는 이 권한의 refresh token이 7일 후 만료될 수 있다. 운영 게시 상태·계정 유형에 따른 Google 검증 요건을 확인한다. 사이트 고객이 아닌 운영자 발신 계정 한 개의 권한 설정이다.
4. 서버 환경변수에 아래 값을 저장한다. 비밀값은 Git·브라우저 코드·채팅에 넣지 않는다.

```dotenv
EMAIL_PROVIDER=gmail
GMAIL_CLIENT_ID=<OAuth client ID>
GMAIL_CLIENT_SECRET=<OAuth client secret>
GMAIL_REFRESH_TOKEN=<sender refresh token>
GMAIL_FROM=온사이드 <your-sender@gmail.com>
NEXT_PUBLIC_SUPPORT_EMAIL=myonside@daum.net
NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional
```

`GMAIL_FROM`은 허가받은 Gmail 주소 또는 그 계정에 승인된 발신 별칭이어야 한다. Daum 고객센터 주소는 Reply-To로 유지할 수 있지만 임의로 Gmail 발신 주소에 넣지 않는다. 계정별 발송량 제한과 스팸 판정은 그대로 적용된다.

공식 문서: [Gmail 발송](https://developers.google.com/workspace/gmail/api/guides/sending), [권한 범위](https://developers.google.com/workspace/gmail/api/auth/scopes), [OAuth 웹 서버 흐름](https://developers.google.com/identity/protocols/oauth2/web-server), [토큰 만료 조건](https://developers.google.com/identity/protocols/oauth2#expiration).

## SMTP: 기존 메일함 사용

SMTP가 허용되는 호스트에서 다음을 설정한다. [Daum 공식 설정](https://cs.daum.net/faq/service/43/category/9234/detail/18007)은 `smtp.daum.net`, SSL 포트 465다. 메일함의 외부 접속 허용과 앱 비밀번호 등 계정이 요구하는 인증 방식을 확인한다.

```dotenv
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.daum.net
SMTP_PORT=465
SMTP_USER=<sender login>
SMTP_PASS=<SMTP credential>
SMTP_FROM=온사이드 <myonside@daum.net>
NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional
```

465는 TLS, 587은 필수 STARTTLS를 사용하며 인증서 검증을 끄지 않는다. SMTP 발신자는 메일함이 허용한 주소여야 한다. Render Free에서 환경변수만 넣어도 연결 차단이 풀리지는 않는다.

## Resend: 선택 사항

`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `RESEND_FROM`을 설정한다. `RESEND_FROM`은 본인이 소유하고 [Resend에서 DNS 인증한 도메인](https://resend.com/docs/dashboard/domains/introduction)의 주소여야 한다. 공용 Daum/Naver/Gmail 도메인과 `resend.dev` 테스트 발신자는 운영용으로 사용하지 않는다. 기존 아트멜론 발신 도메인을 온사이드용으로 사용하지 않는다.

Resend나 온사이드 전용 도메인 주소를 선택하는 경우에 도메인 설정이 필요하다. 기존 Gmail/SMTP 주소로 보낼 때는 새 도메인 구매가 필요 없다. `EMAIL_PROVIDER`를 생략하면 기존 호환을 위해 `resend`를 사용한다. 실패 후 다른 공급자나 Supabase 기본 메일로 자동 재전송하지 않는다.

## 기능과 운영상 제한

- 가입: transactional 모드에서 이메일 확인 후 비밀번호를 설정한다. 메일 미리보기/GET만으로 토큰을 소비하지 않는다. 앱이 임의 초기 비밀번호로 만든 대기 계정에만 서버 서명된 확인 링크를 발급한다. 이전 방식의 미인증 계정은 이 흐름으로 활성화하지 않고 고객센터 확인이 필요하다. Supabase Confirm email을 유지한다. 2026-10-24 공개 Auth 설정 조회에서 `mailer_autoconfirm=false`를 확인했다.
- 아이디: 이메일 자체가 아이디다. 실제 계정이 있으면 입력한 메일함으로 안내하며 웹에는 계정 존재나 다른 주소를 노출하지 않는다. 주소 자체를 잊은 경우 고객센터 확인이 필요하다.
- 비밀번호: 기존 비밀번호를 보내지 않고 일회용 복구 링크로 새 비밀번호를 설정한다.
- 비회원 코드: 저장된 동일 신원의 이름·이메일 쌍이 일치하는 비회원 접수만 이메일로 보낸다. 회원 접수는 제외하고 웹 응답에는 코드나 접수 내역을 표시하지 않는다.
- 심의: 진행 상태·방송국 심의·최종 결과·접수 정보·보완 알림에서 공통 발송 설정을 재사용한다. MV 등급·필증 변경도 연결한다. 회원은 계정 이메일, 비회원은 접수 연락처를 사용한다. 내부 메모만 수정하거나 같은 값을 저장하면 불필요한 알림을 보내지 않는다.
- 발송 실패가 심의 저장을 되돌리지는 않으며 관리자에게 보류·실패 경고를 표시한다. 일반 알림의 영구 재시도 큐나 수신함 도착 추적은 없다. 기존 보완자료 발송 기록과 Resend idempotency key는 유지한다. SMTP/Gmail에는 동등한 중복 방지 API가 없어 불확실한 발송을 자동 재시도하지 않는다.
- 공급자 미설정은 계정/접수 조회 전에 동일하게 실패한다. 이후 수신자별 실패는 비밀정보 없는 서버 진단으로 남기며, 찾기 화면은 계정 존재를 숨기는 일반 안내를 사용한다.

## 활성화·검증

`NEXT_PUBLIC_EMAIL_DELIVERY_MODE=manual`은 자동 발송을 명시적으로 중단하고 복구 화면에 고객센터를 안내한다. 공급자 설정 후 `transactional`로 바꾸고 **재빌드·재배포**한다. 빌드와 런타임 값이 같아야 한다. `render.yaml`은 Blueprint 동기화로 manual을 덮어쓰지 않고 대시보드 선택을 보존한다.

공개 `/api/health`는 선택 공급자의 필수값과 발신자 구문만 검사한다. OAuth 허가·SMTP 접속·공급자 인증·실제 수신을 보증하지 않는다. 지정한 테스트 수신자에게 다음을 실행해 검증한다:

```bash
npm run email:smoke -- --to <approved-test-recipient>
```

`EMAIL_TEST_TO` 또는 기존 `RESEND_TEST_TO`도 사용할 수 있다. 고객센터 주소로 자동 발송하는 기본값은 없다. 이어서 테스트 계정으로 가입·아이디·비밀번호·코드·관리자 변경 알림 수신과 만료/재사용 토큰 거절을 확인한다.

자동 테스트는 모의 공급자·인증 응답을 사용한다. 실제 메일 발송, 계정 OAuth 허가, 도메인 구매, 호스팅 변경, 운영 환경변수 변경·배포를 완료했다는 뜻이 아니다. 현재 발신 자격정보가 없어 실수신 검증은 별도 설정 후 진행해야 한다.
