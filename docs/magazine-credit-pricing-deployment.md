# Magazine requests: 3-credit pricing

New magazine publication requests cost 3 credits. Requests created before this
migration retain their original 1-credit charge, including requests later
canceled or restored by an administrator. Canceled requests do not consume
credits; their recorded charge remains available in request history.

## Database change

Apply `supabase/migrations/20261020092015_magazine_three_credit_requests.sql` to
the Onside project (`rwysjsmxtpuqekeltwxi`) as part of the application release.
The application detects whether `magazine_requests.credits_spent` is available.
Before the migration, existing balances and history remain readable at their
legacy 1-credit charge, while new magazine requests are disabled in both the UI
and server action. Other services remain available. Applying the complete atomic
migration enables new 3-credit magazine requests on the next page load.

The transaction:

- Adds the recorded charge to magazine requests, preserving existing rows as 1.
- Sets the default and `create_magazine_request` charge to 3.
- Makes magazine, credit reward, and service reservation RPCs sum recorded
  magazine charges when checking the balance.
- Preserves the shared per-user transaction lock and RPC-only member writes.
- Limits spending RPC execution to authenticated/service-role callers; each RPC
  still requires an authenticated user identity.

Do not multiply existing magazine usage by 3 or edit old migration files. The
compatibility fallback applies only to the exact missing-column error; other
database errors continue to fail rather than exposing an incorrect balance.

After applying the migration, check the following without creating real requests:

```sql
select credits_spent, status, count(*)
from public.magazine_requests
group by credits_spent, status
order by credits_spent, status;

select column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'magazine_requests'
  and column_name = 'credits_spent';

select has_function_privilege(
  'anon',
  'public.create_magazine_request(uuid,text,text,text,text,text,text,date,text,text,text,text,text,text)',
  'execute'
) as anon_may_request;
```

Expected default: `3`; nullable: `NO`; anonymous execution: `false`. Existing
requests should retain `credits_spent = 1`. Verify the magazine tab, request form,
and My Credits action show 3 credits after deploying the matching application.

## Reproducible local checks

```sh
node --test --import tsx tests/magazine-credit-cost.test.ts tests/credits-action-i18n.test.ts tests/credits-page-layout.test.ts
bash scripts/magazine-credits-sql-test.sh
```

The SQL check uses a fresh PostgreSQL 17 container with its network disabled. It
applies the relevant historical migrations, seeds fictional users, applies this
migration, and checks the 2/3-credit boundary, legacy charges, cancellation,
cross-service balances, direct-insert rejection, and concurrent spending.
The container is removed when the test ends.
