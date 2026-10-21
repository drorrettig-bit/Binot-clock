"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/config";

let client: SupabaseClient | null = null;

// לקוח יחיד לכל האפליקציה. החיבור נשמר בעוגיות לטווח ארוך
// ומתחדש אוטומטית ברקע, כך שהמשתמש לא מתבקש להתחבר שוב.
export function supabase(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
      cookieOptions: { maxAge: 60 * 60 * 24 * 400, sameSite: "lax", path: "/" },
    });
  }
  return client;
}
