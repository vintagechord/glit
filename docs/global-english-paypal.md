# Onside English Language Pack

The English version must use the same pages and the same product flow as the
Korean Onside service. It is not a separate global product flow.

## Principle

- Korean route: `/dashboard/new`
- English route: `/en/dashboard/new`
- Both routes render the same page/component.
- English text is applied by `EnglishLanguagePack`.
- Submission save actions, file uploads, result pages, my page, and admin
  linkage stay shared.

## Mirrored Routes

- `/en` mirrors `/`
- `/en/dashboard/new` mirrors `/dashboard/new`
- `/en/dashboard/new/album` mirrors `/dashboard/new/album`
- `/en/dashboard/new/mv` mirrors `/dashboard/new/mv`
- `/en/dashboard/pay/[id]` mirrors `/dashboard/pay/[id]`
- `/en/dashboard/submissions/[id]` mirrors `/dashboard/submissions/[id]`
- `/en/track` mirrors `/track`
- `/en/track/[token]` mirrors `/track/[token]`
- `/en/mypage` mirrors `/mypage`
- `/en/login` mirrors `/login`
- `/en/signup` mirrors `/signup`
- `/en/guide`, `/en/faq`, `/en/support`, `/en/forms` mirror the Korean pages

Legacy `/en/apply` and `/en/submissions/[id]` URLs redirect to the mirrored
routes for compatibility.

## Language Pack

`src/components/i18n/english-language-pack.tsx` runs only on `/en` routes. It:

- translates visible Korean UI text after the original page renders;
- translates common placeholders, labels, alerts, and confirms;
- keeps internal links inside the `/en` route namespace.

This keeps the Korean and English versions on one functional implementation
instead of maintaining a second submission form.

## Payment Note

The current mirrored English routes use the same payment behavior as the Korean
implementation. If PayPal is required for English checkout, add it as a payment
provider option inside the shared album/MV submission and payment components,
not as a separate English submission flow.
