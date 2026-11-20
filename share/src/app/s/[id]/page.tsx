import Link from "next/link";
import { notFound } from "next/navigation";
import { Header, formatDate } from "../../../components/Header";
import { AssemblySvg } from "../../../components/LayoutSvg";
import { OwnerActions } from "../../../components/OwnerActions";
import { OperationSummary } from "../../../components/OperationSummary";
import { getPart } from "../../../../../src/lib/parts";
import { assemble } from "../../../lib/assembly";
import { canEdit, currentUser, db } from "../../../lib/server";
import { getPosts, getSet } from "../../../lib/store";

export const dynamic = "force-dynamic";

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = db();
  const set = getSet(store, id);
  if (!set) notFound();
  const user = await currentUser();
  const posts = getPosts(store, set.modules.map((m) => m.postId));
  const byId = new Map(posts.map((p) => [p.id, p]));
  const { check, offset, layout, missing, present } = assemble(set.title, set.modules, posts);
  const modules = present.map((m) => {
    const p = byId.get(m.postId)!;
    return { key: p.id, title: p.title, layout: p.layout, connectors: p.connectors, placement: m.placement };
  });
  const linked = new Set(check.junctions.flatMap((j) => [`${j.a.module}:${j.a.connector}`, `${j.b.module}:${j.b.connector}`]));
  const bad = new Set(check.mismatches.map((m) => `${m.a.module}:${m.a.connector}`));
  const fillers = layout.pieces.filter((p) => p.uid.startsWith("fill"));
  const fillCount = new Map<string, number>();
  for (const p of fillers) fillCount.set(getPart(p.partId).id, (fillCount.get(getPart(p.partId).id) ?? 0) + 1);

  return (
    <div className="page-wrap">
      <Header user={user} next={`/s/${set.id}`} />
      <main className="page wide">
        <div className="detail">
          <div className="figure">
            <AssemblySvg
              modules={modules}
              fillers={fillers}
              fillerOffset={offset}
              connectorState={(i, c) => (linked.has(`${i}:${c.id}`) ? "linked" : bad.has(`${i}:${c.id}`) ? "problem" : "free")}
            />
          </div>
          <div className="side">
            <div className="card">
              <h2>{set.title}</h2>
              <dl>
                <dt>保存</dt>
                <dd>
                  {set.ownerName}・{formatDate(set.updatedAt)}
                </dd>
                <dt>全体</dt>
                <dd>
                  {layout.board.width}×{layout.board.height}mm
                </dd>
                <dt>つなぎ目</dt>
                <dd>{check.junctions.length}か所</dd>
              </dl>
              {set.description && <p className="desc">{set.description}</p>}
              {missing > 0 && <p className="problem">投稿が削除されたため、{missing}枚のレイアウトが欠けています。</p>}
              <div className="actions">
                <a className="button" href={`/api/sets/${set.id}/file`} download>
                  全体をファイルに保存
                </a>
              </div>
              <p className="notice">全体を1つのレイアウトにしたファイルです（すき間を埋める線路と、ボードごとの運行計画も入ります）。SenroLab の「パターンの保存」→「読み込む」で開けます。</p>
              {canEdit(user, set.ownerId) && <OwnerActions kind="set" id={set.id} title={set.title} description={set.description} />}
            </div>
            <div className="card">
              <h2>つないだレイアウト</h2>
              <ol className="module-list">
                {modules.map((m) => (
                  <li key={m.key + m.placement.x + m.placement.y}>
                    <Link href={`/l/${m.key}`}>{m.title}</Link>（{byId.get(m.key)!.ownerName}）
                  </li>
                ))}
              </ol>
              <h3>つなぎ目に足す線路</h3>
              {fillCount.size ? (
                <ul className="junction-list">
                  {[...fillCount].map(([pid, n]) => (
                    <li key={pid}>
                      {pid} × {n}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="notice">足す線路はありません（そのままつながります）。</p>
              )}
              {check.junctions.some((j) => j.fill === null) && (
                <p className="problem">ちょうどの長さの直線がないつなぎ目があります。スライド線路（KATO）やバリアブルレール（TOMIX）で合わせてください。</p>
              )}
              {check.mismatches.map((m, i) => (
                <p key={i} className="problem">
                  {m.a.module + 1}枚目: {m.reason}
                </p>
              ))}
            </div>
          </div>
          {layout.operation && (
            <div className="detail-wide">
              <OperationSummary layout={layout} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
