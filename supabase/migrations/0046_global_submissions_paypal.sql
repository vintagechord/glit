-- Global / English submissions and PayPal payment metadata.
-- Non-destructive migration: only adds enum values, nullable columns, and indexes.

do $$ begin
  alter type public.payment_method add value if not exists 'PAYPAL';
exception
  when undefined_object then null;
end $$;

alter table public.submissions
  add column if not exists locale text not null default 'ko',
  add column if not exists applicant_country text,
  add column if not exists original_language text,
  add column if not exists payment_provider text,
  add column if not exists payment_currency text,
  add column if not exists payment_amount numeric(12, 2),
  add column if not exists paypal_order_id text,
  add column if not exists paypal_capture_id text,
  add column if not exists content_type text,
  add column if not exists translation_required boolean not null default false,
  add column if not exists created_from text not null default 'domestic',
  add column if not exists original_lyrics text,
  add column if not exists korean_lyrics_translation text,
  add column if not exists audio_file_link text,
  add column if not exists cover_image_link text,
  add column if not exists music_video_url text,
  add column if not exists rights_holder_name text,
  add column if not exists requested_broadcaster text,
  add column if not exists korean_promoter text,
  add column if not exists isrc text,
  add column if not exists upc text,
  add column if not exists global_form jsonb not null default '{}'::jsonb;

create index if not exists submissions_locale_idx
  on public.submissions (locale);

create index if not exists submissions_created_from_idx
  on public.submissions (created_from);

create index if not exists submissions_payment_provider_idx
  on public.submissions (payment_provider);

create unique index if not exists submissions_paypal_order_id_key
  on public.submissions (paypal_order_id)
  where paypal_order_id is not null;

alter table public.submission_payments
  add column if not exists provider text,
  add column if not exists currency text,
  add column if not exists amount numeric(12, 2),
  add column if not exists paypal_capture_id text;

create index if not exists submission_payments_provider_idx
  on public.submission_payments (provider);
