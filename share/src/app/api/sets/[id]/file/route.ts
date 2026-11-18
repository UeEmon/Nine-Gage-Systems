import { assemble, fileName, patternFileOf } from "../../../../../lib/assembly";
import { db } from "../../../../../lib/server";
import { getPosts, getSet } from "../../../../../lib/store";

export const dynamic = "force-dynamic";

/** つないだ全体を1つのレイアウトにしたファイル（すき間を埋める線路も入る） */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const store = db();
  const set = getSet(store, (await params).id);
  if (!set) return new Response("見つかりません。", { status: 404 });
  const { layout } = assemble(set.title, set.modules, getPosts(store, set.modules.map((m) => m.postId)));
  layout.description = set.description || layout.description;
  return new Response(JSON.stringify(patternFileOf(set.title, layout), null, 1), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="layout-set.json"; filename*=UTF-8''${encodeURIComponent(fileName(set.title))}`,
    },
  });
}
