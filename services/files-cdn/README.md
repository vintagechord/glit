# Onside file downloads through Cloudflare

Customer files (음원·영상·필증) stay in the private Backblaze B2 bucket. Onside no longer hands out B2 presigned URLs when this Worker is configured: it signs a short-lived link to the Worker, and the Worker reads the object from B2 and streams it back. Backblaze does not charge egress to Cloudflare, so downloads no longer use up the B2 daily download cap that blocked every download on 2026-11-04.

## How a download works

1. `presignGetUrl` (`src/lib/b2.ts`) sees `FILES_CDN_BASE_URL` and `FILES_CDN_SIGNING_SECRET` and returns `https://<worker>/f/<base64url key>?e=<expiry>&n=<filename>&t=<type>&s=<hmac>` from `src/lib/file-cdn.ts`.
2. The Worker checks the HMAC-SHA256 over `onside-file-v1\nkey\nexpiry\nfilename\ntype` with `FILES_SIGNING_SECRET`, the expiry (at most 7 days), and rejects `..`/`.` path segments.
3. It signs a SigV4 GET/HEAD to the B2 S3 API (path style, unsigned payload), forwards `Range`/`If-*` headers, and returns the body as an attachment with `private, no-store`, `nosniff` and a sandbox CSP.
4. A B2 cap error becomes `503` with a plain message; a missing object is `404`.

The review desk (`tools/onside-desk/source.mjs`, 2.8.1) signs the same link with the same secret when its `connection.env` has the two values.

## Configuration

| Where | Name | Value |
| --- | --- | --- |
| Worker secret | `B2_S3_ENDPOINT`, `B2_REGION`, `B2_BUCKET` | Same as the Onside service |
| Worker secret | `B2_KEY_ID`, `B2_APPLICATION_KEY` | A key that can read the bucket (a read-only key is preferred) |
| Worker secret | `FILES_SIGNING_SECRET` | Random, at least 32 characters |
| Vercel (Production) | `FILES_CDN_BASE_URL` | `https://onside-files.<subdomain>.workers.dev` |
| Vercel (Production) | `FILES_CDN_SIGNING_SECRET` | Same value as the Worker's `FILES_SIGNING_SECRET` |
| Desk `connection.env` | `FILES_CDN_BASE_URL`, `FILES_CDN_SIGNING_SECRET` | Same as Vercel |

Removing the two Vercel values (or the desk values) falls back to B2 presigned URLs.

```sh
npx wrangler@4 deploy --config services/files-cdn/wrangler.toml
npx wrangler@4 secret put FILES_SIGNING_SECRET --config services/files-cdn/wrangler.toml
```

## Notes

- B2 still counts one Class B transaction per download request; only the egress is free.
- Uploads, upload verification and email attachments still talk to B2 directly; they move few bytes.
- Tests: `tests/file-cdn-worker.test.ts` (SigV4 matches the AWS SDK signer, link checks, streaming, error mapping) and the desk's `source.test.mjs`.
