import { fileName, patternFileOf } from "../../../../../lib/assembly";
import { db } from "../../../../../lib/server";
import { getPost } from "../../../../../lib/store";

export const dynamic = "force-dynamic";

/** プラットフォームの「パターンの保存」→「読み込む」で開けるファイル */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const post = getPost(db(), (await params).id);
  if (!post) return new Response("見つかりません。", { status: 404 });
  const file = patternFileOf(post.title, post.layout);
  return new Response(JSON.stringify(file, null, 1), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="layout.json"; filename*=UTF-8''${encodeURIComponent(fileName(post.title))}`,
    },
  });
}
