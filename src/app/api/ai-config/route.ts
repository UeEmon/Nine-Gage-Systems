import { serverAiInfo } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** サーバー側のAI設定の状況（キーの有無だけで、キーそのものは返さない） */
export function GET() {
  return Response.json(serverAiInfo());
}
