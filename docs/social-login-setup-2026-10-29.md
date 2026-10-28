# Onside social authentication — 2026-10-29

The separate station-table adjustment is already deployed: [PR #30](https://github.com/vintagechord/glit/pull/30), commit `b311a1b14ebcb2cdab78540d2819ed6d198d3ae3`, Render deployment `dep-dbh1cthsrm7s73f0au5g`, Live **2026-10-29 00:38:46 KST**. The repeated black heading row is removed and status badges fit their labels. Four read-only production browser cases confirmed Korean/English at 320/1024px, two pairs per row and working result dialogs.

## Implementation

The Artmelon project was used as an implementation reference. Onside keeps its own Supabase users, sessions, developer applications and credentials. Google and Kakao use native Supabase OAuth providers; Naver uses the `custom:naver` OIDC provider. No provider SDK is loaded into the homepage.

Native provider links create per-flow PKCE requests on the canonical origin. The callback validates the code and flow identifier, buffers cookie changes until verification succeeds, preserves existing sessions on failure and keeps the internal return path and locale. Existing profiles and roles are preserved. New social members complete the existing four required signup agreements; trusted consent is stored in Auth app metadata, then the session is refreshed. Both the optimistic page redirect and verified server user reads enforce completion.

Members can explicitly connect another social identity from their account page through a same-origin POST. The signed, short-lived linking intent binds the provider, user, callback and PKCE flow. Accounts are never merged by application-side email matching. Native provider verification and identity linking own that decision.

Social identities without an email are supported without fabricated addresses. Their account page explains the missing address and does not offer an inapplicable password form. Review applications collect contact email; notices use that address only when a verified existing social member has no Auth email. Existing Auth email always takes priority, and failed/missing-user lookups never fall back to old applicant addresses.

Application contact addresses receive only their own application's payment or bank-transfer notice. They do not receive the full order's other applications, titles, artists or total; order details remain behind the member's login. Auth-email recipients retain the existing order summary. Administrator receipts use the authenticated administrator link and never include the customer's guest access token.

Magazine requests from members without an Auth email require a valid contact email before submission. A member without an Auth email cannot create a new recurring subscription order or payment-gateway request; the subscription page offers another email-bearing account or support. An existing active subscription remains viewable.

Public login/signup/profile forms stream independently of provider availability. Availability contains booleans only, caches for 60 seconds and uses the public Auth settings endpoint. Naver requires the explicit server flag `ONSIDE_NAVER_LOGIN_ENABLED=true`; rendering pages never reads an admin provider/configuration endpoint.

Public policy pages are part of this source release and share the footer's existing policy content: Korean terms at `https://glit-b1yn.onrender.com/terms`, Korean privacy at `https://glit-b1yn.onrender.com/privacy`, and English equivalents at `/en/terms` and `/en/privacy`. Use the deployed URLs in provider-console website, terms and privacy fields after confirming they return successfully. Adding these routes does not itself constitute provider review or approval.

## Release verification

The release snapshot is `/private/tmp/glit-social-release-20261029`, with the explicit 65-file manifest at `/private/tmp/onside-social-release-files.json`. A byte comparison confirmed that all 65 manifest entries were present, unique and identical to the working source. Unrelated review-document, desktop-app and Supabase temporary-file changes are excluded.

Validation recorded for this implementation: 91 unit tests passed; the browser regression run passed 29 cases. Focused follow-up runs passed 8 social UI cases and 3 magazine contact-email cases. These separate runs may overlap and are not added into one test count. The release production build also passed. Fixture/browser tests do not establish that a native provider is configured or approved, and do not replace the real provider checks below.

On **2026-10-29 01:07 KST**, read-only requests to the running release server at port 3108 confirmed `/auth/callback` responses use `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store, max-age=0`. Malformed or incomplete callbacks returned HTTP 303 with `social_error=expired`, without any `Set-Cookie`; an external `next` destination fell back to `/mypage`, while a safe English destination retained `/en/dashboard/new?draft=fixture`. HEAD returned 204 with the same privacy headers and no cookies. These checks did not exchange an authorization code, create a session, or send mail.

## Required hosted configuration

| Setting | Exact value or required behavior |
| --- | --- |
| Canonical app / Site URL | `https://glit-b1yn.onrender.com` |
| Provider callback, all three apps | `https://rwysjsmxtpuqekeltwxi.supabase.co/auth/v1/callback` |
| Onside callback allowlist | `https://glit-b1yn.onrender.com/auth/callback**` (the fixed callback path plus its flow/locale/return query) |
| Google | Dedicated Onside web OAuth client; basic OpenID/profile/email scopes |
| Kakao | Dedicated Onside app, enabled Login REST key and Login client secret; nickname permission; `email_optional=true`; request only `profile_nickname` |
| Naver | Dedicated Onside OIDC app; identifier `custom:naver`; issuer `https://nid.naver.com`; OpenID/profile; PKCE enabled, nonce checks enabled, `email_optional=true` |
| Explicit account connection | Supabase manual identity linking enabled |
| Naver public gate | Set `ONSIDE_NAVER_LOGIN_ENABLED=true` only after the provider is provisioned and verified |

OAuth client secrets belong only in Supabase provider settings. They must not be added to public Next.js variables, browser code, logs or this repository. Existing Artmelon/Watermelon credentials and developer apps are not reused.

## Current setup status and approval boundary

- Public Onside Auth settings were read without a server key: Google and Kakao are disabled; email/password is enabled.
- The initial Google console resource search found no Onside project. Initial Naver and Kakao setup stopped at developer-registration/terms pages before any app or credential was created.
- Automatic approval review rejected a proposed script that would read the local Supabase CLI Keychain token and use the server role key to query management/provider settings. That script was not executed. This path must not be retried indirectly without approval.
- The working alternative is the already signed-in official developer and Supabase consoles. Provider terms acceptance, creating OAuth credentials/basic-profile access, and transferring the new client ID/secret into Onside Supabase require explicit confirmation under the computer-use rules before those actions.
- The user then explicitly approved that console workflow and real current-account verification. Despite that approval, automatic review rejected the attempted Kakao developer-terms checkbox, stating that action-time confirmation was still absent. The agent did not change that checkbox or registration. On **2026-10-29**, the user confirmed completing the Naver/Kakao developer-registration/terms steps directly; the previous handoff is resolved, and the approved console provisioning can resume.
- Until that approved setup and real native-provider verification are complete, the new social controls truthfully remain unavailable. Unit/fixture success is not evidence of real provider signup or login.

After setup, verify each real provider's first signup, consent completion, logout, returning login, callback failure/retry, profile/role ownership, no-email account behavior and explicit linking. Provider publication/review requirements must be confirmed in the actual consoles; do not claim public approval from a test-user login.

References: [Supabase Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Kakao](https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao), [custom OAuth/OIDC](https://supabase.com/docs/guides/auth/custom-oauth-providers), [redirects](https://supabase.com/docs/guides/auth/redirect-urls), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Naver OIDC discovery](https://nid.naver.com/.well-known/openid-configuration).
