import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/config";

// מי שלוחץ על הקישור במייל (במקום להקליד קוד) מגיע לכאן.
// מאמתים את הקישור, שומרים חיבור ומעבירים למסך הבית.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const store = await cookies();
  const sb = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookieOptions: { maxAge: 60 * 60 * 24 * 400, sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });

  let ok = false;
  if (code) {
    ok = !(await sb.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await sb.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }

  const dest = url.clone();
  dest.search = "";
  dest.pathname = ok ? "/" : "/login";
  if (!ok) dest.searchParams.set("link", "expired");
  return NextResponse.redirect(dest);
}
