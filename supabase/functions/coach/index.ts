// Ledger coach: Supabase Edge Function entry point (Deno). Thin wrapper: all
// logic is in coach-core.js, tested from node (tracker/dev/coach-fn.test.mjs).
//
// Secrets and variables it reads (Supabase dashboard → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  set by Dan himself; never in code, files or a chat
//   COACH_OFF=1        kill switch: every call answers "off", nothing counted
//   COACH_MODEL=fake   canned replies, no key needed (build step 2)
//   SUPABASE_URL, SUPABASE_ANON_KEY   provided by Supabase
// No service-role key is read: the function acts as the signed-in user.
import { handleHttp } from './coach-core.js';

Deno.serve((req: Request) => handleHttp(req, {
  env: (k: string) => Deno.env.get(k),
  fetch: (u: string | URL | Request, i?: RequestInit) => fetch(u, i),
  log: (m: string) => console.log('[coach] ' + m)
}));
