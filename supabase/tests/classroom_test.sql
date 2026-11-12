-- 本機權限測試：npm run test:db（需要本機 PostgreSQL 15+，會先載入 supabase_stubs.sql 與 migration）
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

insert into auth.users (id, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000a1', false), -- 老師
  ('00000000-0000-0000-0000-0000000000a2', false), -- 一般註冊帳號（不是老師）
  ('00000000-0000-0000-0000-0000000000b1', true),  -- 匿名學生 1
  ('00000000-0000-0000-0000-0000000000b2', true),  -- 匿名學生 2
  ('00000000-0000-0000-0000-0000000000b3', true);  -- 晚到的學生 3
insert into public.classroom_teachers (user_id, display_name) values ('00000000-0000-0000-0000-0000000000a1', '測試老師');

create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated;

create or replace function pg_temp.expect_error(p_sql text, p_hint text) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if p_hint is not null and coalesce(v_hint, '') <> p_hint and sqlstate <> '42501' then
      raise exception 'expected hint %, got % (%)', p_hint, v_hint, sqlerrm;
    end if;
    raise notice 'ok: rejected (%): %', coalesce(nullif(v_hint, ''), sqlstate), left(p_sql, 70);
    return;
  end;
  raise exception 'expected error but succeeded: %', p_sql;
end $$;

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
end $$;

set role authenticated;

\echo '== 1. 非教師不能建立房間'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_error($q$select public.classroom_create_room('x', '[{"sceneId":"a","name":"A","panoramaUrl":"/classroom/scenes/a.jpg"}]')$q$, 'not-teacher');

\echo '== 2. 老師建立房間；不允許的圖片網址被拒'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($q$select public.classroom_create_room('x', '[{"sceneId":"a","name":"A","panoramaUrl":"https://evil.example/a.jpg"}]')$q$, 'invalid-input');
select pg_temp.expect_error($q$select public.classroom_create_room('x', '[{"sceneId":"a","name":"A","panoramaUrl":"/classroom/../a.jpg"}]')$q$, 'invalid-input');
select pg_temp.expect_error($q$select public.classroom_create_room('x', '[{"sceneId":"a","name":"A","panoramaUrl":"https://evil.example/x.jpg"}]', 60, 'https://evil.example/')$q$, 'invalid-input');
insert into t_ctx
select 'created', public.classroom_create_room('示範導覽', '[
  {"sceneId":"a-field","name":"操場","panoramaUrl":"/classroom/scenes/a-field.jpg"},
  {"sceneId":"b-library","name":"圖書館","panoramaUrl":"/classroom/scenes/b-library.jpg"},
  {"sceneId":"c-studio","name":"美術教室","panoramaUrl":"/classroom/scenes/c-studio.jpg"}]'::jsonb, 60)::text;
insert into t_ctx select 'room', (v::jsonb)->'state'->>'roomId' from t_ctx where k = 'created';
insert into t_ctx select 'code', (v::jsonb)->>'joinCode' from t_ctx where k = 'created';
select 'code length = ' || length(v) from t_ctx where k = 'code';

\echo '== 3. 加入代碼雜湊表任何人都讀不到'
select pg_temp.expect_error($q$select * from public.classroom_room_codes$q$, null);
do $$ begin
  if (select count(*) from public.classroom_rooms) <> 1 then raise exception 'teacher should see own room'; end if;
end $$;

\echo '== 4. 學生用錯誤代碼 / 正確代碼加入'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select 'wrong code -> ' || (public.classroom_join_room('ZZZZZZ', '小明')->>'error');
select 'script code -> ' || (public.classroom_join_room('<script>', '小明')->>'error');
select 'blank name -> ' || (public.classroom_join_room((select v from t_ctx where k = 'code'), '   ')->>'error');
select (public.classroom_join_room(lower((select v from t_ctx where k = 'code')), '星星<b>')->'state'->>'activeSceneId') as joined_scene;
select display_name as stored_name_without_tags from public.classroom_memberships where user_id = auth.uid();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.classroom_join_room((select v from t_ctx where k = 'code'), '月亮') is not null as student2_joined;

\echo '== 5. 學生不能下教師指令、不能直接改資料表、不能在頻道上廣播'
select pg_temp.expect_error(format($q$select public.classroom_teacher_action(%L, '{"type":"SCENE_CHANGE","sceneId":"b-library"}')$q$, (select v from t_ctx where k = 'room')), 'not-teacher');
select pg_temp.expect_error(format($q$update public.classroom_rooms set active_scene_id = 'b-library' where id = %L$q$, (select v from t_ctx where k = 'room')), null);
select pg_temp.expect_error(format($q$insert into public.classroom_memberships values (%L, auth.uid(), 'teacher', 'x')$q$, (select v from t_ctx where k = 'room')), null);
select set_config('realtime.topic', 'room:' || (select v from t_ctx where k = 'room'), false);
select pg_temp.expect_error($q$insert into realtime.messages (topic, extension, payload, event, private) values (realtime.topic(), 'broadcast', '{"type":"SCENE_CHANGE","sceneId":"b-library","senderRole":"teacher"}', 'classroom', true)$q$, null);
insert into realtime.messages (topic, extension, payload, event, private) values (realtime.topic(), 'presence', '{}', 'presence', true);
\echo 'ok: student may send presence on own room'
do $$ begin
  if (select count(*) from realtime.messages) < 1 then raise exception 'member should read own room topic'; end if;
end $$;
\echo 'ok: student can receive own room topic'

\echo '== 6. 非成員讀不到房間、收不到頻道'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_error(format($q$select public.classroom_get_snapshot(%L)$q$, (select v from t_ctx where k = 'room')), 'not-member');
do $$ begin
  if (select count(*) from public.classroom_rooms) <> 0 then raise exception 'outsider sees room'; end if;
  if (select count(*) from realtime.messages) <> 0 then raise exception 'outsider reads channel'; end if;
end $$;
\echo 'ok: outsider sees nothing'
select pg_temp.expect_error($q$insert into realtime.messages (topic, extension, payload, event, private) values (realtime.topic(), 'presence', '{}', 'presence', true)$q$, null);

\echo '== 7. 老師切換場景：序號遞增、資料庫廣播到私有頻道'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.classroom_teacher_action((select v from t_ctx where k = 'room')::uuid, '{"type":"SCENE_CHANGE","sceneId":"b-library"}')->>'sequenceNumber' as seq_after_scene_b;
select public.classroom_teacher_action((select v from t_ctx where k = 'room')::uuid, '{"type":"LOOK_HERE","target":{"yaw":120,"pitch":10}}')->'lookHere' as look_here;
select pg_temp.expect_error(format($q$select public.classroom_teacher_action(%L, '{"type":"LOOK_HERE","target":{"yaw":999,"pitch":0}}')$q$, (select v from t_ctx where k = 'room')), 'invalid-input');
select pg_temp.expect_error(format($q$select public.classroom_teacher_action(%L, '{"type":"SCENE_CHANGE","sceneId":"nope"}')$q$, (select v from t_ctx where k = 'room')), 'invalid-input');
select public.classroom_teacher_action((select v from t_ctx where k = 'room')::uuid, '{"type":"MODE_CHANGE","mode":"explore"}')->>'mode' as mode;
reset role;
select topic like 'room:%' as topic_ok, private, payload->>'type' as type, payload->>'sequenceNumber' as seq, payload->>'senderRole' as sender
  from realtime.sent_log order by (payload->>'sequenceNumber')::int;
set role authenticated;

\echo '== 8. 晚到的學生讀到的是最新狀態（場景 B、自由探索）'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select s->'state'->>'activeSceneId' as late_scene, s->'state'->>'mode' as late_mode, s->'state'->>'sequenceNumber' as late_seq
  from (select public.classroom_join_room((select v from t_ctx where k = 'code'), '晚到') as s) x;

\echo '== 9. 學生重新整理：用 get_snapshot 讀最新狀態'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.classroom_get_snapshot((select v from t_ctx where k = 'room')::uuid)->'state'->>'activeSceneId' as refreshed_scene;

\echo '== 10. 加入節流（同一帳號 10 分鐘最多 15 次）'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
-- psql 自動 commit：每行都是獨立交易（和 PostgREST 一樣），失敗的嘗試也必須留下紀錄
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_1 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_2 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_3 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_4 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_5 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_6 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_7 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_8 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_9 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_10 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_11 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_12 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_13 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_14 \gset
select public.classroom_join_room('ZZZZZZ', 'x')->>'error' as attempt_15 \gset
select 'attempts 1-14: ' || :'attempt_14' || ', attempt 15: ' || :'attempt_15';

\echo '== 11. 結束課堂：代碼失效、不能再加入或操作'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.classroom_teacher_action((select v from t_ctx where k = 'room')::uuid, '{"type":"SESSION_END"}')->>'status' as status;
select pg_temp.expect_error(format($q$select public.classroom_teacher_action(%L, '{"type":"MODE_CHANGE","mode":"follow"}')$q$, (select v from t_ctx where k = 'room')), 'ended');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select 'join after end -> ' || (public.classroom_join_room((select v from t_ctx where k = 'code'), '再一次')->>'error');

\echo '== 12. 清理：結束超過 24 小時後刪除匿名成員資料'
reset role;
update public.classroom_rooms set ended_at = now() - interval '25 hours';
select public.classroom_cleanup();
select count(*) as memberships_left from public.classroom_memberships;
select count(*) as actions_left from public.classroom_teacher_actions;

\echo '== 13. anon（未登入）角色不能呼叫任何教室 RPC'
set role anon;
select pg_temp.expect_error($q$select public.classroom_join_room('ABCDEF', 'x')$q$, null);
select pg_temp.expect_error($q$select public.classroom_teacher_action(gen_random_uuid(), '{"type":"SESSION_END"}')$q$, null);
reset role;

\echo 'ALL DATABASE TESTS PASSED'
