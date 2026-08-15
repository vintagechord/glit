-- Persist a singer/performer per album track. Existing submissions used the
-- album-level artist for every track, so that value is the safest backfill and
-- remains the compatibility fallback for older clients.

alter table public.album_tracks
  add column if not exists performer text;

update public.album_tracks track
set performer = submission.artist_name
from public.submissions submission
where submission.id = track.submission_id
  and nullif(btrim(coalesce(track.performer, '')), '') is null
  and nullif(btrim(coalesce(submission.artist_name, '')), '') is not null;

create or replace function public.commit_submission_save(
  p_submission_id uuid,
  p_lease_token uuid,
  p_expected_updated_at timestamptz,
  p_replace_tracks boolean,
  p_tracks jsonb,
  p_replace_files boolean,
  p_file_kind text,
  p_files jsonb,
  p_sync_reviews boolean,
  p_station_ids uuid[],
  p_final_status public.submission_status,
  p_final_payment_status public.payment_status
)
returns table(
  submission_id uuid,
  final_status public.submission_status,
  final_payment_status public.payment_status
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission public.submissions%rowtype;
  v_station_ids uuid[];
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Submission save commit requires the service role.'
      using errcode = '42501';
  end if;
  if p_submission_id is null
    or p_lease_token is null
    or p_expected_updated_at is null
  then
    raise exception 'SUBMISSION_SAVE_COMMIT_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select submission.*
    into v_submission
  from public.submissions submission
  where submission.id = p_submission_id
  for update;

  if not found then
    raise exception 'SUBMISSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_submission.save_lease_token is distinct from p_lease_token
    or v_submission.save_lease_expires_at is null
    or v_submission.save_lease_expires_at <= clock_timestamp()
  then
    raise exception 'SUBMISSION_SAVE_LEASE_INVALID' using errcode = '55000';
  end if;
  if v_submission.updated_at is distinct from p_expected_updated_at
    or v_submission.status <> 'DRAFT'
    or v_submission.payment_status <> 'UNPAID'
  then
    raise exception 'SUBMISSION_SAVE_VERSION_CHANGED' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.submission_payments payment
    where payment.status = 'REQUESTED'
      and public.submission_payment_includes_submission(
        payment.submission_id,
        payment.raw_response,
        p_submission_id
      )
  ) then
    raise exception 'PAYMENT_IN_PROGRESS' using errcode = '55000';
  end if;
  if p_final_payment_status not in ('UNPAID', 'PAYMENT_PENDING')
    or p_final_status not in (
      'DRAFT', 'PRE_REVIEW', 'SUBMITTED', 'WAITING_PAYMENT'
    )
    or (
      p_final_payment_status = 'PAYMENT_PENDING'
      and p_final_status <> 'WAITING_PAYMENT'
    )
  then
    raise exception 'SUBMISSION_SAVE_FINAL_STATE_INVALID'
      using errcode = '22023';
  end if;

  if v_submission.type = 'ALBUM' then
    if coalesce(p_replace_files, false) and p_file_kind <> 'AUDIO' then
      raise exception 'SUBMISSION_FILE_KIND_INVALID' using errcode = '22023';
    end if;
  elsif v_submission.type in ('MV_BROADCAST', 'MV_DISTRIBUTION') then
    if coalesce(p_replace_tracks, false) then
      raise exception 'MV_TRACK_REPLACEMENT_INVALID' using errcode = '22023';
    end if;
    if coalesce(p_replace_files, false) and p_file_kind <> 'VIDEO' then
      raise exception 'SUBMISSION_FILE_KIND_INVALID' using errcode = '22023';
    end if;
  else
    raise exception 'SUBMISSION_TYPE_INVALID' using errcode = '22023';
  end if;

  if coalesce(p_replace_tracks, false) then
    if jsonb_typeof(coalesce(p_tracks, '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(p_tracks, '[]'::jsonb)) > 100
    then
      raise exception 'SUBMISSION_TRACKS_INVALID' using errcode = '22023';
    end if;

    delete from public.album_tracks track
    where track.submission_id = p_submission_id;

    insert into public.album_tracks (
      submission_id,
      track_no,
      track_title,
      track_title_kr,
      track_title_en,
      track_title_official,
      performer,
      featuring,
      composer,
      lyricist,
      arranger,
      lyrics,
      translated_lyrics,
      notes,
      is_title,
      title_role,
      broadcast_selected
    )
    select
      p_submission_id,
      row.track_no,
      row.track_title,
      row.track_title_kr,
      row.track_title_en,
      row.track_title_official,
      coalesce(
        nullif(btrim(coalesce(row.performer, '')), ''),
        nullif(btrim(coalesce(v_submission.artist_name, '')), '')
      ),
      row.featuring,
      row.composer,
      row.lyricist,
      row.arranger,
      row.lyrics,
      row.translated_lyrics,
      row.notes,
      coalesce(row.is_title, false),
      row.title_role,
      coalesce(row.broadcast_selected, false)
    from jsonb_to_recordset(coalesce(p_tracks, '[]'::jsonb)) as row(
      track_no integer,
      track_title text,
      track_title_kr text,
      track_title_en text,
      track_title_official text,
      performer text,
      featuring text,
      composer text,
      lyricist text,
      arranger text,
      lyrics text,
      translated_lyrics text,
      notes text,
      is_title boolean,
      title_role text,
      broadcast_selected boolean
    );
  end if;

  if coalesce(p_replace_files, false) then
    if p_file_kind not in ('AUDIO', 'VIDEO')
      or jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 100
    then
      raise exception 'SUBMISSION_FILES_INVALID' using errcode = '22023';
    end if;

    delete from public.submission_files file
    where file.submission_id = p_submission_id
      and file.kind = p_file_kind::public.file_kind;

    insert into public.submission_files (
      submission_id,
      kind,
      file_path,
      object_key,
      storage_provider,
      status,
      uploaded_at,
      original_name,
      mime,
      size,
      checksum,
      duration_seconds,
      access_url
    )
    select
      p_submission_id,
      p_file_kind::public.file_kind,
      row.file_path,
      row.object_key,
      'b2',
      'UPLOADED',
      coalesce(row.uploaded_at, clock_timestamp()),
      row.original_name,
      row.mime,
      row.size,
      row.checksum,
      row.duration_seconds,
      null
    from jsonb_to_recordset(coalesce(p_files, '[]'::jsonb)) as row(
      file_path text,
      object_key text,
      uploaded_at timestamptz,
      original_name text,
      mime text,
      size bigint,
      checksum text,
      duration_seconds numeric
    )
    where nullif(btrim(coalesce(row.file_path, '')), '') is not null
      and row.file_path = row.object_key;

    if (
      select count(*)
      from jsonb_array_elements(coalesce(p_files, '[]'::jsonb))
    ) <> (
      select count(*)
      from jsonb_to_recordset(coalesce(p_files, '[]'::jsonb)) as row(
        file_path text,
        object_key text
      )
      where nullif(btrim(coalesce(row.file_path, '')), '') is not null
        and row.file_path = row.object_key
    ) then
      raise exception 'SUBMISSION_FILE_PATH_INVALID' using errcode = '22023';
    end if;
  end if;

  if coalesce(p_sync_reviews, false) then
    select coalesce(array_agg(distinct station_id order by station_id), '{}'::uuid[])
      into v_station_ids
    from unnest(coalesce(p_station_ids, '{}'::uuid[])) station_id;

    if cardinality(v_station_ids) > 20
      or (
        select count(*)
        from public.stations station
        where station.id = any(v_station_ids)
          and station.is_active = true
      ) <> cardinality(v_station_ids)
    then
      raise exception 'SUBMISSION_STATIONS_INVALID' using errcode = '22023';
    end if;

    delete from public.station_reviews review
    where review.submission_id = p_submission_id
      and review.status = 'NOT_SENT'
      and not (review.station_id = any(v_station_ids));

    insert into public.station_reviews (submission_id, station_id, status)
    select p_submission_id, station_id, 'NOT_SENT'
    from unnest(v_station_ids) station_id
    on conflict do nothing;
  end if;

  update public.submissions submission
  set status = p_final_status,
      payment_status = p_final_payment_status,
      save_lease_token = null,
      save_lease_expires_at = null
  where submission.id = p_submission_id
    and submission.save_lease_token = p_lease_token;

  if not found then
    raise exception 'SUBMISSION_SAVE_FINALIZE_FAILED' using errcode = '40001';
  end if;

  return query
  select p_submission_id, p_final_status, p_final_payment_status;
end;
$$;

revoke all on function public.commit_submission_save(
  uuid, uuid, timestamptz, boolean, jsonb, boolean, text, jsonb,
  boolean, uuid[], public.submission_status, public.payment_status
) from public, anon, authenticated;
grant execute on function public.commit_submission_save(
  uuid, uuid, timestamptz, boolean, jsonb, boolean, text, jsonb,
  boolean, uuid[], public.submission_status, public.payment_status
) to service_role;
