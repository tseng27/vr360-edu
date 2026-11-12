-- 208 沉浸式探索教室：老師的「我的導覽」（可儲存、叫回來、刪除）
-- 在 Supabase SQL Editor 貼上執行即可；可以重複執行。
-- 和上課用的 classroom_tours 分開：上課時會複製一份到房間，所以之後修改或刪除存檔都不影響已開的教室。

create table if not exists public.classroom_saved_tours (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  scenes jsonb not null check (jsonb_typeof(scenes) = 'array' and jsonb_array_length(scenes) between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists classroom_saved_tours_owner on public.classroom_saved_tours (owner_id, updated_at desc);

alter table public.classroom_saved_tours enable row level security;
drop policy if exists "saved tour owner reads" on public.classroom_saved_tours;
create policy "saved tour owner reads" on public.classroom_saved_tours
  for select to authenticated using (owner_id = (select auth.uid()) and public.classroom_is_teacher());
-- 寫入只能經過下面的函式（會驗證場景與圖片網址）
revoke insert, update, delete on public.classroom_saved_tours from anon, authenticated;
revoke all on public.classroom_saved_tours from anon;
grant select on public.classroom_saved_tours to authenticated;

-- 新增（p_id 為 null）或覆蓋自己的存檔；每位老師最多 100 份
create or replace function public.classroom_save_tour(
  p_id uuid, p_title text, p_scenes jsonb, p_storage_prefix text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_at timestamptz;
begin
  if v_uid is null or not public.classroom_is_teacher() then
    raise exception 'not_teacher' using hint = 'not-teacher';
  end if;
  perform public.classroom_rate_limit('save_tour', 60, interval '1 hour');
  if char_length(coalesce(p_title, '')) not between 1 and 60 then raise exception 'invalid_title' using hint = 'invalid-input'; end if;
  perform public.classroom_validate_scenes(p_scenes, p_storage_prefix);

  if p_id is not null then
    update public.classroom_saved_tours set title = p_title, scenes = p_scenes, updated_at = now()
      where id = p_id and owner_id = v_uid
      returning id, updated_at into v_id, v_at;
  end if;
  if v_id is null then
    if (select count(*) from public.classroom_saved_tours where owner_id = v_uid) >= 100 then
      raise exception 'too_many_tours' using hint = 'invalid-input';
    end if;
    insert into public.classroom_saved_tours (owner_id, title, scenes) values (v_uid, p_title, p_scenes)
      returning id, updated_at into v_id, v_at;
  end if;
  return jsonb_build_object('id', v_id, 'updatedAt', v_at);
end;
$$;

create or replace function public.classroom_delete_tour(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.classroom_is_teacher() then
    raise exception 'not_teacher' using hint = 'not-teacher';
  end if;
  delete from public.classroom_saved_tours where id = p_id and owner_id = auth.uid();
end;
$$;

revoke execute on function public.classroom_save_tour(uuid, text, jsonb, text), public.classroom_delete_tour(uuid)
  from public, anon, authenticated;
grant execute on function public.classroom_save_tour(uuid, text, jsonb, text), public.classroom_delete_tour(uuid)
  to authenticated;
