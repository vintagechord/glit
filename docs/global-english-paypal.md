# Onside English / PayPal Setup

This document covers the English Onside flow for overseas artists, labels,
distributors, managers, and PR agencies. The English version is not a separate
service concept. It mirrors the Korean Onside review process and changes the
payment method to PayPal.

## Routes

- `/en`: English landing page for the same Onside review service
- `/en/apply`: English service selection
- `/en/apply/album`: English album review submission
- `/en/apply/mv`: English music video online review submission
- `/en/apply/mv?type=broadcast`: English music video TV broadcast review submission
- `/en/track`: English progress/result lookup
- `/en/submissions/[id]`: PayPal payment/status return page
- `/api/global/submissions`: Creates an English submission in the existing `submissions` table
- `/api/paypal/orders`: Creates a PayPal Orders v2 checkout order
- `/api/paypal/capture`: Captures or cancels PayPal checkout

## Environment Variables

Required for PayPal checkout:

- `PAYPAL_MODE`: `sandbox` or `production`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`

Optional English service pricing:

- `ONSIDE_EN_ALBUM_REVIEW_USD` default `180`
- `ONSIDE_EN_MV_ONLINE_REVIEW_USD` default `220`
- `ONSIDE_EN_MV_BROADCAST_REVIEW_USD` default `260`
- `ONSIDE_GLOBAL_CURRENCY` default `USD`

Legacy fallbacks are still read for compatibility:

- `ONSIDE_GLOBAL_MUSIC_REVIEW_USD`
- `ONSIDE_GLOBAL_MV_REVIEW_USD`

Do not hardcode PayPal credentials in source code.

## Database Migration

Apply the non-destructive migration manually after reviewing it:

```sql
supabase/migrations/0046_global_submissions_paypal.sql
```

The migration adds nullable English/global metadata columns, indexes, and the
`PAYPAL` payment method enum value. It does not drop, rename, or rewrite
existing Korean submission data.

Without this migration, English pages still render, but PayPal checkout cannot
safely calculate the server-side amount from stored submission metadata.

## Submission Mapping

English submissions are saved into the same `submissions` table and use the same
review types as Korean submissions:

- `album_review` -> `ALBUM`
- `mv_online_review` -> `MV_DISTRIBUTION`
- `mv_broadcast_review` -> `MV_BROADCAST`

English rows keep `locale = en`, `created_from = global`, and
`payment_provider = paypal` so admins can identify overseas English submissions.
Country, translation request status, ISRC, UPC, and overseas label metadata are
stored in the English/global metadata columns and `global_form`.

## Payment Flow

1. The applicant chooses a service on `/en/apply`.
2. The applicant submits the English form for album or MV review.
3. The server saves the row in `submissions` with the correct review type.
4. The client requests `/api/paypal/orders`.
5. The server creates a PayPal Orders v2 order using the stored amount/currency.
6. The applicant approves payment on PayPal.
7. PayPal returns to `/api/paypal/capture`.
8. The server captures the order and marks the submission `PAID` and
   `IN_PROGRESS`.
9. The applicant checks progress from `/en/track` with the same guest lookup
   code.

## Required Disclaimer

English:

> Onside provides submission support for Korean broadcast review. Approval,
> broadcast airplay, programming, playlisting, and royalty collection are not
> guaranteed.

Korean:

> 온사이드는 국내 방송심의 접수 진행을 지원하는 서비스입니다. 심의 통과,
> 방송 송출, 편성, 플레이리스트 반영, 방송 보상금 발생을 보장하지 않습니다.

## Test Checklist

- Existing Korean homepage loads normally.
- Existing Korean album submission form loads normally.
- Existing Korean MV submission form loads normally.
- Existing domestic Inicis payment routes still build.
- `/en` loads and uses English copy.
- `/en/apply` shows the same three service categories as Korean.
- `/en/apply/album` loads an English album form with package selection.
- `/en/apply/mv` loads an English MV online form.
- `/en/apply/mv?type=broadcast` loads an English MV broadcast form.
- `/en/track` redirects logged-in users to My Page and shows guest lookup only
  for logged-out users.
- Header language switch shows `EN` on Korean pages and `KR` on English pages.
- English form shows the required disclaimer before submit.
- English form validates required fields.
- PayPal order API returns a clear configuration error when PayPal env is absent.
- With PayPal sandbox env and migration applied, PayPal order create returns an
  approval URL.
- PayPal capture marks the submission `PAID`.
- PayPal cancel leaves the submission pending/unpaid.
- Admin submissions list can show English/global rows, country, and PayPal
  provider when global columns exist.
- Mobile pages have no horizontal overflow.

## Rollback

If the Korean submission or payment flow regresses, revert the English-specific
code files and do not apply the migration.

If the migration has already been applied, leave the added nullable columns in
place unless a separate reviewed rollback migration is prepared. They are
non-destructive and do not affect existing Korean rows.
