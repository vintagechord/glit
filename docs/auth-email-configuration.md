# 비밀번호 재설정 메일 운영 설정

재설정 요청은 Supabase에서 복구 토큰을 생성한 뒤 `RESEND_API_KEY`로 Resend 메일을 발송한다. Resend를 사용하면 `RESEND_FROM`을 반드시 지정해야 한다.

`myonside@daum.net`은 고객센터 수신 주소이며 Resend 발신 도메인으로 인증할 수 없다. `NEXT_PUBLIC_SUPPORT_EMAIL`에 유지하면 재설정 메일의 `reply_to`로 사용한다. 발신 주소는 Resend에서 소유·인증한 도메인의 주소로 설정한다. 공용 메일 또는 `resend.dev` 테스트 발신자는 운영 재설정 메일에 사용하지 않는다.

설정 절차:

1. Resend의 Domains에서 사용할 도메인의 발신 인증 상태를 확인한다. 인증이 끝나지 않았다면 해당 화면이 제공하는 실제 DNS 레코드를 도메인 관리 서비스에 등록한다.
2. 인증된 도메인의 발신 주소를 운영 Render 서비스의 `RESEND_FROM`에 지정한다. `RESEND_API_KEY`에는 해당 도메인에 발송 권한이 있는 키를 유지한다. 키를 코드·메신저·로그에 붙이지 않는다.
3. 설정 변경을 배포한 뒤, 승인받은 테스트 수신자에게 재설정 메일 한 건을 보내고 수신 및 링크 동작을 확인한다. 임의의 고객 계정에 테스트 메일을 보내거나 비밀번호를 바꾸지 않는다.

잘못된 로컬 발신자 설정은 토큰 생성 전에 거절한다. Resend의 실패 응답에서는 HTTP 상태와 문서화된 오류명만 기록하고 수신자·복구 토큰·공급자 오류 원문은 기록하지 않는다. `validation_error`는 도메인 미인증이나 테스트 발신자 수신 제한을, `restricted_api_key`·`invalid_permission` 등은 키 권한 문제를 확인할 때 참고한다.

공개 `/api/health`는 메일 설정의 정상 여부만 알린다. 발신자 구문 검사는 Resend의 실제 도메인 인증이나 메일 수신을 보증하지 않는다. 기본 Supabase 메일로 실패 후 자동 재전송하지 않으며, 실패한 요청을 발송 성공으로 표시하지 않는다.

검증: `node --test --import tsx tests/email-config.test.ts tests/password-reset-email.test.ts tests/auth-actions.test.ts tests/auth-recovery.test.ts tests/auth-session-lifecycle.test.ts tests/email-runtime-health.test.ts`.

공식 문서: [Resend 도메인 인증](https://resend.com/docs/dashboard/domains/introduction), [Resend 오류 코드](https://resend.com/docs/api-reference/errors), [Supabase 기본 메일 제한](https://supabase.com/docs/guides/auth/auth-smtp).

## 자동 이메일 보류 모드

현재 온사이드는 도메인 구매·메일 연동을 나중으로 미루기로 하여 `NEXT_PUBLIC_EMAIL_DELIVERY_MODE=manual`로 배포한다. 자동 이메일은 키 존재 여부와 관계없이 보내지 않으며, 비밀번호 재설정 메일·조회 코드 재발급은 고객센터를 안내한다. 기존 정상 복구 링크와 저장한 조회 코드의 사용은 유지한다. 결과는 신청 내역에서 직접 조회하며, 관리자는 별도 고객 안내를 담당한다.

이 플래그는 비밀값이 아니며 Docker 빌드와 런타임에 같은 값을 사용한다. 변경 시 **재빌드·재배포**가 필요하다. 수동 모드 health에는 `email delivery deferred` 경고가 표시되지만 DB·B2·PG 필수 검사는 그대로 적용된다. 설정을 생략하면 transactional이 기본이고, 잘못된 값은 준비 상태 오류다.

향후 온사이드 전용 도메인 인증 및 `RESEND_FROM`·발송 키 설정을 완료하고 실제 수신을 검증한 뒤 플래그를 `transactional`로 바꾸어 재빌드한다. 아트멜론 발신 도메인은 사용하지 않는다.
