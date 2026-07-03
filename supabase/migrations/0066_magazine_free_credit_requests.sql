alter table if exists public.magazine_requests
  alter column submission_id drop not null;

drop index if exists public.magazine_requests_submission_key;
create unique index if not exists magazine_requests_submission_key
  on public.magazine_requests (submission_id)
  where submission_id is not null
    and status <> 'CANCELED';

drop policy if exists "Magazine requests readable by owner or admin" on public.magazine_requests;
create policy "Magazine requests readable by owner or admin"
on public.magazine_requests
for select
using (
  public.is_admin()
  or user_id = auth.uid()
  or (
    submission_id is not null
    and exists (
      select 1
      from public.submissions s
      where s.id = magazine_requests.submission_id
        and s.user_id = auth.uid()
    )
  )
);

drop policy if exists "Magazine requests insertable by owner" on public.magazine_requests;
create policy "Magazine requests insertable by owner"
on public.magazine_requests
for insert
with check (
  user_id = auth.uid()
  and (
    submission_id is null
    or exists (
      select 1
      from public.submissions s
      where s.id = magazine_requests.submission_id
        and s.user_id = auth.uid()
        and s.type = 'ALBUM'
        and s.payment_status = 'PAID'
    )
  )
);

create or replace function public.create_magazine_request(
  p_submission_id uuid,
  p_target_channel text,
  p_requester_name text,
  p_requester_email text,
  p_requester_phone text,
  p_album_title text,
  p_artist_name text,
  p_release_date date,
  p_artwork_url text,
  p_album_url text,
  p_video_url text,
  p_article_body text,
  p_credits_text text,
  p_notes text
)
returns public.magazine_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_earned integer := 0;
  v_admin_granted integer := 0;
  v_magazine_used integer := 0;
  v_reward_used integer := 0;
  v_available integer := 0;
  v_request public.magazine_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'LOGIN_REQUIRED';
  end if;

  if p_target_channel not in ('DOMESTIC_NEWS', 'MEDIA') then
    raise exception 'INVALID_TARGET_CHANNEL';
  end if;

  if btrim(coalesce(p_requester_name, '')) = ''
    or btrim(coalesce(p_requester_email, '')) = '' then
    raise exception 'INVALID_CONTACT';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  select count(*)::integer
    into v_earned
  from public.submissions
  where user_id = v_user_id
    and type = 'ALBUM'
    and payment_status = 'PAID';

  select coalesce(sum(g.amount), 0)::integer
    into v_admin_granted
  from public.credit_grants g
  where g.user_id = v_user_id;

  select count(*)::integer
    into v_magazine_used
  from public.magazine_requests
  where user_id = v_user_id
    and status <> 'CANCELED';

  select coalesce(sum(credits_spent), 0)::integer
    into v_reward_used
  from public.credit_reward_redemptions
  where user_id = v_user_id
    and status <> 'CANCELED';

  v_available := v_earned + v_admin_granted - v_magazine_used - v_reward_used;

  if v_available < 1 then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  if p_submission_id is not null then
    if not exists (
      select 1
      from public.submissions s
      where s.id = p_submission_id
        and s.user_id = v_user_id
        and s.type = 'ALBUM'
        and s.payment_status = 'PAID'
    ) then
      raise exception 'INVALID_SUBMISSION';
    end if;

    if exists (
      select 1
      from public.magazine_requests mr
      where mr.submission_id = p_submission_id
        and mr.status <> 'CANCELED'
    ) then
      raise exception 'DUPLICATE_SUBMISSION';
    end if;
  end if;

  insert into public.magazine_requests (
    submission_id,
    user_id,
    target_channel,
    requester_name,
    requester_email,
    requester_phone,
    album_title,
    artist_name,
    release_date,
    artwork_url,
    album_url,
    video_url,
    article_body,
    credits_text,
    notes
  )
  values (
    p_submission_id,
    v_user_id,
    p_target_channel,
    btrim(p_requester_name),
    btrim(p_requester_email),
    nullif(btrim(coalesce(p_requester_phone, '')), ''),
    nullif(btrim(coalesce(p_album_title, '')), ''),
    nullif(btrim(coalesce(p_artist_name, '')), ''),
    p_release_date,
    nullif(btrim(coalesce(p_artwork_url, '')), ''),
    nullif(btrim(coalesce(p_album_url, '')), ''),
    nullif(btrim(coalesce(p_video_url, '')), ''),
    nullif(btrim(coalesce(p_article_body, '')), ''),
    nullif(btrim(coalesce(p_credits_text, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_request;

  return v_request;
end;
$$;

grant execute on function public.create_magazine_request(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;
