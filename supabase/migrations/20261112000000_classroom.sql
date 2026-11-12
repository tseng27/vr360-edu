-- =====================================================================
-- 208 沉浸式探索教室：資料表、RLS、伺服器端函式、Realtime 授權、Storage
-- 適用：Supabase（Postgres 15+）。所有寫入都經過 SECURITY DEFINER 函式，
-- 前端只拿得到 publishable key，不能直接改房間狀態或在頻道上廣播控制事件。
-- =====================================================================

-- ---------- 教師名單（由管理者手動加入，註冊帳號不等於教師） ----------
create table if not exists public.classroom_teachers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  created_at timestamptz not null default now()
);

-- ---------- 導覽（場景清單以 jsonb 儲存，進資料庫前由函式驗證） ----------
create table if not exists public.classroom_tours (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  scenes jsonb not null check (jsonb_typeof(scenes) = 'array' and jsonb_array_length(scenes) between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 房間 ----------
create table if not exists public.classroom_rooms (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.classroom_tours (id) on delete cascade,
  teacher_user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  active_scene_id text not null,
  mode text not null default 'follow' check (mode in ('follow', 'explore')),
  sequence_number bigint not null default 0,
  status text not null default 'open' check (status in ('open', 'ended')),
  look_here jsonb,
  card jsonb,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists classroom_rooms_teacher_idx on public.classroom_rooms (teacher_user_id, status);

-- 加入代碼只存雜湊，而且放在沒有任何 policy 的獨立表：學生、老師都無法用 API 讀到
create table if not exists public.classroom_room_codes (
  room_id uuid primary key references public.classroom_rooms (id) on delete cascade,
  code_hash text not null unique
);

-- ---------- 成員（匿名學生只存暱稱，不存姓名 / 學號 / email） ----------
create table if not exists public.classroom_memberships (
  room_id uuid not null references public.classroom_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('teacher', 'student')),
  display_name text not null check (char_length(display_name) between 1 and 20),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists classroom_memberships_user_idx on public.classroom_memberships (user_id);

-- ---------- 教師操作紀錄（同時是事件序號的唯一來源） ----------
create table if not exists public.classroom_teacher_actions (
  id bigserial primary key,
  room_id uuid not null references public.classroom_rooms (id) on delete cascade,
  sequence_number bigint not null,
  type text not null check (type in ('SCENE_CHANGE', 'LOOK_HERE', 'MODE_CHANGE', 'SHOW_CARD', 'SESSION_END')),
  scene_id text,
  yaw double precision,
  pitch double precision,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (room_id, sequence_number)
);

-- ---------- 節流紀錄 ----------
create table if not exists public.classroom_rate_events (
  user_id uuid not null,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists classroom_rate_events_idx on public.classroom_rate_events (user_id, kind, at);

-- =====================================================================
-- RLS：預設全部拒絕，只開放「讀」；所有「寫」都走下面的函式
-- =====================================================================
alter table public.classroom_teachers enable row level security;
alter table public.classroom_tours enable row level security;
alter table public.classroom_rooms enable row level security;
alter table public.classroom_room_codes enable row level security;
alter table public.classroom_memberships enable row level security;
alter table public.classroom_teacher_actions enable row level security;
alter table public.classroom_rate_events enable row level security;

create or replace function public.classroom_is_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classroom_memberships m
    where m.room_id = p_room_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.classroom_is_teacher()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classroom_teachers t where t.user_id = (select auth.uid()));
$$;

drop policy if exists "teachers read self" on public.classroom_teachers;
create policy "teachers read self" on public.classroom_teachers
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "tour owner reads" on public.classroom_tours;
create policy "tour owner reads" on public.classroom_tours
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "room members read" on public.classroom_rooms;
create policy "room members read" on public.classroom_rooms
  for select to authenticated using (public.classroom_is_member(id));

drop policy if exists "member reads own row, teacher reads roster" on public.classroom_memberships;
create policy "member reads own row, teacher reads roster" on public.classroom_memberships
  for select to authenticated using (
    user_id = (select auth.uid())
    or exists (select 1 from public.classroom_rooms r where r.id = room_id and r.teacher_user_id = (select auth.uid()))
  );

drop policy if exists "teacher reads actions" on public.classroom_teacher_actions;
create policy "teacher reads actions" on public.classroom_teacher_actions
  for select to authenticated using (
    exists (select 1 from public.classroom_rooms r where r.id = room_id and r.teacher_user_id = (select auth.uid()))
  );
-- classroom_room_codes、classroom_rate_events：刻意不建立任何 policy（API 完全讀不到）

revoke insert, update, delete on
  public.classroom_teachers, public.classroom_tours, public.classroom_rooms, public.classroom_room_codes,
  public.classroom_memberships, public.classroom_teacher_actions, public.classroom_rate_events
from anon, authenticated;
revoke all on public.classroom_room_codes, public.classroom_rate_events from anon, authenticated;

-- =====================================================================
-- 內部工具
-- =====================================================================
create or replace function public.classroom_hash_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(upper(p_code), 'UTF8')), 'hex');
$$;

-- 每位使用者在時間窗內最多 p_max 次，超過就丟錯
create or replace function public.classroom_rate_limit(p_kind text, p_max int, p_window interval)
returns void language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.classroom_rate_events where at < now() - interval '1 hour';
  select count(*) into n from public.classroom_rate_events
    where user_id = auth.uid() and kind = p_kind and at > now() - p_window;
  if n >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'rate-limited';
  end if;
  insert into public.classroom_rate_events (user_id, kind) values (auth.uid(), p_kind);
end;
$$;

-- 驗證場景 jsonb：欄位、長度、圖片網址白名單（本站 /classroom/… 或本專案 Storage 的公開路徑）
create or replace function public.classroom_validate_scenes(p_scenes jsonb, p_storage_prefix text)
returns void language plpgsql immutable set search_path = '' as $$
declare s jsonb; ids text[] := '{}'; url text;
begin
  if jsonb_typeof(p_scenes) <> 'array' or jsonb_array_length(p_scenes) not between 1 and 30 then
    raise exception 'invalid_scenes' using hint = 'invalid-input';
  end if;
  -- 前端傳入的 Storage 前綴本身也要檢查，否則等於讓前端自訂白名單
  if p_storage_prefix is not null
     and p_storage_prefix !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/classroom-panoramas/$' then
    raise exception 'storage_prefix_not_allowed' using hint = 'invalid-input';
  end if;
  for s in select * from jsonb_array_elements(p_scenes) loop
    if (s->>'sceneId') is null or (s->>'sceneId') !~ '^[A-Za-z0-9_-]{1,64}$' then
      raise exception 'invalid_scene_id' using hint = 'invalid-input';
    end if;
    if (s->>'sceneId') = any(ids) then raise exception 'duplicate_scene_id' using hint = 'invalid-input'; end if;
    ids := ids || (s->>'sceneId');
    if char_length(coalesce(s->>'name', '')) not between 1 and 40 then
      raise exception 'invalid_scene_name' using hint = 'invalid-input';
    end if;
    if char_length(coalesce(s->>'intro', '')) > 500 then raise exception 'intro_too_long' using hint = 'invalid-input'; end if;
    url := coalesce(s->>'panoramaUrl', '');
    if not (
      (url ~ '^/classroom/[A-Za-z0-9/_.-]+\.(jpe?g|png|webp)$' and position('..' in url) = 0)
      or (p_storage_prefix is not null and starts_with(url, p_storage_prefix) and position('..' in url) = 0)
    ) then
      raise exception 'panorama_url_not_allowed' using hint = 'invalid-input';
    end if;
  end loop;
end;
$$;

create or replace function public.classroom_room_json(r public.classroom_rooms)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'roomId', r.id, 'tourId', replace(r.tour_id::text, '-', ''), 'activeSceneId', r.active_scene_id,
    'mode', r.mode, 'sequenceNumber', r.sequence_number, 'status',
    case when r.status = 'open' and r.expires_at < now() then 'ended' else r.status end,
    'lookHere', r.look_here, 'card', r.card, 'expiresAt', to_char(r.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
$$;

create or replace function public.classroom_snapshot_json(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'state', public.classroom_room_json(r),
    'tour', jsonb_build_object('tourId', replace(t.id::text, '-', ''), 'title', t.title, 'scenes', t.scenes)
  )
  from public.classroom_rooms r join public.classroom_tours t on t.id = r.tour_id
  where r.id = p_room_id;
$$;

-- =====================================================================
-- 對外 RPC
-- =====================================================================

-- 老師建立導覽 + 房間；回傳明碼加入代碼（只有這一次看得到明碼）
create or replace function public.classroom_create_room(
  p_title text, p_scenes jsonb, p_ttl_minutes int default 120, p_storage_prefix text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_tour uuid; v_room uuid; v_code text; v_alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea; i int; tries int := 0;
begin
  if v_uid is null or not public.classroom_is_teacher() then
    raise exception 'not_teacher' using hint = 'not-teacher';
  end if;
  perform public.classroom_rate_limit('create_room', 20, interval '1 hour');
  if char_length(coalesce(p_title, '')) not between 1 and 60 then raise exception 'invalid_title' using hint = 'invalid-input'; end if;
  if p_ttl_minutes not between 10 and 480 then raise exception 'invalid_ttl' using hint = 'invalid-input'; end if;
  perform public.classroom_validate_scenes(p_scenes, p_storage_prefix);

  insert into public.classroom_tours (owner_id, title, scenes) values (v_uid, p_title, p_scenes) returning id into v_tour;
  insert into public.classroom_rooms (tour_id, teacher_user_id, expires_at, active_scene_id)
    values (v_tour, v_uid, now() + make_interval(mins => p_ttl_minutes), p_scenes->0->>'sceneId')
    returning id into v_room;

  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % length(v_alpha)) + 1, 1);
    end loop;
    begin
      insert into public.classroom_room_codes (room_id, code_hash) values (v_room, public.classroom_hash_code(v_code));
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 10 then raise; end if;
    end;
  end loop;

  insert into public.classroom_memberships (room_id, user_id, role, display_name)
    values (v_room, v_uid, 'teacher', '老師');
  return public.classroom_snapshot_json(v_room) || jsonb_build_object('joinCode', v_code);
end;
$$;

-- 學生（可匿名登入）用代碼加入
-- 注意：失敗時「回傳 {error}」而不是 raise，這樣交易會 commit，節流紀錄才會留下
-- （raise 會把 rate_events 的 insert 一起回滾，猜代碼就不受限制了）
create or replace function public.classroom_join_room(p_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  v_name text := btrim(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]<>]', '', 'g'));
  v_room public.classroom_rooms;
  v_count int;
begin
  if v_uid is null then return jsonb_build_object('error', 'not-member'); end if;
  begin
    perform public.classroom_rate_limit('join', 15, interval '10 minutes');
  exception when others then
    return jsonb_build_object('error', 'rate-limited');
  end;
  if v_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6,8}$' then return jsonb_build_object('error', 'invalid-code'); end if;
  if char_length(v_name) not between 1 and 20 then return jsonb_build_object('error', 'invalid-input'); end if;

  select r.* into v_room from public.classroom_room_codes c join public.classroom_rooms r on r.id = c.room_id
    where c.code_hash = public.classroom_hash_code(v_code);
  if not found then return jsonb_build_object('error', 'invalid-code'); end if;
  if v_room.status <> 'open' then return jsonb_build_object('error', 'ended'); end if;
  if v_room.expires_at < now() then return jsonb_build_object('error', 'expired'); end if;

  select count(*) into v_count from public.classroom_memberships where room_id = v_room.id;
  if v_count >= 61 and not public.classroom_is_member(v_room.id) then return jsonb_build_object('error', 'full'); end if;

  insert into public.classroom_memberships (room_id, user_id, role, display_name)
    values (v_room.id, v_uid, 'student', v_name)
    on conflict (room_id, user_id) do update set display_name = excluded.display_name
      where public.classroom_memberships.role = 'student';
  return public.classroom_snapshot_json(v_room.id);
end;
$$;

-- 讀取最新狀態（加入、重新整理、斷線重連時先呼叫）
create or replace function public.classroom_get_snapshot(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.classroom_is_member(p_room_id) then raise exception 'not_member' using hint = 'not-member'; end if;
  return public.classroom_snapshot_json(p_room_id);
end;
$$;

-- 老師操作：驗證身分 → 鎖列 → 序號 +1 → 更新狀態 → 寫紀錄 → 由資料庫廣播到私有頻道
create or replace function public.classroom_teacher_action(p_room_id uuid, p_action jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.classroom_rooms;
  v_scenes jsonb;
  v_type text := p_action->>'type';
  v_scene text; v_yaw double precision; v_pitch double precision;
  v_target jsonb; v_card jsonb;
  v_event jsonb;
begin
  select * into v_room from public.classroom_rooms where id = p_room_id for update;
  if not found or v_room.teacher_user_id is distinct from auth.uid() then
    raise exception 'not_teacher' using hint = 'not-teacher';
  end if;
  if v_room.status <> 'open' or v_room.expires_at < now() then raise exception 'ended' using hint = 'ended'; end if;
  perform public.classroom_rate_limit('action', 120, interval '1 minute');
  select scenes into v_scenes from public.classroom_tours where id = v_room.tour_id;

  v_room.sequence_number := v_room.sequence_number + 1;
  if v_type = 'SCENE_CHANGE' then
    v_scene := p_action->>'sceneId';
    if not exists (select 1 from jsonb_array_elements(v_scenes) e where e->>'sceneId' = v_scene) then
      raise exception 'unknown_scene' using hint = 'invalid-input';
    end if;
    v_room.active_scene_id := v_scene; v_room.look_here := null; v_room.card := null;
  elsif v_type = 'LOOK_HERE' then
    v_target := p_action->'target';
    if v_target is null or jsonb_typeof(v_target) = 'null' then
      v_room.look_here := null;
    else
      v_yaw := (v_target->>'yaw')::double precision; v_pitch := (v_target->>'pitch')::double precision;
      if v_yaw is null or v_pitch is null or v_yaw not between -180 and 180 or v_pitch not between -90 and 90 then
        raise exception 'invalid_target' using hint = 'invalid-input';
      end if;
      v_room.look_here := jsonb_build_object('yaw', v_yaw, 'pitch', v_pitch);
    end if;
  elsif v_type = 'MODE_CHANGE' then
    if (p_action->>'mode') not in ('follow', 'explore') then raise exception 'invalid_mode' using hint = 'invalid-input'; end if;
    v_room.mode := p_action->>'mode';
  elsif v_type = 'SHOW_CARD' then
    v_card := p_action->'card';
    if jsonb_typeof(v_card->'visible') <> 'boolean'
       or char_length(coalesce(v_card->>'title', '')) > 60 or char_length(coalesce(v_card->>'text', '')) > 500 then
      raise exception 'invalid_card' using hint = 'invalid-input';
    end if;
    v_room.card := jsonb_build_object('visible', (v_card->>'visible')::boolean,
      'title', coalesce(v_card->>'title', ''), 'text', coalesce(v_card->>'text', ''));
  elsif v_type = 'SESSION_END' then
    v_room.status := 'ended'; v_room.ended_at := now(); v_room.look_here := null; v_room.card := null;
  else
    raise exception 'invalid_action' using hint = 'invalid-input';
  end if;

  update public.classroom_rooms set
    sequence_number = v_room.sequence_number, active_scene_id = v_room.active_scene_id, mode = v_room.mode,
    status = v_room.status, look_here = v_room.look_here, card = v_room.card, ended_at = v_room.ended_at
  where id = p_room_id;

  insert into public.classroom_teacher_actions (room_id, sequence_number, type, scene_id, yaw, pitch, payload)
    values (p_room_id, v_room.sequence_number, v_type, v_scene, v_yaw, v_pitch, p_action);

  if v_type = 'SESSION_END' then delete from public.classroom_room_codes where room_id = p_room_id; end if;

  v_event := jsonb_build_object('v', 1, 'roomId', p_room_id, 'sequenceNumber', v_room.sequence_number,
      'sentAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'senderRole', 'teacher', 'type', v_type)
    || case v_type
         when 'SCENE_CHANGE' then jsonb_build_object('sceneId', v_scene)
         when 'LOOK_HERE' then jsonb_build_object('target', v_room.look_here)
         when 'MODE_CHANGE' then jsonb_build_object('mode', v_room.mode)
         when 'SHOW_CARD' then jsonb_build_object('card', v_room.card)
         else '{}'::jsonb end;
  -- 私有頻道：只有通過 realtime.messages RLS 的成員收得到
  perform realtime.send(v_event, 'classroom', 'room:' || p_room_id::text, true);

  return public.classroom_room_json(v_room);
end;
$$;

-- 老師重新整理後取回房間（不會再顯示明碼代碼，前端自己保存在 sessionStorage）
create or replace function public.classroom_teacher_snapshot(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.classroom_rooms where id = p_room_id and teacher_user_id = auth.uid()) then
    raise exception 'not_teacher' using hint = 'not-teacher';
  end if;
  return public.classroom_snapshot_json(p_room_id);
end;
$$;

-- 資料清理：過期自動結束；結束 24 小時後刪掉匿名成員與操作紀錄；30 天後刪整個房間與導覽
create or replace function public.classroom_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.classroom_rooms set status = 'ended', ended_at = coalesce(ended_at, now())
    where status = 'open' and expires_at < now();
  delete from public.classroom_room_codes c using public.classroom_rooms r where r.id = c.room_id and r.status = 'ended';
  delete from public.classroom_memberships m using public.classroom_rooms r
    where r.id = m.room_id and r.status = 'ended' and r.ended_at < now() - interval '24 hours';
  delete from public.classroom_teacher_actions a using public.classroom_rooms r
    where r.id = a.room_id and r.status = 'ended' and r.ended_at < now() - interval '24 hours';
  delete from public.classroom_tours t
    where not exists (select 1 from public.classroom_rooms r where r.tour_id = t.id and (r.status = 'open' or r.ended_at > now() - interval '30 days'));
end;
$$;
-- 需要 pg_cron（Supabase 後台 Integrations → Cron 啟用）：
-- select cron.schedule('classroom-cleanup', '17 * * * *', $$select public.classroom_cleanup()$$);

-- 只開放必要的 RPC 給登入使用者（含匿名登入）；內部函式不對外
-- （只動本模組的函式，不影響專案裡其他函式的權限）
revoke execute on function
  public.classroom_rate_limit(text, int, interval), public.classroom_validate_scenes(jsonb, text),
  public.classroom_snapshot_json(uuid), public.classroom_cleanup(), public.classroom_room_json(public.classroom_rooms),
  public.classroom_hash_code(text),
  public.classroom_create_room(text, jsonb, int, text), public.classroom_join_room(text, text),
  public.classroom_get_snapshot(uuid), public.classroom_teacher_action(uuid, jsonb),
  public.classroom_teacher_snapshot(uuid), public.classroom_is_member(uuid), public.classroom_is_teacher()
from public, anon, authenticated;
grant execute on function
  public.classroom_create_room(text, jsonb, int, text), public.classroom_join_room(text, text),
  public.classroom_get_snapshot(uuid), public.classroom_teacher_action(uuid, jsonb),
  public.classroom_teacher_snapshot(uuid), public.classroom_is_member(uuid), public.classroom_is_teacher()
to authenticated;

-- =====================================================================
-- Realtime 授權（私有頻道 room:<uuid>）
-- - 成員可以「收」廣播與 presence
-- - 成員只能「送」presence；broadcast 一律由 classroom_teacher_action 在資料庫端送出，
--   所以學生（甚至老師的前端）都無法直接在頻道上偽造 SCENE_CHANGE
-- =====================================================================
drop policy if exists "classroom members receive" on realtime.messages;
create policy "classroom members receive" on realtime.messages
  for select to authenticated using (
    realtime.topic() like 'room:%'
    and exists (
      select 1 from public.classroom_memberships m
      where m.user_id = (select auth.uid()) and 'room:' || m.room_id::text = realtime.topic()
    )
  );

drop policy if exists "classroom members presence" on realtime.messages;
create policy "classroom members presence" on realtime.messages
  for insert to authenticated with check (
    realtime.messages.extension = 'presence'
    and realtime.topic() like 'room:%'
    and exists (
      select 1 from public.classroom_memberships m
      where m.user_id = (select auth.uid()) and 'room:' || m.room_id::text = realtime.topic()
    )
  );

-- =====================================================================
-- Storage：教師上傳的全景圖（公開讀取，只有教師能寫入自己的資料夾）
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('classroom-panoramas', 'classroom-panoramas', true, 26214400, array['image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "classroom teachers upload own folder" on storage.objects;
create policy "classroom teachers upload own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'classroom-panoramas'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.classroom_is_teacher()
  );

drop policy if exists "classroom teachers delete own files" on storage.objects;
create policy "classroom teachers delete own files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'classroom-panoramas' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
