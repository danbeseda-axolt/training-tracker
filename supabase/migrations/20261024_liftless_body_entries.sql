-- Applied to Supabase project widuygqbkpyerqhgbvos on 2026-10-24 (migration liftless_body_entries).
-- Bodyweight and floor benchmarks move from GitHub (bw-YYYY-MM.json) to the account.
-- One row per user, date and type; the body is the app's existing entry JSON.

create table public.body_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_date date not null,
  entry_type text not null check (entry_type in ('bw', 'floor')),
  body jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, entry_date, entry_type)
);

create trigger body_entries_touch before update on public.body_entries for each row execute function public.touch_updated_at();

alter table public.body_entries enable row level security;

create policy "own body: read"   on public.body_entries for select to authenticated using ((select auth.uid()) = user_id);
create policy "own body: create" on public.body_entries for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own body: change" on public.body_entries for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own body: delete" on public.body_entries for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.body_entries from anon;
revoke truncate, references, trigger on public.body_entries from authenticated;
