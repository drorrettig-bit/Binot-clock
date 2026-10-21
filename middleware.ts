import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/config";

// רץ לפני כל בקשה: מחדש את החיבור אם צריך ומפנה משתמש לא מחובר למסך הכניסה.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const sb = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookieOptions: { maxAge: 60 * 60 * 24 * 400, sameSite: "lax", path: "/" },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await sb.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLogin = path.startsWith("/login");
  if (path.startsWith("/auth/")) return response;

  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.png|logo.png|icons/|manifest.webmanifest|robots.txt).*)"],
};
