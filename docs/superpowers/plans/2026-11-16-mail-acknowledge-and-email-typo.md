# Failed-mail acknowledgement and email typo hint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin clear a failed mail from the monitor warnings with 확인 완료, and show customers a one-line typo hint on application email fields.

**Architecture:** Two nullable columns on `email_outbox`. The three SQL functions that count or retry mail read them. A server action and two admin lists write them. A pure `suggestEmailFix` function feeds an `EmailTypoHint` sibling element that is hidden by `peer-focus`.

**Tech Stack:** Next.js app router, Supabase Postgres migrations, node:test with tsx, Playwright isolated-render e2e, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-11-16-mail-acknowledge-and-email-typo-design.md`

## Global Constraints
- Copy: `확인 완료`, `혹시 <domain>인가요?`, `바꾸기`. EN: `Did you mean <domain>?`, `Use it`.
- Colors: Bauhaus palette only (#f2cf27 yellow, #1556a4 blue, #d9362c red, #1f8a4c green), black 2px borders, no pastel.
- No change to enqueue, claim or finish of the outbox. Signup, login, profile and lookup forms are untouched.
- No blocking validation of customer email.

## Review Focus
1. An email typed with uppercase letters or spaces (`Abc@Hanmail.Met `): the suggestion keeps the local part and fixes only the domain.
2. Real domains that are not on the list (company domains, `hotmail.co.uk`, `mail.com`, `email.com`): no hint.
3. A forged or stale 확인 완료 on an accepted, pending or already-acknowledged mail: no row changes.
4. 재발송 of an acknowledged mail: the mark is cleared, so a new failure warns again.
5. Typing in progress: the hint stays hidden while the field has focus.

---

### Task 1: Migration and SQL test
**Files:** Create `supabase/migrations/20261116090000_email_outbox_acknowledgement.sql` and `tests/sql/email-outbox-acknowledgement.sql`. Modify `scripts/email-outbox-sql-test.py`.
- [ ] Write the SQL test, which must pass on the new schema:
  - stats `failed`/`uncertain` exclude acknowledged rows, and `acknowledged` counts them.
  - `retry_email_outbox` nulls `acknowledged_at`/`acknowledged_by`.
  - the browser roles cannot update the outbox.
- [ ] Write the migration:
  - columns `acknowledged_at timestamptz`, `acknowledged_by uuid`.
  - redefine `email_outbox_stats` and `retry_email_outbox` (the same bodies plus the acknowledgement handling).
  - redefine `site_monitoring_snapshot` with `case when acknowledged_at is not null then 'acknowledged' else status end` in the emailOutbox group.
- [ ] Run `python3 scripts/email-outbox-sql-test.py`. All lines must print PASS.
- [ ] Validate `site_monitoring_snapshot` against a schema-only restore of the latest backup. Then run `supabase db push --linked --dry-run`; only this file may be pending.

### Task 2: acknowledgeEmailAction
**Files:** Modify `src/app/admin/emails/actions.ts` and `tests/email-admin-health.test.ts`.
**Produces:** `acknowledgeEmailAction(form: FormData): Promise<void>`. The fields are `id`, plus optional `submissionId` and `returnTo`. Notices: `/admin/emails?notice=acknowledged` and saved `email_acknowledged` on the detail page.
- [ ] Test:
  - unauthorized → rejects before any DB call.
  - the update patch has `acknowledged_by` = the admin id.
  - the filters are `in(status, [failed, uncertain])` and `is(acknowledged_at, null)`.
  - a DB error → `notice=acknowledge_failed`.
- [ ] Implement, then run `npx tsx --test tests/email-admin-health.test.ts`.

### Task 3: Admin lists
**Files:**
- Modify `src/lib/admin/submission-emails.ts`: add `acknowledgedAt: string | null` and select it.
- Modify `src/components/admin/review-email-control.tsx`, `src/app/admin/emails/page.tsx`, and the detail page saved message.
- Test: `tests/e2e/admin-email-retry-recipient.spec.ts`.
- [ ] E2E: a failed, unacknowledged mail shows a `확인 완료` button. An acknowledged one shows the badge `확인 완료 <time>` and no 확인 완료 button; 재발송 stays available.
- [ ] Implement, run the e2e, and commit.

### Task 4: suggestEmailFix
**Files:** Create `src/lib/email-typo.ts` and `tests/email-typo.test.ts`.
**Produces:** `suggestEmailFix(value: string): string | null`, which returns the full corrected address or null.
- [ ] Test:
  - `a@hanmail.met`→`a@hanmail.net`, `a@gmail.con`, `a@gmail.co`, `a@gmail.net`, `a@gmail`→`a@gmail.com`.
  - `a@gmial.com`, `a@hanmial.net`, `a@nver.com`.
  - `Abc@Hanmail.Met `→`Abc@hanmail.net`.
  - null for `a@naver.com`, `a@mail.com`, `a@email.com`, `a@hotmail.co.uk`, `a@company.co.kr`, `a@gate.com`, `''`, `a@`, `@b.com`.
- [ ] Implement:
  - single-domain map: gmail, naver, hanmail, daum, nate, kakao, icloud.
  - otherwise Damerau distance 1 to a known domain whose name is longer than 4 characters.
  - exclude `mail.com` and `email.com`.

### Task 5: EmailTypoHint and wiring
**Files:**
- Create `src/components/forms/email-typo-hint.tsx`.
- Modify `src/features/submissions/album-wizard.tsx` (3 inputs), `src/features/submissions/mv-wizard.tsx`, `src/features/karaoke/karaoke-form.tsx` and `src/components/i18n/english-language-pack.tsx`.
- Test: `tests/e2e/email-typo-hint.spec.ts`.

**Produces:** `EmailTypoHint({ email, onApply }: { email: string; onApply: (fixed: string) => void })`. It must be rendered as a later sibling of an input that has the class `peer`.
- [ ] E2E (isolated render):
  - hidden while focused.
  - after blur it shows `혹시 hanmail.net인가요?`.
  - `바꾸기` sets the value, and the hint disappears.
- [ ] Wire it in and add the EN pattern and exact string. Run the e2e.

### Task 6: Regression and deploy
- [ ] Run `npm test`, `npx tsc --noEmit`, `npx eslint` on the changed files, and `npm run build`.
- [ ] Run the e2e for the signup and application flows: auth-flow, auth-email-notices, mv-application-fields, album-release-flow, english-review-flow, english-review-public, manual-email-mode, and any spec touching the wizards. Compare against the known pre-existing failures.
- [ ] Deploy:
  - `supabase db push --linked` (dry-run first), then `migration list`.
  - PR, squash-merge, and watch the Vercel status.
  - Acknowledge the three 11/15 hanmail.met rows, and confirm the monitor counts.
