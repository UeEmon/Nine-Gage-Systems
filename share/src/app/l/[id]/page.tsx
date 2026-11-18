import Link from "next/link";
import { notFound } from "next/navigation";
import { Header, formatDate } from "../../../components/Header";
import { LayoutSvg } from "../../../components/LayoutSvg";
import { OwnerActions } from "../../../components/OwnerActions";
import { analyze } from "../../../../../src/lib/geometry";
import { EDGE_LABELS, findCandidates } from "../../../../../src/lib/modules";
import { MAKER_INFO } from "../../../../../src/lib/parts";
import { sourcesOf } from "../../../lib/assembly";
import { canEdit, currentUser, db } from "../../../lib/server";
import { connectablePosts, getPost, listSets } from "../../../lib/store";

export const dynamic = "force-dynamic";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = db();
  const post = getPost(store, id);
  if (!post) notFound();
  const user = await currentUser();
  const an = analyze(post.layout);
  const sets = listSets(store, { postId: post.id, limit: 12 });

  // 端子ごとに、つなげられるほかの投稿（問題なくつながるもの）
  const pool = post.connectors.length ? [...sourcesOf(connectablePosts(store, post.maker).filter((p) => p.id !== post.id)).values()] : [];
  const titles = new Map(pool.map((s) => [s.key, s.layout.title]));
  const self = sourcesOf([post]);
  const matches = post.connectors.map((c) => {
    const cands = findCandidates([{ key: post.id, placement: { x: 0, y: 0, rot: 0 } }], { module: 0, connector: c.id }, self, pool);
    const ids = [...new Set(cands.filter((x) => !x.problems.length).map((x) => x.key))];
    return { total: ids.length, ids: ids.slice(0, 4) };
  });

  return (
    <div className="page-wrap">
      <Header user={user} next={`/l/${post.id}`} />
      <main className="page wide">
        <div className="detail">
          <div className="figure">
            <LayoutSvg layout={post.layout} connectors={post.connectors} />
          </div>
          <div className="side">
            <div className="card">
              <h2>{post.title}</h2>
              <dl>
                <dt>投稿</dt>
                <dd>
                  <Link href={`/?by=${encodeURIComponent(post.ownerId)}`}>{post.ownerName}</Link>・{formatDate(post.createdAt)}
                </dd>
                <dt>線路</dt>
                <dd>
                  {MAKER_INFO[post.maker].label} {MAKER_INFO[post.maker].system}
                </dd>
                <dt>ボード</dt>
                <dd>
                  {post.width}×{post.height}mm
                </dd>
                <dt>部品</dt>
                <dd>
                  {post.pieceCount}本・線路延長 {(an.totalLengthMm / 1000).toFixed(2)}m
                </dd>
              </dl>
              {post.description && <p className="desc">{post.description}</p>}
              <div className="actions">
                <a className="button" href={`/api/posts/${post.id}/file`} download>
                  ファイルに保存
                </a>
                {post.connectors.length > 0 && (
                  <Link className="button primary-link" href={`/connect?start=${post.id}`}>
                    ここからつなぐ
                  </Link>
                )}
              </div>
              <p className="notice">保存したファイルは、SenroLab の「パターンの保存」→「読み込む」で開けます。</p>
              {canEdit(user, post.ownerId) && <OwnerActions kind="post" id={post.id} title={post.title} description={post.description} />}
            </div>
            <div className="card">
              <h2>端子</h2>
              {post.connectors.length ? (
                <ul className="connector-list">
                  {post.connectors.map((c, i) => (
                    <li key={c.id}>
                      <span className="num">{i + 1}</span>
                      {EDGE_LABELS[c.edge]}の端・端まで {c.inset.toFixed(0)}mm{c.z ? `・高さ ${c.z.toFixed(0)}mm` : ""}
                      {matches[i].total > 0 && (
                        <div className="notice">
                          つながる投稿:{" "}
                          {matches[i].ids.map((pid, k) => (
                            <span key={pid}>
                              {k > 0 && "、"}
                              <Link href={`/l/${pid}`}>{titles.get(pid)}</Link>
                            </span>
                          ))}
                          {matches[i].total > matches[i].ids.length && ` ほか${matches[i].total - matches[i].ids.length}件`}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="notice">
                  ボードの端に向かって終わっている線路がないので、ほかのレイアウトとはつなげません。線路をボードの端の近く（{300}mm以内）まで、端と直角に延ばすと端子になります。
                </p>
              )}
            </div>
            {sets.length > 0 && (
              <div className="card">
                <h2>このレイアウトを使ったつないだレイアウト</h2>
                <ul className="module-list">
                  {sets.map((s) => (
                    <li key={s.id}>
                      <Link href={`/s/${s.id}`}>{s.title}</Link>（{s.modules.length}枚・{s.ownerName}）
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
