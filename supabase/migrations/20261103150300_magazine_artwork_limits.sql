-- Members upload magazine artwork straight to this public bucket with a
-- one-time signed URL, before their request exists. The size and type the
-- browser declared were all that limited it. Storage now enforces the form's
-- own limits: 20MB, JPG/PNG/WEBP/GIF.
update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'magazine-artwork';

-- Uploads no request points at after p_min_age were abandoned (the form
-- uploads right before it files the request). Only the member upload folder
-- (<uid>/uploads/...) is considered; the scheduled storage cleanup removes
-- the listed names through the Storage API.
create or replace function public.list_orphan_magazine_artwork(
  p_min_age interval default interval '1 day',
  p_limit integer default 100
)
returns table(object_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Orphan artwork listing requires the service role.'
      using errcode = '42501';
  end if;
  if p_min_age is null or p_min_age < interval '1 hour' then
    raise exception 'INVALID_ORPHAN_ARTWORK_AGE' using errcode = '22023';
  end if;

  return query
  select artwork.name::text
  from storage.objects artwork
  where artwork.bucket_id = 'magazine-artwork'
    and artwork.name ~ '^[0-9a-f-]{36}/uploads/[A-Za-z0-9._-]+$'
    and artwork.created_at <= now() - p_min_age
    and not exists (
      select 1
      from public.magazine_requests request
      where strpos(coalesce(request.artwork_url, ''), '/magazine-artwork/' || artwork.name) > 0
    )
  order by artwork.created_at
  limit least(500, greatest(1, coalesce(p_limit, 100)));
end;
$$;

revoke all on function public.list_orphan_magazine_artwork(interval, integer)
  from public, anon, authenticated;
grant execute on function public.list_orphan_magazine_artwork(interval, integer)
  to service_role;
