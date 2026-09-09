begin;
insert into auth.users(id) values ('aaaaaaaa-0011-4000-8000-000000000001');
insert into public.profiles(user_id,role,name,company) values ('aaaaaaaa-0011-4000-8000-000000000001','user','앨범 관리자 테스트 회원','테스트 소속');
select public.create_music_archive_library('aaaaaaaa-0011-4000-8000-000000000002','aaaaaaaa-0011-4000-8000-000000000001','{"schemaVersion":1,"artist":{"id":"artist","name":"누락앨범 아티스트","links":[]},"releases":[],"tracks":[],"recordings":[],"works":[],"tasks":[],"reviewLinks":[],"connections":[],"affiliations":[],"conflicts":[]}'::jsonb);
set local role service_role;
do $$ begin
  if not exists(select 1 from public.music_archive_admin_libraries where member_name ilike '%테스트 회원%' and member_company='테스트 소속' and artist_name='누락앨범 아티스트' and release_count=0 and track_count=0 and archived_at is null) then raise exception 'Member directory search or empty archive filter failed'; end if;
end $$;
reset role;
do $$ begin
  if has_table_privilege('authenticated','public.music_archive_admin_libraries','select') or has_table_privilege('anon','public.music_archive_admin_libraries','select') then raise exception 'Admin directory exposed to ordinary members'; end if;
end $$;
rollback;
