-- =====================================================================
-- 學生導覽「發布到網路」：Google 登入的學生把自己的 360 導覽發布成公開網址
--
-- - vr360_published：每列是一個已發布的導覽（場景、熱點以 jsonb 存）。任何人都能讀（拿到連結就能看），
--   只有作者本人能新增、更新、刪除。
-- - Storage bucket vr360-media：全景圖、縮圖、熱點圖片。公開讀取；登入者只能寫自己的資料夾 <user_id>/...
-- =====================================================================

create table if not exists public.vr360_published (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{8,24}$'),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  author text not null default '' check (char_length(author) <= 60),
  type text not null check (type in ('travel', 'art')),
  -- { project: Project, media: { blobKey: storagePath } }
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 400000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vr360_published_owner_idx on public.vr360_published (owner_id, updated_at desc);

alter table public.vr360_published enable row level security;

-- 作者欄位不能被改成別人
create or replace function public.vr360_published_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id cannot change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists vr360_published_guard on public.vr360_published;
create trigger vr360_published_guard before insert or update on public.vr360_published
  for each row execute function public.vr360_published_guard();

-- 每位使用者最多 50 個已發布導覽，避免濫用
create or replace function public.vr360_published_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.vr360_published where owner_id = new.owner_id) >= 50 then
    raise exception 'quota exceeded' using hint = 'quota';
  end if;
  return new;
end;
$$;
drop trigger if exists vr360_published_quota on public.vr360_published;
create trigger vr360_published_quota before insert on public.vr360_published
  for each row execute function public.vr360_published_quota();

drop policy if exists "anyone reads published tours" on public.vr360_published;
create policy "anyone reads published tours" on public.vr360_published
  for select to anon, authenticated using (true);

drop policy if exists "owner inserts" on public.vr360_published;
create policy "owner inserts" on public.vr360_published
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "owner updates" on public.vr360_published;
create policy "owner updates" on public.vr360_published
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "owner deletes" on public.vr360_published;
create policy "owner deletes" on public.vr360_published
  for delete to authenticated using (owner_id = (select auth.uid()));

grant select on public.vr360_published to anon, authenticated;
grant insert, update, delete on public.vr360_published to authenticated;

-- ---------- Storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vr360-media', 'vr360-media', true, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "vr360 users upload own folder" on storage.objects;
create policy "vr360 users upload own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'vr360-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "vr360 users read own files" on storage.objects;
create policy "vr360 users read own files" on storage.objects
  for select to authenticated using (
    bucket_id = 'vr360-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "vr360 users delete own files" on storage.objects;
create policy "vr360 users delete own files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'vr360-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
