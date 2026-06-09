# Onside Global English / PayPal Setup

This document covers the English global submission flow added for overseas
artists, labels, distributors, managers, and PR agencies.

## Routes

- `/en`: English landing page for Korean Broadcast Review Submission Service
- `/en/apply`: English global submission form
- `/en/submissions/[id]`: Global submission payment/status page
- `/api/global/submissions`: Creates a global submission
- `/api/paypal/orders`: Creates a PayPal Orders v2 checkout order
- `/api/paypal/capture`: Captures or cancels PayPal checkout

## Environment Variables

Required for PayPal checkout:

- `PAYPAL_MODE`: `sandbox` or `production`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`

Optional global product pricing:

- `ONSIDE_GLOBAL_MUSIC_REVIEW_USD` default `180`
- `ONSIDE_GLOBAL_MV_REVIEW_USD` default `220`
- `ONSIDE_GLOBAL_TRANSLATION_USD` default `80`
- `ONSIDE_GLOBAL_CURRENCY` default `USD`

Do not hardcode PayPal credentials in source code.

## Database Migration

Apply the non-destructive migration manually after reviewing it:

```sql
supabase/migrations/0046_global_submissions_paypal.sql
```

The migration only adds nullable metadata columns, indexes, and the `PAYPAL`
payment method enum value. It does not drop, rename, or rewrite existing Korean
submission data.

Without this migration, `/en` and `/en/apply` still render, but PayPal checkout
cannot safely calculate the server-side amount from stored submission metadata.

## Payment Flow

1. The applicant submits `/en/apply`.
2. The server saves a global submission with `created_from = global`,
   `locale = en`, and `payment_provider = paypal`.
3. The client requests `/api/paypal/orders`.
4. The server creates a PayPal Orders v2 order using the stored amount/currency.
5. The applicant approves payment on PayPal.
6. PayPal returns to `/api/paypal/capture`.
7. The server captures the order and marks the submission as `PAID` and
   `IN_PROGRESS`.

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
- `/en/apply` loads on desktop and mobile.
- Header language switch shows `EN` on Korean pages and `KR` on English pages.
- English form shows the required disclaimer before submit.
- English form validates required fields.
- PayPal order API returns a clear configuration error when PayPal env is absent.
- With PayPal sandbox env and migration applied, PayPal order create returns an
  approval URL.
- PayPal capture marks the submission `PAID`.
- PayPal cancel leaves the submission pending/unpaid.
- Admin submissions list can show `GLOBAL`, country, and PayPal provider when
  global columns exist.
- Mobile pages have no horizontal overflow.

## Rollback

If the Korean submission or payment flow regresses, revert the code files added
for the global flow and do not apply the migration.

If the migration has already been applied, leave the added nullable columns in
place unless a separate reviewed rollback migration is prepared. They are
non-destructive and do not affect existing Korean rows.
