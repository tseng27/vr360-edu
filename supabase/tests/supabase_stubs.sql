-- 只供本機測試：模擬 Supabase 的 auth / realtime / storage schema 最小介面。
-- 真正的 Supabase 專案已內建這些物件，請勿在正式專案執行這個檔案。
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
create schema auth;
create table auth.users (id uuid primary key, is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;

create schema realtime;
create table realtime.messages (id bigserial primary key, topic text, extension text, payload jsonb, event text, private boolean);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as
  $$ select current_setting('realtime.topic', true) $$;
create table realtime.sent_log (topic text, event text, payload jsonb, private boolean);
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language sql security definer as $$ insert into realtime.sent_log values (topic, event, payload, private) $$;
grant usage on schema realtime to anon, authenticated;
grant select, insert on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant usage on sequence storage.objects_id_seq to authenticated;

-- Supabase 預設：authenticated 對 public 的表有完整權限，由 RLS 把關
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
