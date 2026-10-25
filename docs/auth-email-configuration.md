# 회원 인증·찾기·심의 알림 이메일 설정

2026-10-24 확인: 기존 비밀번호 재설정·비회원 코드·심의 알림은 `8b68c86`에서 manual 모드로 보류됐다. 가입 이메일 확인은 최초 구현에서 존재했고 `a20544a`의 관리자 자동 승인으로 바뀌었다. 이번 변경은 확인 가입과 아이디 안내를 추가하고 모든 앱 메일을 동일한 공급자 설정으로 통합한다. 사용자는 기존 고객센터 **`iamonside@daum.net`**을 발신자로 선택했다.

**2026-10-25 11:05:24 KST 운영 상태:** 안정성 보완 소스 `04de307c7ae6ec04ccb4bc991d607b9689f4c46a`, 중계 v2, DB 마이그레이션 3개와 자동 재시도 스케줄러를 운영에 반영했다. 웹은 `transactional` 모드이며, 실제 worker·아이디 안내·비밀번호 복구 메일 3건이 각각 1회 메일 서버에 접수되고 본문이 삭제됐다. 이후 사용자가 **“3건 모두 도착했습니다”**라고 답해 이번 3건의 실제 수신함 도착도 확인했다. 이전 `6b19cd9` 버전의 공통 알림·기존 회원 복구 메일은 실제 수신을 확인한 이력이다. 배포·검증 범위는 [운영 활성화 기록](email-production-activation-2026-10-24.md)을 참고한다.

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

`Render → HTTPS → Supabase Edge Function → TLS 465 → Daum`으로 발송한다. Supabase의 [Edge Function 제한](https://supabase.com/docs/guides/functions/limits)은 25/587 연결을 차단하며, Daum의 465는 차단 목록에 포함하지 않는다. Supabase도 [Nodemailer SMTP 예제](https://github.com/supabase/supabase/blob/master/examples/edge-functions/supabase/functions/send-email-smtp/index.ts)를 제공한다. 따라서 도메인 구입, Resend 가입, Render 유료 전환 없이 구성할 수 있다. 이 발송 경로는 이전 운영 버전에서 실제 클라우드 연결·메일 수신을 확인했다. 최신 보완 배포의 서버 접수와 수신 확인 범위는 위 운영 상태와 구분한다. 메일함 발송량 제한과 [Supabase 함수 사용량 제한](https://supabase.com/docs/guides/functions/pricing)은 적용된다.

### 1. Daum에서 앱 비밀번호 준비

1. `iamonside@daum.net`의 **Daum 메일 → 설정 → IMAP/POP3 설정 → POP3 설정**에서 **POP3/SMTP 사용함**을 선택하고 **저장하기**를 누른다. [Daum 공식 설정 안내](https://cs.daum.net/faq/service/43/category/9234/detail/34503)
2. **Daum 마이페이지 → 계정 보안**에서 2단계 인증을 확인하고 온사이드용 **앱 비밀번호**를 발급한다. [최신 Daum 공식 안내](https://cs.daum.net/faq/service/43/category/9234/detail/35945)는 2025년 1월 2일부터 2단계 인증·앱 비밀번호가 필요하며, **2025년 12월 1일 서비스 분리 후 앱 비밀번호 발급·관리 주체가 카카오계정에서 Daum 회원정보로 변경됐다**고 명시한다. 이전 카카오계정 경로가 남은 오래된 안내 대신 이 경로를 확인한다.
3. SMTP 로그인 사용자 이름은 **해당 계정의 POP3 설정 화면에 표시된 접속 아이디 `iamonside`**를 사용한다. 일부 [Daum 아웃룩 설정 안내](https://cs.daum.net/faq/service/43/category/9234/detail/38593)는 전체 메일주소를 안내하지만, 현재 계정 화면의 접속 아이디를 우선 확인한다. 중계 함수는 발신 메일주소와 일치하는 전체 주소 또는 그 주소의 아이디 부분만 허용한다. 일반 웹 로그인 비밀번호 대신 위 앱 비밀번호를 Supabase의 `SMTP_PASS`에 직접 저장한다. 비밀번호를 채팅에 보내거나 저장소에 기록하지 않는다.

### 2. Supabase의 함수 비밀값 설정

[온사이드 Edge Function Secrets](https://supabase.com/dashboard/project/rwysjsmxtpuqekeltwxi/functions/secrets)에 다음을 저장한다. SMTP 비밀번호는 Supabase에만 저장하며 Render에는 복사하지 않는다.

```dotenv
SMTP_HOST=smtp.daum.net
SMTP_PORT=465
SMTP_USER=iamonside
SMTP_PASS=<Daum app password>
SMTP_FROM=온사이드 <iamonside@daum.net>
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
SMTP_FROM=온사이드 <iamonside@daum.net>
NEXT_PUBLIC_SUPPORT_EMAIL=iamonside@daum.net
# 실제 SMTP 발송·수신 검증 후 재빌드한 현재 운영값
NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional
```

앱에 설정된 Supabase 프로젝트와 중계 URL의 호스트가 일치해야 한다. 외부 URL로 비밀값을 전송하거나 리다이렉트를 따라가지 않는다. 새로운 환경을 구성할 때는 연결·실수신 확인 전까지 manual을 사용하고, 확인 후 transactional로 바꾸어 재빌드·재배포한다. 현재 운영은 최초 실수신 검증 후 이 전환을 완료했고, 최신 보완 버전도 같은 모드를 유지한다.

최초 연결 이력: `6b19cd9`에서 `SMTP_USER=iamonside`와 사용자가 직접 입력한 Daum 앱 비밀번호로 공통 앱 알림 발송·사용자 수신을 확인하고 `transactional`로 전환했다. **현재 운영 웹**은 [Render 배포 `dep-dbem5mom7kps73eb9bog`](https://dashboard.render.com/web/srv-d5bvt5ggjchc73ccaaug/deploys/dep-dbem5mom7kps73eb9bog)의 `04de307`이며, **2026-10-25 11:03:29 KST**에 Live가 됐다. 중계 함수는 아래 v2로 교체했다. 사용자 승인에 따른 `verify_jwt=false`와 함수 내부 전용 서버 비밀값 인증, 기존 SMTP 자격정보와 발신 주소는 유지한다.

초기 실제 발송은 `503 configuration`으로 실패했으나, 계정명·POP3/SMTP 설정·앱 비밀번호 항목을 바로잡은 뒤 해결됐다. 이후 인증값 없는 요청과 잘못된 인증값은 401, 올바른 전용 인증값의 빈 `POST {}`는 400이었다. **11:05:24 KST**의 최신 공개 health는 HTTP 200·오류 0건·모든 이메일 검사 정상이며, 이메일과 무관한 Kakao 설정 경고 1건이 있었다. 비밀번호 찾기·비회원 조회의 운영 발송 입력 화면과 올바른 고객센터 주소를 확인했다. 각 업무의 실제 수신 검증 범위는 운영 활성화 기록에서 구분한다.

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
NEXT_PUBLIC_SUPPORT_EMAIL=iamonside@daum.net
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
SMTP_FROM=온사이드 <iamonside@daum.net>
NEXT_PUBLIC_EMAIL_DELIVERY_MODE=transactional
```

465는 TLS, 587은 필수 STARTTLS를 사용하며 인증서 검증을 끄지 않는다. SMTP 발신자는 메일함이 허용한 주소여야 한다. Render Free에서 환경변수만 넣어도 연결 차단이 풀리지는 않는다.

## Resend: 선택 사항

`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `RESEND_FROM`을 설정한다. `RESEND_FROM`은 본인이 소유하고 [Resend에서 DNS 인증한 도메인](https://resend.com/docs/dashboard/domains/introduction)의 주소여야 한다. 공용 Daum/Naver/Gmail 도메인과 `resend.dev` 테스트 발신자는 운영용으로 사용하지 않는다. 기존 아트멜론 발신 도메인을 온사이드용으로 사용하지 않는다.

Resend나 온사이드 전용 도메인 주소를 선택하는 경우에 도메인 설정이 필요하다. 기존 Gmail/SMTP 주소로 보낼 때는 새 도메인 구매가 필요 없다. `EMAIL_PROVIDER`를 생략하면 기존 호환을 위해 `resend`를 사용한다. 실패 후 다른 공급자나 Supabase 기본 메일로 자동 재전송하지 않는다.

## 기능과 운영상 제한

- 가입: transactional 모드에서 이메일 확인 후 비밀번호를 설정한다. 메일 미리보기/GET만으로 토큰을 소비하지 않는다. 앱이 임의 초기 비밀번호로 만든 대기 계정에만 서버 서명된 확인 링크를 발급한다. 이전 방식의 미인증 계정은 이 흐름으로 활성화하지 않고 고객센터 확인이 필요하다. Supabase Confirm email을 유지한다. 2026-10-24 공개 Auth 설정 조회에서 `mailer_autoconfirm=false`를 확인했다.
- 아이디: 이메일 자체가 아이디다. 실제 계정이 있으면 입력한 메일함으로 안내하며 웹에는 계정 존재나 다른 주소를 노출하지 않는다. 주소 자체를 잊은 경우 고객센터 확인이 필요하다.
- 비밀번호: 기존 비밀번호를 보내지 않고 일회용 복구 링크로 새 비밀번호를 설정한다. 미가입 주소는 계정 조회에서 발송을 생략하고, 계정 존재를 노출하지 않는 일반 성공 안내를 표시한다.
- 비회원 코드: 저장된 동일 신원의 이름·이메일 쌍이 일치하는 비회원 접수만 이메일로 보낸다. 회원 접수는 제외하고 웹 응답에는 코드나 접수 내역을 표시하지 않는다.
- 심의: 진행 상태·방송국 심의·최종 결과·접수 정보·보완 알림에서 공통 발송 설정을 재사용한다. MV 등급·필증 변경도 연결한다. 회원은 계정 이메일, 비회원은 접수 연락처를 사용한다. 내부 메모만 수정하거나 같은 값을 저장하면 불필요한 알림을 보내지 않는다.
- 발송 실패가 심의 저장을 되돌리지는 않으며 관리자에게 대기·실패·접수 불확실 상태를 구분해 표시한다. 공통 이메일은 `email_outbox`에 먼저 기록하고, 안전하게 실패가 확인된 건만 자동 재시도한다. SMTP/Gmail의 접수 여부가 불확실한 경우에는 자동 재시도를 멈추며 관리자가 중복 가능성을 확인한 뒤 재발송한다. 메일 서버 접수는 수신함 도착 확인을 뜻하지 않는다.
- 공급자 미설정은 계정/접수 조회 전에 동일하게 실패한다. 이후 수신자별 실패는 비밀정보 없는 서버 진단으로 남기며, 찾기 화면은 계정 존재를 숨기는 일반 안내를 사용한다.

## 활성화·검증

`NEXT_PUBLIC_EMAIL_DELIVERY_MODE=manual`은 자동 발송을 명시적으로 중단하고 복구 화면에 고객센터를 안내한다. 공급자 설정 후 `transactional`로 바꾸고 **재빌드·재배포**한다. 빌드와 런타임 값이 같아야 한다. `render.yaml`은 Blueprint 동기화로 manual을 덮어쓰지 않고 대시보드 선택을 보존한다.

## 이메일 안정성 보완 배포 (2026-10-25)

**운영 적용 완료:** 아래 세 SQL, 중계 v2와 웹 배포를 모두 완료했다. 중계 v2는 12,998 bytes, SHA256 `db8537348228914a6718d0d8a7a8e45cc72d97449d6a8df53b545ff9e6bc8455`다. 운영 cron의 매분 실행·최근 성공, worker HTTP 200·timeout 없음, 최근 완료와 `last_error=false`를 확인했다. 테이블 3개 RLS와 RPC 10개의 브라우저 역할 접근 차단도 확인했다. 새 비밀번호·도메인·Resend 설정은 필요하지 않았다. 아래는 새 환경 구성이나 재배포 시의 절차이며, 현재 대기 중인 작업 목록이 아니다. 상세 증거는 [운영 활성화 기록](email-production-activation-2026-10-24.md)에 기록한다.

1. `node scripts/build-email-relay-editor.mjs /private/tmp/glit-email-relay-editor-v2.ts`로 생성·검증한 중계 함수를 먼저 배포한다. 새 함수는 기존 요청과 새 `requestId` 요청을 모두 받는다. 이전 함수에 새 앱을 먼저 연결하면 입력 검증에서 거절될 수 있다. 기존 JWT OFF와 함수 자체 서버 비밀키 인증을 유지하며, SMTP 비밀번호·발신 주소는 변경하지 않는다.
2. `20261024174812_atomic_admin_review_notifications.sql`, `20261024174939_email_worker_and_rate_limits.sql`, `20261024175001_durable_email_outbox.sql`을 적용한다. `anon`/`authenticated`에는 새 테이블과 RPC 접근을 허용하지 않는다. `service_role`만 큐·재시도·요청 제한·원자적 결과 저장을 처리한다.
3. 운영 DB에서 스케줄러를 설정한다. 아래 INSERT는 인증값을 DB 안에서 생성한다. 토큰을 SELECT하거나 로그·저장소에 복사하지 않는다.

```sql
insert into public.email_worker_config(singleton, endpoint_url, enabled)
values (true, 'https://glit-b1yn.onrender.com/api/internal/email-outbox', true)
on conflict(singleton) do update set endpoint_url=excluded.endpoint_url, enabled=true;
notify pgrst, 'reload schema';
```

4. 앱을 배포한다. `pg_cron`의 `onside-email-outbox`가 매분 대기열을 점검하며, 처리할 항목이 있거나 하루 동안 확인된 실행이 없으면 `pg_net`으로 서버 전용 작업을 호출한다. 새 Render 비밀값은 필요 없다. `email_worker_config`에서 `enabled,last_started_at,last_finished_at,last_error`만 조회해 완료를 확인하고, `/api/health` 및 `/admin/emails`에서 큐 상태를 확인한다.
5. 비로그인 상태에서 `/api/internal/email-outbox` POST는 401이어야 한다. 공개 키와 일반 회원으로 큐 테이블·서버 RPC를 읽거나 실행할 수 없어야 한다. 실제 발송은 허가된 테스트 주소로만 확인한다.

발송 대기열은 동일 이벤트 키의 중복 등록, 동시 워커, 서버 재시작을 처리한다. SMTP 접수 후 응답 또는 기록 저장이 유실되면 `uncertain`으로 보존해 자동 중복 발송을 막는다. 인증 메일은 발급 시 지정한 짧은 전송 기한 안에만 재시도하며, 새 인증 요청은 이전 미발송 요청을 대체한다. 일반 메일 본문은 최대 24시간, 성공한 메일 본문은 접수 기록과 함께 즉시 삭제한다. 발송 메타데이터는 30일간 보관한다.

관리자 `/admin/emails`는 수신 주소·제목·접수 상태·시도 횟수·재발송 기능을 제공한다. 인증 토큰과 메일 HTML은 표시하지 않는다. 처리 완료가 27시간 이상 없으면 자동 재시도 상태를 정상으로 표시하지 않는다. 보완 이력은 요청 당시 결과이며, 이후 워커의 최신 결과는 이메일 발송 관리에서 확인한다.

가입 완료 후 환영 메일을 발송한다. 보완 요청·수락·재요청과 트랙 추가·삭제도 자동 안내하며, 회원은 Auth 이메일, 비회원은 비회원 이메일을 우선한다. MV와 최종 결과·방송국 결과·감사 기록은 한 DB 트랜잭션으로 저장한다. 결제 콜백과 무통장 안내 재요청은 주문 단위 중복 방지 키를 사용한다. DB 저장 직후 큐 등록 자체가 실패한 경우에는 관리자에게 오류를 알리고, 현재 진행상황·결과 안내를 다시 보내거나 동일 주문의 입금 안내를 재요청할 수 있다. 이 저장과 큐 등록 사이까지 하나의 트랜잭션이라고 보장하지 않는다.

비밀번호 복구는 서버 서명된 URL fragment를 사용하고, 페이지를 열기만 해서는 인증 토큰을 사용하지 않는다. 새 비밀번호를 제출한 뒤 서버에서 토큰 검증·비밀번호 변경·세션 해제를 처리한다. 인증되지 않은 기존 계정에 일반 복구 링크를 발급하지 않는다. **배포 이전 방식의 재설정 링크는 새로 요청해야 한다.** 회원가입·복구·아이디 찾기·비회원 코드 찾기의 요청 제한은 해시된 식별자를 DB에 저장하므로 서버 재시작과 여러 인스턴스에 걸쳐 유지된다.

공개 `/api/health`는 선택 공급자 설정과 큐 연결·재시도 작업의 최근 실행·지연·발송 예외를 검사한다. OAuth 허가·SMTP 접속·공급자 인증·실제 수신을 보증하지 않는다. 지정한 테스트 수신자에게 다음을 실행해 검증한다:

```bash
npm run email:smoke -- --to <approved-test-recipient>
```

`EMAIL_TEST_TO` 또는 기존 `RESEND_TEST_TO`도 사용할 수 있다. 고객센터 주소로 자동 발송하는 기본값은 없다. 이어서 테스트 계정으로 가입·아이디·비밀번호·코드·관리자 변경 알림 수신과 만료/재사용 토큰 거절을 확인한다.

최신 배포 전 자동 테스트는 960 통과·0 실패·6 기존 조건부 건너뜀, 별도 인증 모의 브라우저 7 통과였다. PostgreSQL 17 격리 DB 검증, TypeScript·ESLint·webpack·Deno 검사와 실제 Render의 Turbopack·TypeScript·페이지 생성을 통과했다. 별도 Node 22 Docker의 네트워크 없는 최종 빌드도 87개 페이지 생성을 완료했다. `abc916c`의 최초 Render 빌드는 `dynamic` 설정 재내보내기 처리에서 실패했고, `04de307`의 직접 상수 선언으로 해결했다. 자동 테스트는 모의 공급자·인증 응답을 사용하므로 실제 수신함 도착을 보증하지 않는다.

최신 운영에서는 허가된 고객센터 본인 주소로 worker 메일 1건, **사용자가 지정한 기존 회원 주소**로 아이디 안내와 비밀번호 복구 각 1건의 실제 서버 접수를 확인했다. 11:05:05 KST DB 점검에서 `accepted=3`, 나머지 상태 0, 접수 완료 후 남은 HTML 0이었다. 이후 사용자가 이번 3건 모두 수신했다고 확인했다. 이 확인이 다른 발송까지 정확히 한 번의 수신을 보장한다는 뜻은 아니다. 공개 한국어·영어 인증/비회원 8개 경로의 HTTP 200, 재설정 두 페이지의 `noindex`·`no-referrer` 메타데이터, 인증 없는 worker 401을 확인했다. 일반 회원 브라우저의 `/admin/emails` 접근은 `/dashboard`로 이동했으나 실제 관리자 목록 화면은 열어 보지 않았다.

이전 `6b19cd9` 버전에서는 공통 앱 알림과 기존 회원의 `[onside] 비밀번호 재설정 안내` 메일 도착을 사용자가 확인했다. 당시 지원 주소의 복구 메일 미도착은 Auth Users에 회원이 없어 `user_not_found` 경로가 발송을 생략한 정상 동작이었다. 이 과거 실수신 이력과 최신 배포에서 추가 확인한 3건의 실수신은 구분해 기록한다. 링크 클릭이나 비밀번호 변경은 운영 검증에서 하지 않았다.

새 가입 완료·실제 비회원 접수 코드·관리자 심의 변경·결제의 전체 고객 흐름은 이번 운영 검증에서 실행하지 않았다. 테스트 계정·접수로 별도 확인할 범위이며, 모의 테스트나 공통 발송 성공을 각 업무의 실제 수신 완료로 기록하지 않는다. 자동 이메일은 `transactional`로 운영 중이다.
