import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type Db = SupabaseClient<Database>;

let client: Db | null = null;

/** Server-only Supabase client using the service role key. Never import from client code. */
export function db(): Db {
  if (client) return client;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key)
    throw new Error("SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum diatur di environment.");
  client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // New-format sb_secret_ keys are not JWTs: send only apikey header.
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  return client;
}
