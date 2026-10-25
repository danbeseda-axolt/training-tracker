-- Applied to Supabase project widuygqbkpyerqhgbvos on 2026-10-25 (migration liftless_health_daily).
-- One row per user and day, from Health Connect on the phone (Google Health / Fitbit write there).
-- Read only by the person (RLS) and by the coach function acting as that person.

create table public.health_daily (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  sleep_min int check (sleep_min between 0 and 1440),
  resting_hr numeric(5,1) check (resting_hr between 20 and 200),
  hrv_ms numeric(6,1) check (hrv_ms between 1 and 400),
  steps int check (steps between 0 and 200000),
  weight_kg numeric(5,1) check (weight_kg between 20 and 400),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create trigger health_daily_touch before update on public.health_daily for each row execute function public.touch_updated_at();

alter table public.health_daily enable row level security;

create policy "own health: read"   on public.health_daily for select to authenticated using ((select auth.uid()) = user_id);
create policy "own health: create" on public.health_daily for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own health: change" on public.health_daily for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own health: delete" on public.health_daily for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.health_daily from anon;
revoke truncate, references, trigger on public.health_daily from authenticated;
