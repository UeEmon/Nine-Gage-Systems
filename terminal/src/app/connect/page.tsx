import Link from "next/link";
import { Header } from "../../components/Header";
import { Builder } from "../../components/Builder";
import { canEdit, currentUser, db } from "../../lib/server";
import { getPost, getPosts, getSet, listPosts } from "../../lib/store";

export const dynamic = "force-dynamic";

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ start?: string; set?: string; resume?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const store = db();
  const toModule = (p: NonNullable<ReturnType<typeof getPost>>) => ({ id: p.id, title: p.title, ownerName: p.ownerName, layout: p.layout, connectors: p.connectors });

  let initial: Parameters<typeof Builder>[0] | null = null;
  const set = sp.set ? getSet(store, sp.set) : null;
  if (set) {
    const posts = getPosts(store, set.modules.map((m) => m.postId));
    const ids = new Set(posts.map((p) => p.id));
    initial = {
      posts: posts.map(toModule),
      modules: set.modules.filter((m) => ids.has(m.postId)),
      setId: canEdit(user, set.ownerId) ? set.id : undefined,
      title: set.title,
      description: set.description,
      loggedIn: !!user,
    };
  } else if (sp.resume) {
    initial = { posts: [], modules: [], loggedIn: !!user, resume: true };
  } else if (sp.start) {
    const p = getPost(store, sp.start);
    if (p) initial = { posts: [toModule(p)], modules: [{ postId: p.id, placement: { x: 0, y: 0, rot: 0 } }], loggedIn: !!user };
  }

  const next = sp.set ? `/connect?set=${sp.set}` : sp.start ? `/connect?start=${sp.start}` : "/connect";
  return (
    <div className="page-wrap">
      <Header user={user} next={next} />
      <main className="page wide">
        {initial ? (
          <Builder {...initial} />
        ) : (
          <StartPicker />
        )}
      </main>
    </div>
  );

  function StartPicker() {
    const { posts } = listPosts(store, { connectable: true, limit: 60 });
    return (
      <div className="card">
        <h2>つなぐ</h2>
        <p className="lead">
          最初のレイアウトを選んでください。そのあと、空いている端子（緑の丸）を押すと、つなげられる投稿と置き方の候補が出ます。
        </p>
        {posts.length ? (
          <ul className="module-list">
            {posts.map((p) => (
              <li key={p.id}>
                <Link href={`/connect?start=${p.id}`}>{p.title}</Link>（{p.ownerName}・{p.width}×{p.height}mm・端子 {p.connectors.length}）
              </li>
            ))}
          </ul>
        ) : (
          <p className="notice">端子のある投稿がまだありません。</p>
        )}
      </div>
    );
  }
}
