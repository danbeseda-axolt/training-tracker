-- Applied to Supabase project widuygqbkpyerqhgbvos on 2026-10-26 (migration liftless_import_take).
-- 'I already have a plan': reading a pasted, photographed or linked plan costs one model call.
-- Any signed-in person may import (no coach_access needed); 5 a day each, and the import
-- calls count toward the same 200-a-day total as the coach.

create table public.import_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.import_usage enable row level security;
create policy "own import usage: read" on public.import_usage for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.import_usage from anon;
revoke insert, update, delete, truncate, references, trigger on public.import_usage from authenticated;

create or replace function public.import_take() returns table (ok boolean, reason text, mine int)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  d date := (now() at time zone 'Europe/Prague')::date;
  m int; e int;
begin
  if me is null then raise exception 'signed out' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtext('ledger.chat_take'));
  select coalesce((select u.n from public.import_usage u where u.user_id = me and u.day = d), 0) into m;
  select coalesce((select sum(u.n) from public.chat_usage u where u.day = d), 0)::int
       + coalesce((select sum(u.n) from public.import_usage u where u.day = d), 0)::int into e;
  if m >= 5 then return query select false, 'limit_user'::text, m; return; end if;
  if e >= 200 then return query select false, 'limit_all'::text, m; return; end if;
  insert into public.import_usage (user_id, day, n) values (me, d, 1)
    on conflict (user_id, day) do update set n = public.import_usage.n + 1;
  return query select true, null::text, m + 1;
end $$;
revoke execute on function public.import_take() from public, anon;
grant execute on function public.import_take() to authenticated;
