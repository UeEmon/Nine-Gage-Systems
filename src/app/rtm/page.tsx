import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { RtmManagement } from "@/components/rtm/RtmManagement";
import { currentUser } from "@/lib/server/auth";
import { canUseRtm } from "@/lib/roles";
import { EDITOR_PATH } from "@/lib/sites";

export const metadata: Metadata = { title: "RTM車両管理 | SenroLab" };

export default async function RtmPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/rtm");
  return (
    <div className="page-wrap">
      <header className="header">
        <a href={EDITOR_PATH} aria-label="レイアウト編集へ"><BrandLogo /></a>
        <h1>RTM車両管理</h1>
      </header>
      <main className="page">
        {canUseRtm(user.role) ? <RtmManagement /> : <p>RTM車両管理はプレミアムユーザー・プレミアムプラス・管理者が利用できます。</p>}
        <a href={EDITOR_PATH}>レイアウト編集へ</a>
      </main>
    </div>
  );
}
