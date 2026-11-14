import Link from "next/link";
import { redirect } from "next/navigation";
import { NoticeList } from "@/components/NoticeList";
import { UserMenu } from "@/components/UserMenu";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="page-wrap">
      <header className="header">
        <h1>
          <Link href="/">Nine-Gage レイアウトプランナー</Link> / お知らせ
        </h1>
        <UserMenu user={user} />
      </header>
      <main className="page">
        <NoticeList />
      </main>
    </div>
  );
}
