import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { UserMenu } from "@/components/UserMenu";
import { RELEASES } from "@/data/releases";
import { EDITOR_PATH } from "@/lib/sites";
import { currentUser } from "@/lib/server/auth";
import { signupOpen } from "@/lib/server/users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SenroLab（センロラボ）｜Nゲージのレイアウトを、つくる・走らせる・共有する",
  description: "Nゲージの線路レイアウトをAIと一緒に設計し、運転席の視点で走らせ、みんなと共有できるサービスです。",
};

const PLATFORM_FEATURES = [
  "KATO・TOMIXの線路とストラクチャーを、実際の製品で並べる",
  "要望を書くと、AIがレイアウトを提案（自分のAPIキーで）",
  "高架・地下・勾配を設定して、運転席の視点で3Dで走る",
  "必要な線路を品番ごとの部品リストと価格で確認",
  "列車の運行計画（ダイヤ）を立てる",
];

const TERMINAL_FEATURES = ["作ったレイアウトを投稿して、ほかの人に見てもらう", "みんなのレイアウトをつないで、大きなレイアウトにする"];

const DATE = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });

function formatDate(iso: string) {
  return DATE.format(new Date(iso));
}

/** トップページ（www.）。サービスの入口とログイン */
export default async function HomePage() {
  const user = await currentUser();
  const now = Date.now();
  const news = RELEASES.filter((r) => (r.audience ?? "all") === "all" && Date.parse(r.date) <= now).slice(0, 4);
  return (
    <div className="page-wrap top">
      <header className="header">
        <h1>
          <Link href="/" aria-label="SenroLab のトップへ">
            <BrandLogo />
          </Link>
        </h1>
        <UserMenu user={user} />
      </header>
      <main className="page top-page">
        <section className="top-hero">
          <BrandLogo height={72} />
          <p className="top-lead">Nゲージのレイアウトを、つくる・走らせる・共有する。</p>
          <p className="top-sub">
            線路を並べて部品リストを作り、AIに案を出してもらい、できたレイアウトを運転席の視点で走らせる。ブラウザだけで使えます。
          </p>
          <div className="top-actions">
            <a className="button primary" href={EDITOR_PATH}>
              プラットフォームを開く
            </a>
            {user ? (
              <Link className="button" href="/account">
                {user.username} さんのアカウント
              </Link>
            ) : (
              <>
                <Link className="button" href="/login">
                  ログイン
                </Link>
                {signupOpen() && (
                  <Link className="button" href="/signup">
                    無料でユーザー登録
                  </Link>
                )}
              </>
            )}
          </div>
          {!user && <p className="hint">ログインしなくてもプラットフォームは使えます（AI提案はログインが必要です）。</p>}
        </section>

        <section className="top-services">
          <article className="card top-service">
            <h2>プラットフォーム</h2>
            <p className="muted">レイアウトをつくって管理する</p>
            <ul>
              {PLATFORM_FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <a className="button primary" href={EDITOR_PATH}>
              プラットフォームへ
            </a>
          </article>
          <article className="card top-service">
            <h2>ターミナル</h2>
            <p className="muted">レイアウトを共有する</p>
            <ul>
              {TERMINAL_FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <a className="button primary" href="/terminal">
              ターミナルへ
            </a>
          </article>
        </section>

        {news.length > 0 && (
          <section className="card">
            <h2>新しい機能</h2>
            <ul className="top-news">
              {news.map((r) => (
                <li key={r.id}>
                  <time dateTime={r.date}>{formatDate(r.date)}</time>
                  <span>{r.title}</span>
                </li>
              ))}
            </ul>
            {user && (
              <p className="hint">
                <Link href="/news">すべてのお知らせ</Link>
              </p>
            )}
          </section>
        )}
      </main>
      <footer className="top-footer">© SenroLab</footer>
    </div>
  );
}
