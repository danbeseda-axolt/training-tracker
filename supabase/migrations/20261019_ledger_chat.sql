-- NOT APPLIED. Ledger release 2: the coach chat (spec: projects/ledger-chat-spec.md).
-- Builder applies it to widuygqbkpyerqhgbvos after review (migration name: ledger_r2_chat),
-- after running the verification script at the bottom in a rolled-back transaction.
-- Same conventions as release 1: RLS on, (select auth.uid()) in policies, nothing for anon,
-- no truncate/references/trigger for authenticated.
-- QA round 1 (2026-10-19): coach_access allow-list, chat_take() reason, created_at bound,
-- settings_merge(). Re-run the whole verification block.

-- ------------------------------------------------------------------ chat_messages
-- One row per message. Written by the coach Edge Function, which acts AS the user (the user's
-- JWT, never a service-role key), so RLS applies to it like to the app. A user can also insert
-- rows into their own chat by hand through the REST API; that only affects their own coach
-- (the function feeds the model only rows it marked, see coach-core.js historyTurns).
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  kind text not null default 'chat' check (kind in ('chat', 'week_review')),
  week date,                                        -- ISO Monday; set on week_review rows only
  content text not null check (char_length(content) <= 8000),
  safety boolean not null default false,            -- assistant: a pain / injury answer (the app adds the fixed banner and footer)
  meta jsonb not null default '{}'::jsonb,          -- { src: 'fn', weeks, sessions, cut, refusal, scope }; never personal text
  model text, input_tokens int, output_tokens int, cache_read_tokens int, cache_write_tokens int,
  created_at timestamptz not null default now(),
  constraint chat_messages_week_kind check ((kind = 'week_review') = (week is not null)),
  -- A hand-inserted row can't date itself into the future to stay "latest" in the thread.
  constraint chat_messages_not_future check (created_at <= now() + interval '1 minute')
);
create index chat_messages_user_time_idx on public.chat_messages (user_id, created_at desc);
-- One review per user per week: a second answer for the same week cannot be stored, so the
-- function returns the stored one instead (and a race between two phones loses cleanly).
create unique index chat_messages_one_review_idx on public.chat_messages (user_id, week)
  where kind = 'week_review' and role = 'assistant';

alter table public.chat_messages enable row level security;
create policy "own chat: read"   on public.chat_messages for select to authenticated using ((select auth.uid()) = user_id);
create policy "own chat: create" on public.chat_messages for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own chat: delete" on public.chat_messages for delete to authenticated using ((select auth.uid()) = user_id);
-- No update policy and no update grant: a stored message is never edited.
revoke all on public.chat_messages from anon;
revoke update, truncate, references, trigger on public.chat_messages from authenticated;

-- ------------------------------------------------------------------ coach_access
-- The coach is invite-only: a model call costs money, and anyone can create an account with an
-- email code. Builder adds a row per person by SQL (no grant lets a user add their own):
--   insert into public.coach_access (user_id) values ('<uuid>');
create table public.coach_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.coach_access enable row level security;
create policy "own access: read" on public.coach_access for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.coach_access from anon;
revoke insert, update, delete, truncate, references, trigger on public.coach_access from authenticated;

-- ------------------------------------------------------------------ chat_usage
-- The cap is a counter, not a count of chat_messages: "Delete my chat" must not reset it.
-- Only a number per user per day, no text.
create table public.chat_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,                                -- Prague calendar day
  n int not null default 0 check (n >= 0),
  primary key (user_id, day)
);
create index chat_usage_day_idx on public.chat_usage (day);
alter table public.chat_usage enable row level security;
create policy "own usage: read" on public.chat_usage for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.chat_usage from anon;
revoke insert, update, delete, truncate, references, trigger on public.chat_usage from authenticated;

-- Atomic take-one. Returns whether this message may go to the model, why not (reason:
-- 'no_access' | 'limit_user' | 'limit_all', null when ok), and the counts after it.
-- The caps (20 per user, 200 for everyone, per Prague day) and the allow-list live HERE, not in
-- the function's request, and a refused take does not count: so a user calling chat_take() by
-- hand through the REST API can use up at most their own 20, and can never push the shared
-- count past what their 20 adds. Someone without coach_access counts nothing at all.
--
-- Why SECURITY DEFINER (the only definer function in the schema): (1) "everyone" is a sum over
-- every user's row, which RLS hides from the caller; (2) users must not write their own counter
-- (no insert/update/delete grant above, or they could reset it). The function body touches only
-- coach_access (read, own row) and chat_usage, only for auth.uid(), with search_path '' and
-- fully qualified names. The advisory lock serialises takes so two concurrent calls can't both
-- pass at 199.
create or replace function public.chat_take() returns table (ok boolean, reason text, mine int, everyone int)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  d date := (now() at time zone 'Europe/Prague')::date;
  m int; e int;
begin
  if me is null then raise exception 'signed out' using errcode = '28000'; end if;
  if not exists (select 1 from public.coach_access a where a.user_id = me) then
    return query select false, 'no_access'::text, 0, 0;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('ledger.chat_take'));
  select coalesce((select u.n from public.chat_usage u where u.user_id = me and u.day = d), 0) into m;
  select coalesce(sum(u.n), 0)::int from public.chat_usage u where u.day = d into e;
  if m >= 20 then return query select false, 'limit_user'::text, m, e; return; end if;
  if e >= 200 then return query select false, 'limit_all'::text, m, e; return; end if;
  insert into public.chat_usage (user_id, day, n) values (me, d, 1)
    on conflict (user_id, day) do update set n = public.chat_usage.n + 1;
  return query select true, null::text, m + 1, e + 1;
end $$;
revoke execute on function public.chat_take() from public, anon;
grant execute on function public.chat_take() to authenticated;

-- ------------------------------------------------------------------ settings_merge
-- Merges top-level keys into the caller's profiles.settings in one statement, so two writers of
-- different keys (the coach's first-run flag, the programme) can't drop each other's key the way
-- a read-modify-write can. Creates the row when there is none. SECURITY INVOKER: the profiles
-- RLS policies (own row: create, change) apply as for any write from the app.
create or replace function public.settings_merge(patch jsonb) returns void
language sql security invoker set search_path = '' as $$
  insert into public.profiles (id, settings)
    values ((select auth.uid()), coalesce(patch, '{}'::jsonb))
  on conflict (id) do update set settings = public.profiles.settings || coalesce(excluded.settings, '{}'::jsonb);
$$;
revoke execute on function public.settings_merge(jsonb) from public, anon;
grant execute on function public.settings_merge(jsonb) to authenticated;

-- ------------------------------------------------------------------ verification
-- Run BEFORE applying for real: paste the whole file plus this block into the SQL editor
-- inside one transaction that ends in ROLLBACK. Two invented users, A and B.
--
-- begin;
--   -- (the migration above)
--   insert into auth.users (id, email) values
--     ('00000000-0000-4000-8000-0000000000a1', 'a@example.invalid'),
--     ('00000000-0000-4000-8000-0000000000b2', 'b@example.invalid');
--   insert into public.coach_access (user_id) values ('00000000-0000-4000-8000-0000000000a1');  -- A only, for now
--
--   -- as A: write two messages, read them back, take from the cap
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
--   insert into public.chat_messages (role, content) values ('user', 'q'), ('assistant', 'a');
--   select count(*) from public.chat_messages;                          -- expect 2
--   select * from public.chat_take();                                   -- expect (t, null, 1, 1)
--   update public.chat_messages set content = 'x';                      -- expect: permission denied
--   insert into public.chat_usage (user_id, day, n)
--     values ('00000000-0000-4000-8000-0000000000a1', current_date, 0); -- expect: permission denied
--   insert into public.coach_access (user_id)
--     values ('00000000-0000-4000-8000-0000000000a1');                  -- expect: permission denied
--   insert into public.chat_messages (user_id, role, content)
--     values ('00000000-0000-4000-8000-0000000000b2', 'user', 'forged'); -- expect: RLS violation
--   insert into public.chat_messages (role, content, created_at)
--     values ('user', 'future', now() + interval '1 day');             -- expect: check violation (not_future)
--   insert into public.chat_messages (role, kind, week, content) values ('assistant', 'week_review', '2026-10-12', 'r1');
--   insert into public.chat_messages (role, kind, week, content) values ('assistant', 'week_review', '2026-10-12', 'r2'); -- expect: unique violation
--   select public.settings_merge('{"coachChat":{"ok":1}}');             -- A has no profile yet: creates it
--   select public.settings_merge('{"programme":{"id":"p"}}');
--   select settings from public.profiles;                               -- expect both keys, one row
--
--   -- as B: no access yet; sees none of A's rows, can't delete them, sees only own usage
--   select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
--   select * from public.chat_take();                                   -- expect (f, no_access, 0, 0), nothing counted
--   select count(*) from public.coach_access;                           -- expect 0 (A's row is not visible)
--   select count(*) from public.chat_messages;                          -- expect 0
--   delete from public.chat_messages;                                   -- expect DELETE 0
--   select count(*) from public.chat_usage;                             -- expect 0
--   select count(*) from public.profiles;                               -- expect 0 (A's settings not visible)
--   reset role;
--   insert into public.coach_access (user_id) values ('00000000-0000-4000-8000-0000000000b2');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
--   select * from public.chat_take();                                   -- expect (t, null, 1, 2)
--
--   -- cap: A at 20 is refused and the refused take is not counted
--   reset role;
--   update public.chat_usage set n = 20 where user_id = '00000000-0000-4000-8000-0000000000a1';
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
--   select * from public.chat_take();                                   -- expect (f, limit_user, 20, 21)
--   select * from public.chat_take();                                   -- expect (f, limit_user, 20, 21) again
--   delete from public.chat_messages;                                   -- A's "Delete my chat"
--   select * from public.chat_take();                                   -- still (f, limit_user, 20, 21): the counter is untouched
--
--   -- the shared cap: B under their own cap is refused once everyone reaches 200
--   reset role;
--   update public.chat_usage set n = 190 where user_id = '00000000-0000-4000-8000-0000000000a1';
--   update public.chat_usage set n = 10 where user_id = '00000000-0000-4000-8000-0000000000b2';
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
--   select * from public.chat_take();                                   -- expect (f, limit_all, 10, 200), not counted
--
--   -- anon gets nothing
--   set local role anon;
--   select set_config('request.jwt.claims', '{"role":"anon"}', true);
--   select count(*) from public.chat_messages;                          -- expect: permission denied
--   select count(*) from public.coach_access;                           -- expect: permission denied
--   select * from public.chat_take();                                   -- expect: permission denied
--   select public.settings_merge('{}');                                 -- expect: permission denied
-- rollback;
--
-- Then run the Supabase security advisor (expect: no new findings; the definer function is
-- intentional and pinned to search_path '').
