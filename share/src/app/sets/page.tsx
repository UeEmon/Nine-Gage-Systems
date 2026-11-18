import Link from "next/link";
import { Header, formatDate } from "../../components/Header";
import { AssemblySvg } from "../../components/LayoutSvg";
import { assemble } from "../../lib/assembly";
import { currentUser, db } from "../../lib/server";
import { getPosts, listSets } from "../../lib/store";

export const dynamic = "force-dynamic";

export default async function SetsPage() {
  const user = await currentUser();
  const store = db();
  const sets = listSets(store, { limit: 48 });
  return (
    <div className="page-wrap">
      <Header user={user} next="/sets" />
      <main className="page wide">
        <p className="lead">
          投稿されたレイアウトを、ボードの端の線路でつないだものです。<Link href="/connect">自分でつなぐ</Link>
        </p>
        {sets.length ? (
          <div className="post-grid">
            {sets.map((s) => {
              const posts = getPosts(store, s.modules.map((m) => m.postId));
              const byId = new Map(posts.map((p) => [p.id, p]));
              const { check, offset, layout } = assemble(s.title, s.modules, posts);
              const modules = s.modules.flatMap((m) => {
                const p = byId.get(m.postId);
                return p ? [{ key: p.id, title: p.title, layout: p.layout, connectors: p.connectors, placement: m.placement }] : [];
              });
              return (
                <Link key={s.id} href={`/s/${s.id}`} className="post-card">
                  <div className="thumb">
                    <AssemblySvg modules={modules} fillers={layout.pieces.filter((p) => p.uid.startsWith("fill"))} fillerOffset={offset} connectorState={() => null} />
                  </div>
                  <div className="meta">
                    <strong>{s.title}</strong>
                    <span>
                      {s.modules.length}枚・つなぎ目 {check.junctions.length}
                    </span>
                    <span>
                      {s.ownerName}・{formatDate(s.createdAt)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="card">
            <p className="lead">
              まだありません。<Link href="/connect">投稿をつないでみる</Link>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
