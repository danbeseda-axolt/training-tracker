-- Applied to Supabase project widuygqbkpyerqhgbvos on 2026-10-07 (migration ledger_r1_tighten_grants).
-- RLS does not apply to TRUNCATE; signed-in users only need row-level verbs.
revoke truncate, references, trigger on public.sessions, public.profiles from authenticated;
revoke delete on public.profiles from authenticated;
