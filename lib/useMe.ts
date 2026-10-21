"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { OrgSettings, Profile } from "@/lib/types";

/** טוען את המשתמש המחובר, הפרופיל שלו והגדרות הישיבה. */
export function useMe() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const sb = supabase();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) {
      router.replace("/login");
      return;
    }
    const [p, o] = await Promise.all([
      sb.from("profiles").select("*").eq("id", auth.user.id).single(),
      sb.from("organization_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    setProfile((p.data as Profile) ?? null);
    setOrg((o.data as OrgSettings) ?? null);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { profile, org, loading, reload };
}

export async function signOut() {
  await supabase().auth.signOut();
}
