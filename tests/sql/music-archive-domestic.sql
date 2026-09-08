begin;
do $$
declare first_wait integer; second_wait integer; third_wait integer; failed boolean=false;
begin
  first_wait=public.reserve_music_archive_provider_slot('apple');
  second_wait=public.reserve_music_archive_provider_slot('apple');
  third_wait=public.reserve_music_archive_provider_slot('apple');
  if first_wait<>0 or second_wait not between 3000 and 3100 or third_wait<>-1 then raise exception 'Apple global 20/min limit is not enforced: %, %, %',first_wait,second_wait,third_wait; end if;
  begin perform public.reserve_music_archive_provider_slot('melon'); exception when others then failed=true; end;
  if not failed then raise exception 'Unimplemented provider can reserve calls'; end if;
  if has_function_privilege('authenticated','public.reserve_music_archive_provider_slot(text)','EXECUTE') then raise exception 'Members can bypass API throttle'; end if;
  insert into public.music_archive_sources(provider,external_id,kind,payload) values('apple','123','release','{}');
  insert into public.music_archive_sources(provider,external_id,kind,payload) values('musicbrainz','123','release','{}');
  if (select count(*) from public.music_archive_sources where external_id='123')<>2 then raise exception 'Provider IDs conflated'; end if;
  insert into public.music_archive_artist_index(provider,external_id,normalized_name,normalized_alias,initials,payload) values('apple','123','빈티지코드','vintagechord','ㅂㅌㅈㅋㄷ','{"name":"빈티지코드"}');
  if (select count(*) from public.music_archive_artist_index where initials like 'ㅂㅌ%')<>1 then raise exception 'Korean initial index not searchable'; end if;
  if has_table_privilege('authenticated','public.music_archive_artist_index','INSERT') or has_table_privilege('authenticated','public.music_archive_search_cache','SELECT') then raise exception 'Member can poison catalog cache'; end if;
  if not (select relrowsecurity from pg_class where oid='public.music_archive_artist_index'::regclass) then raise exception 'Catalog index RLS disabled'; end if;
  raise notice 'Domestic catalog: provider separation, rate limits, Korean initials, cache access PASS';
end $$;
rollback;
