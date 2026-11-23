-- 「發布到網路」權限測試：npm run test:db
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), -- 學生甲
  ('00000000-0000-0000-0000-0000000000c2')  -- 學生乙
on conflict do nothing;

create or replace function pg_temp.expect_fail(p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok: rejected (%): %', sqlstate, left(p_sql, 70);
    return;
  end;
  raise exception 'expected failure but succeeded: %', p_sql;
end;
$$;

-- 學生甲發布
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
insert into public.vr360_published (id, title, type, data) values ('tourAAAAaaaa', '我的導覽', 'travel', '{"project":{},"media":{}}');
update public.vr360_published set title = '改名' where id = 'tourAAAAaaaa';
insert into storage.objects (bucket_id, name) values ('vr360-media', '00000000-0000-0000-0000-0000000000c1/tourAAAAaaaa/img.jpg');
select pg_temp.expect_fail($$insert into storage.objects (bucket_id, name) values ('vr360-media', '00000000-0000-0000-0000-0000000000c2/x/img.jpg')$$);
select pg_temp.expect_fail($$insert into public.vr360_published (id, title, type, data, owner_id) values ('tourFAKEfake', 'x', 'travel', '{}', '00000000-0000-0000-0000-0000000000c2')$$);
select pg_temp.expect_fail($$insert into public.vr360_published (id, title, type, data) values ('bad id!', 'x', 'travel', '{}')$$);

-- 學生乙不能改、不能刪甲的導覽（RLS 讓它影響 0 列）
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
do $$ declare n int; begin
  update public.vr360_published set title = 'hacked' where id = 'tourAAAAaaaa';
  get diagnostics n = row_count; if n <> 0 then raise exception 'other user updated tour'; end if;
  delete from public.vr360_published where id = 'tourAAAAaaaa';
  get diagnostics n = row_count; if n <> 0 then raise exception 'other user deleted tour'; end if;
  delete from storage.objects where bucket_id = 'vr360-media' and name like '00000000-0000-0000-0000-0000000000c1/%';
  get diagnostics n = row_count; if n <> 0 then raise exception 'other user deleted files'; end if;
  raise notice 'ok: 其他學生不能修改 / 刪除別人的導覽與圖片';
end $$;

-- 未登入（anon）可以讀，但不能寫
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if (select title from public.vr360_published where id = 'tourAAAAaaaa') <> '改名' then raise exception 'anon cannot read'; end if;
  raise notice 'ok: 未登入的人拿到連結可以觀看';
end $$;
select pg_temp.expect_fail($$insert into public.vr360_published (id, title, type, data) values ('tourANONanon', 'x', 'travel', '{}')$$);

-- 作者本人可以取消發布
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
delete from public.vr360_published where id = 'tourAAAAaaaa';
do $$ begin
  if exists (select 1 from public.vr360_published where id = 'tourAAAAaaaa') then raise exception 'owner delete failed'; end if;
  raise notice 'ok: 作者可以取消發布';
end $$;
reset role;
\echo published_test: all passed
