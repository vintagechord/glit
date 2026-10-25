# 심의 현황 이메일과 온라인 뮤직비디오 첨부파일

음반·온라인 MV·방송용 MV 모두 결과 저장과 이메일 발송을 분리합니다. 방송사별 결과·등급·트랙 결과를 저장하거나 필증을 업로드해도 고객 메일을 보내지 않습니다. 관리자가 저장을 마친 뒤 **이메일 미리보기 → 이메일 보내기**를 선택하면 신청 방송사 전체를 한 통에 정리합니다. 아직 결과가 없는 방송사도 접수대기·결과대기로 함께 표시합니다.

미리보기와 실제 발송은 `renderReviewSummaryEmail`의 같은 제목·HTML을 사용합니다. 현재 고객 결과 페이지의 따뜻한 배경색·검정 테두리·노란 버튼을 따르며 **전체 심의 현황 확인** 버튼은 기존 회원 상세 페이지 또는 비회원 전용 링크로 연결됩니다. 별도의 고객 화면을 만들거나 라이브 페이지를 이메일 안에 삽입하지 않습니다. 작품명·아티스트·방송사명 등은 HTML 이스케이프하며 관리자 메모와 수신 이메일 원문은 미리보기에 노출하지 않습니다.

관리자 권한을 확인한 서버만 다음 함수를 호출합니다.

- `getReviewSummaryEmailPreviewById({ submissionId })`: 읽기 전용 미리보기입니다. `subject`, `html`, 마스킹한 `recipientMasked`, `revision`, `updatedAt`, `canSend`, `missingAssets`, `warnings`, `attachmentCount`를 반환합니다.
- `sendReviewSummaryNotificationById({ submissionId, requestId, expectedRevision, expectedUpdatedAt })`: 명시적인 발송 작업입니다. 한 번의 버튼 요청과 네트워크 재시도는 같은 UUID를 사용하고 의도적인 재발송은 새 UUID를 사용합니다. 내용·수신자·조회 링크를 포함한 미리보기 해시와 저장 시각을 검사하며, 첨부파일 준비 후 다시 검사합니다. 변경된 경우 발송하지 않고 새 미리보기를 요구합니다.

응답 유실 뒤 같은 요청을 재시도하면 미리보기 변경 검사 전에 기존 발송 대기열 영수증을 확인합니다. 메일 접수 후 알림 시각이나 수신 주소가 바뀌어도 이전 요청의 접수·대기·접수 불확실 상태를 돌려주며 다시 발송하지 않습니다. `uncertainCount`는 실패와 구분해 관리자에게 접수 여부 확인이 필요함을 표시합니다. 저장 화면은 발송 완료로 표시하지 않습니다.

온라인 MV는 공개된 확정 등급과 현재 필증이 모두 준비되어야 보낼 수 있습니다. 준비되지 않았으면 미리보기의 `canSend`가 false이며 누락 항목을 표시합니다. 심의불가(`REJECT`)는 첨부 없는 결과 메일로 안내합니다. 실제 파일 존재·형식·크기는 명시적 발송을 준비할 때 검사합니다.

첨부는 고객 페이지가 사용하는 등급 이미지, 등급 표시 사용 예시 PDF, 현재 공식 필증의 세 파일입니다. 원본 PDF와 이미지의 실제 바이트를 사용하며 문서를 새로 만들거나 이미지로 대체하지 않습니다. 세 파일의 원본 크기 합계는 18MiB까지 허용합니다. MIME 인코딩 이후의 일반적인 메일 크기 제한을 고려한 한도입니다. 초과하면 저장된 결과는 유지하고 메일 실패 이유를 반환합니다.

등급 이미지와 사용 예시 PDF는 신청별 내용 해시를 포함한 비공개 B2 키로 보관합니다. 필증은 기존 업로드 키를 사용합니다. `email_outbox.attachment_refs`에는 객체 키, SHA-256, 크기, 파일명, MIME, 신청 ID, 확정 등급과 필증 키만 저장하며 base64는 저장하지 않습니다. 실제 전송 및 재시도 때 파일의 바이트와 해시를 다시 확인합니다. 결과나 필증이 바뀌었다면 이전 묶음은 발송하지 않습니다. B2 읽기의 일시적인 실패는 큐가 재시도하며, 파일 손상 또는 이전 결과는 실패로 남습니다. 업체의 접수 여부가 불명확한 SMTP 전송은 기존 정책대로 자동 재발송하지 않습니다.

기존 3파일 첨부 기능의 최초 운영 반영 순서는 다음과 같습니다. 저장/미리보기/발송 분리 업데이트는 DB나 SMTP 비밀값 변경 없이 웹과 Mac 앱을 갱신합니다.

1. `20261025080721_review_email_attachment_refs.sql`을 적용합니다. 일반 메일용 기존 RPC는 유지하고 첨부 메일용 RPC만 추가합니다. 워커 소유 기간은 파일 검증 시간을 포함해 180초입니다.
2. `supabase/functions/send-transactional-email`을 배포합니다. 기존 인증 비밀키·발신자 설정은 그대로 사용합니다. 신규 relay는 기존 첨부 없는 요청도 처리합니다.
3. 웹 서버를 배포합니다. Mac 앱은 서버의 동일한 결과 알림 경로를 호출하며 SMTP 비밀번호를 보관하지 않습니다.

SMTP, Gmail, Resend, Supabase SMTP relay 모두 같은 세 파일을 전달합니다. relay는 인증 후 `X-Onside-Attachment-Count: 3` 요청의 크기를 최대 26MiB, 처리 시간을 55초로 제한합니다. 일반 요청의 128KiB/14초 제한은 유지합니다. 외부 URL이나 Nodemailer 파일 경로를 첨부로 받지 않습니다.

회귀 검증은 `tests/review-summary-email.test.ts`, `tests/email-attachments.test.ts`, `tests/admin-submission-notifications.test.ts`, `tests/email-outbox.test.ts`, `tests/supabase-email-relay.test.ts`와 `python3 scripts/email-outbox-sql-test.py`로 수행합니다. 테스트는 가상 수신자와 모의 transport 또는 폐기 가능한 로컬 Postgres를 사용하며 실제 고객 메일을 발송하지 않습니다.
