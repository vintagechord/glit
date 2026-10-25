# 온라인 뮤직비디오 결과 첨부 메일

온라인 뮤직비디오의 공개된 확정 등급과 현재 필증이 모두 있어야 결과 메일을 발송합니다. 등급만 저장했거나 필증만 업로드한 단계에서는 `pendingAssets: true`와 준비 안내를 반환합니다. 심의불가(`REJECT`)는 발급 파일이 없는 결과이므로 첨부 없는 결과 메일을 보냅니다.

서버 호출은 `sendOnlineMvResultNotificationById({ submissionId, forceResendKey? })`로 통일합니다. 등급 저장과 필증 업로드는 같은 자산 묶음에 같은 키를 사용하므로 중복 발송되지 않습니다. 관리자가 의도적으로 다시 안내하는 작업만 고유한 `forceResendKey`를 전달합니다. 화면의 사전 확인은 `inspectOnlineMvBundleReadiness(submission)`를 사용합니다. 이 사전 확인은 DB 필드만 검사하며 실제 파일의 존재·형식·크기는 발송 준비에서 검사합니다.

첨부는 고객 페이지가 사용하는 등급 이미지, 등급 표시 사용 예시 PDF, 현재 공식 필증의 세 파일입니다. 원본 PDF와 이미지의 실제 바이트를 사용하며 문서를 새로 만들거나 이미지로 대체하지 않습니다. 세 파일의 원본 크기 합계는 18MiB까지 허용합니다. MIME 인코딩 이후의 일반적인 메일 크기 제한을 고려한 한도입니다. 초과하면 저장된 결과는 유지하고 메일 실패 이유를 반환합니다.

등급 이미지와 사용 예시 PDF는 신청별 내용 해시를 포함한 비공개 B2 키로 보관합니다. 필증은 기존 업로드 키를 사용합니다. `email_outbox.attachment_refs`에는 객체 키, SHA-256, 크기, 파일명, MIME, 신청 ID, 확정 등급과 필증 키만 저장하며 base64는 저장하지 않습니다. 실제 전송 및 재시도 때 파일의 바이트와 해시를 다시 확인합니다. 결과나 필증이 바뀌었다면 이전 묶음은 발송하지 않습니다. B2 읽기의 일시적인 실패는 큐가 재시도하며, 파일 손상 또는 이전 결과는 실패로 남습니다. 업체의 접수 여부가 불명확한 SMTP 전송은 기존 정책대로 자동 재발송하지 않습니다.

운영 반영은 다음 순서로 진행합니다.

1. `20261025080721_review_email_attachment_refs.sql`을 적용합니다. 일반 메일용 기존 RPC는 유지하고 첨부 메일용 RPC만 추가합니다. 워커 소유 기간은 파일 검증 시간을 포함해 180초입니다.
2. `supabase/functions/send-transactional-email`을 배포합니다. 기존 인증 비밀키·발신자 설정은 그대로 사용합니다. 신규 relay는 기존 첨부 없는 요청도 처리합니다.
3. 웹 서버를 배포합니다. Mac 앱은 서버의 동일한 결과 알림 경로를 호출하며 SMTP 비밀번호를 보관하지 않습니다.

SMTP, Gmail, Resend, Supabase SMTP relay 모두 같은 세 파일을 전달합니다. relay는 인증 후 `X-Onside-Attachment-Count: 3` 요청의 크기를 최대 26MiB, 처리 시간을 55초로 제한합니다. 일반 요청의 128KiB/14초 제한은 유지합니다. 외부 URL이나 Nodemailer 파일 경로를 첨부로 받지 않습니다.

회귀 검증은 `tests/email-attachments.test.ts`, `tests/admin-submission-notifications.test.ts`, `tests/email-outbox.test.ts`, `tests/supabase-email-relay.test.ts`와 `python3 scripts/email-outbox-sql-test.py`로 수행합니다. 테스트는 가상 수신자와 모의 transport 또는 폐기 가능한 로컬 Postgres를 사용하며 실제 고객 메일을 발송하지 않습니다.
