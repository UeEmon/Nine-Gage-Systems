export const dynamic = "force-dynamic";

/** コンテナのヘルスチェックと外部の死活確認用。中身は返さない */
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
