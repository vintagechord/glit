create role anon;
create role authenticated;
create role service_role;
create type public.station_review_status as enum ('NOT_SENT','SENT','RECEIVED','APPROVED','REJECTED','NEEDS_FIX');
create type public.submission_status as enum ('DRAFT','SUBMITTED','PRE_REVIEW','WAITING_PAYMENT','IN_PROGRESS','RESULT_READY','COMPLETED');
create table public.profiles(user_id uuid primary key,role text);
create table public.submissions(id uuid primary key,type text,status public.submission_status,result_status text,result_memo text,mv_desired_rating text,mv_selected_station_codes text[],package_id uuid,result_notified_at timestamptz,updated_at timestamptz default now(),certificate_b2_path text,certificate_original_name text,certificate_mime text,certificate_size bigint,certificate_uploaded_at timestamptz);
create table public.stations(id uuid primary key default gen_random_uuid(),code text unique,name text,is_active boolean);
create table public.package_stations(package_id uuid,station_id uuid references public.stations(id));
create table public.station_reviews(id uuid primary key default gen_random_uuid(),submission_id uuid references public.submissions(id),station_id uuid references public.stations(id),status public.station_review_status,result_note text,track_results_json jsonb,updated_at timestamptz,unique(submission_id,station_id));
create table public.album_tracks(id uuid primary key,submission_id uuid references public.submissions(id),track_no integer,broadcast_selected boolean);
create table public.submission_events(id uuid primary key default gen_random_uuid(),submission_id uuid references public.submissions(id),actor_user_id uuid,event_type text,message text);
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create trigger set_submissions_updated_at before update on public.submissions for each row execute function public.set_updated_at();
create trigger set_station_reviews_updated_at before update on public.station_reviews for each row execute function public.set_updated_at();
grant select,insert,update,delete on all tables in schema public to service_role;
insert into public.profiles values ('22222222-2222-4222-8222-222222222222','admin'),('33333333-3333-4333-8333-333333333333','user');
insert into public.submissions(id,type,status,mv_selected_station_codes,package_id) values
('11111111-1111-4111-8111-111111111111','MV_DISTRIBUTION','PRE_REVIEW','{}',null),
('44444444-4444-4444-8444-444444444444','ALBUM','IN_PROGRESS','{}','99999999-9999-4999-8999-999999999999'),
('55555555-5555-4555-8555-555555555555','MV_BROADCAST','SUBMITTED','{KBS,MBC}',null);
insert into public.stations(id,code,name,is_active) values
('66666666-6666-4666-8666-666666666666','KBS','KBS',true),
('77777777-7777-4777-8777-777777777777','MBC','MBC',true),
('88888888-8888-4888-8888-888888888888','WBS','WBS',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','MV_BROADCAST','신청 방송국',true);
insert into public.package_stations values ('99999999-9999-4999-8999-999999999999','66666666-6666-4666-8666-666666666666'),('99999999-9999-4999-8999-999999999999','88888888-8888-4888-8888-888888888888');
insert into public.album_tracks(id,submission_id,track_no,broadcast_selected) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','44444444-4444-4444-8444-444444444444',1,true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','44444444-4444-4444-8444-444444444444',2,true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','44444444-4444-4444-8444-444444444444',3,true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','44444444-4444-4444-8444-444444444444',4,false);
