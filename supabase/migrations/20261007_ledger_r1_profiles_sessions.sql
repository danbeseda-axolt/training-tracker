-- Applied to Supabase project widuygqbkpyerqhgbvos on 2026-10-07 (migration ledger_r1_profiles_sessions).
-- Ledger release 1: one profile per user, one row per logged session.
-- Session bodies stay the app's existing JSON (schemaVersion 5) so a move back to files is an export.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  programme_key text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id text not null,            -- the app's file name, e.g. 2026-10-06-d1.json; makes offline retries idempotent
  session_date date not null,
  template_key text,
  schema_version int,
  body jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index sessions_user_date_idx on public.sessions (user_id, session_date desc);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger sessions_touch before update on public.sessions for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;

-- Each signed-in user sees and changes only their own rows. Anonymous visitors get nothing.
create policy "own profile: read"   on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile: create" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "own profile: change" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "own sessions: read"   on public.sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "own sessions: create" on public.sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own sessions: change" on public.sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own sessions: delete" on public.sessions for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.sessions from anon;

-- Verified 2026-10-07 in a rolled-back transaction: user A sees 1 row, user B sees 0,
-- B's update of A's row touches 0 rows, anon has no access. Supabase security advisor: no findings.
