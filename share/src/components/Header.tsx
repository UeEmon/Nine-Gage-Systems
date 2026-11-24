import Link from "next/link";
import { BrandLogo } from "../../../src/components/BrandLogo";
import { senrolabUrl } from "../lib/config";
import type { ShareUser } from "../lib/session";

export function Header({ user, next = "/" }: { user: ShareUser | null; next?: string }) {
  return (
    <header className="header share-header">
      <h1 className="share-title">
        <Link href="/" aria-label="ターミナルのトップへ">
          <BrandLogo height={26} />
          <span>ターミナル</span>
        </Link>
      </h1>
      <nav>
        <Link href="/">投稿一覧</Link>
        <Link href="/sets">つないだレイアウト</Link>
        <Link href="/connect">つなぐ</Link>
        <Link href="/post">投稿する</Link>
        <a href={senrolabUrl()}>プラットフォームで作る</a>
      </nav>
      <div className="who">
        {user ? (
          <>
            <Link href={`/?by=${encodeURIComponent(user.sub)}`}>{user.name}</Link>
            <form action="/auth/logout" method="post">
              <button type="submit">ログアウト</button>
            </form>
          </>
        ) : (
          <a href={`/auth/login?next=${encodeURIComponent(next)}`}>SenroLabのアカウントでログイン</a>
        )}
      </div>
    </header>
  );
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).format(new Date(iso));
}
