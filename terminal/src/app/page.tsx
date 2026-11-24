import Link from "next/link";
import { Header } from "../components/Header";
import { PostCard } from "../components/PostCard";
import { MAKERS, MAKER_INFO, type Maker } from "../../../src/lib/parts";
import { currentUser, db } from "../lib/server";
import { getPosts, listPosts } from "../lib/store";

export const dynamic = "force-dynamic";

const PAGE = 24;

type Search = { q?: string; maker?: string; connectable?: string; operation?: string; by?: string; page?: string };

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const maker = MAKERS.includes(sp.maker as Maker) ? (sp.maker as Maker) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const store = db();
  const { posts, total } = listPosts(store, {
    q: sp.q,
    maker,
    connectable: sp.connectable === "1",
    withOperation: sp.operation === "1",
    owner: sp.by,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const full = getPosts(store, posts.map((p) => p.id));
  const link = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") u.set(k, v);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return s ? `/?${s}` : "/";
  };
  return (
    <div className="page-wrap">
      <Header user={user} />
      <main className="page wide">
        <p className="lead">
          SenroLab プラットフォームで作ったレイアウトを投稿して見せ合えます。ボードの端まで延びた線路（
          <span className="num">1</span>
          の印の「端子」）があるレイアウトは、ほかの人のレイアウトと端どうしでつないで、大きなレイアウトにできます。運行計画（ダイヤ）を作ったレイアウトは、ダイヤも一緒に見られます。
        </p>
        <form className="filters" action="/" method="get">
          <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="題名・説明・投稿者で探す" aria-label="検索" />
          <select name="maker" defaultValue={maker ?? ""} aria-label="メーカー">
            <option value="">すべてのメーカー</option>
            {MAKERS.map((m) => (
              <option key={m} value={m}>
                {MAKER_INFO[m].label}
              </option>
            ))}
          </select>
          <label>
            <input type="checkbox" name="connectable" value="1" defaultChecked={sp.connectable === "1"} />
            つなげる端子があるものだけ
          </label>
          <label>
            <input type="checkbox" name="operation" value="1" defaultChecked={sp.operation === "1"} />
            運行計画があるものだけ
          </label>
          {sp.by && <input type="hidden" name="by" value={sp.by} />}
          <button type="submit">探す</button>
          {(sp.q || maker || sp.connectable || sp.operation || sp.by) && <Link href="/">条件を消す</Link>}
        </form>
        {sp.by && <p className="lead">{posts[0]?.ownerName ?? "この人"}さんの投稿</p>}
        {full.length ? (
          <div className="post-grid">
            {full.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        ) : (
          <div className="card">
            <p className="lead">
              まだ投稿がありません。<Link href="/post">最初のレイアウトを投稿する</Link>
            </p>
          </div>
        )}
        {total > PAGE && (
          <nav className="pager">
            {page > 1 && <Link href={link(page - 1)}>← 前へ</Link>}
            <span>
              {page} / {Math.ceil(total / PAGE)}
            </span>
            {page * PAGE < total && <Link href={link(page + 1)}>次へ →</Link>}
          </nav>
        )}
      </main>
    </div>
  );
}
