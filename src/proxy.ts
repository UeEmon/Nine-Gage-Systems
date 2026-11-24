import { NextResponse, type NextRequest } from "next/server";
import { routeFor, sitesFrom } from "@/lib/sites";

/** トップページ（www.）とプラットフォーム（platform.）の振り分け（src/lib/sites.ts） */
export function proxy(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const route = routeFor(host, req.nextUrl.pathname, req.nextUrl.search, sitesFrom());
  if (!route) return NextResponse.next();
  if (route.kind === "rewrite") {
    const url = req.nextUrl.clone();
    url.pathname = route.path;
    return NextResponse.rewrite(url);
  }
  return NextResponse.redirect(new URL(route.url, req.url), 307);
}

export const config = {
  // API・Next.js の内部・アイコンなどのファイルは振り分けない
  matcher: ["/((?!api/|_next/|favicon\\.ico|icon\\.svg|apple-icon\\.png|.*\\.[a-z0-9]+$).*)"],
};
