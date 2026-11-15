# Failed-mail acknowledgement and email typo hint (2026-11-16)

## Why
On 11/15 a guest typed `@hanmail.met`. Three customer mails bounced, and the
site monitor showed 주의 on two cards. The owner decided the mails need no
resend, but a failed mail could not be cleared: it kept the warning until the
30-day purge. The typo itself came from the application form, which accepted
it without a word.

## Goals
- An administrator can mark a failed or uncertain mail 확인 완료. It then
  leaves `email_outbox_stats` (site health check, /admin/emails counts) and
  `site_monitoring_snapshot` (desk monitor).
- A later 재발송 clears the mark, so a new failure warns again.
- Customer application forms (album ×3 inputs, MV, karaoke) show one short
  non-blocking line when the email domain looks like a typo:
  `혹시 hanmail.net인가요? [바꾸기]`, shown only after the field loses focus.

## Non-goals / anti-goals
- No blocking validation, server-side rejection or DNS/MX lookup. A real
  domain must never be refused.
- Signup, login, profile and lookup forms are unchanged.
- No desk app rebuild: the desk reads `site_monitoring_snapshot`.
- Must not change how mail is queued, claimed or finished (signup and payment
  mail use the same outbox).

## Approaches considered
- **Acknowledged columns plus filtered counts (chosen).** History stays
  intact, and the counts exclude acknowledged rows.
- Set status to `expired`, or delete the rows. Rejected: either falsifies or
  loses the bounce record.
- Typo hint shown live while typing. Rejected: it flickers mid-word (`naver.co`).
  Instead a `peer-focus:hidden` sibling shows it only after blur, with no JS
  focus tracking.

## Design
- Migration: add `email_outbox.acknowledged_at timestamptz` and
  `acknowledged_by uuid`, both nullable. Redefine three functions:
  - `email_outbox_stats`: failed and uncertain count only unacknowledged
    rows, plus an `acknowledged` count.
  - `retry_email_outbox`: clears both columns.
  - `site_monitoring_snapshot`: acknowledged rows are grouped as
    `acknowledged` instead of their status.
- Server action `acknowledgeEmailAction`: admin only. Updates only
  failed/uncertain rows that are not yet acknowledged. Redirects back like
  `retryEmailAction` does.
- UI: a 확인 완료 button next to 재발송 예약 in `/admin/emails` and in
  `ReviewEmailControl`. Acknowledged rows show a "확인 완료 <time>" badge.
- `src/lib/email-typo.ts` `suggestEmailFix`:
  - Single-domain providers (gmail, naver, hanmail, daum, nate, kakao,
    icloud): any other TLD on that name is suggested back.
  - Otherwise a Damerau distance of 1 to a known domain whose name is longer
    than 4 characters.
  - `mail.com` and `email.com` are excluded.
- `EmailTypoHint` component. The EN pack gets the pattern
  `^혹시 (.+)인가요\?$` and the exact string `바꾸기`.

## Left to the builder
Copy details, tests, and the migration timestamp.
