import { z } from "zod";
import { proposeLayout, ProposeError, sessionOptions, type ProposeInput } from "@/lib/ai";
import { usageOf } from "@/lib/bom";
import { createSession, toLlmError, type ResolvedAiSettings } from "@/lib/llm";
import { settingsForUse } from "@/lib/server/aiSettings";
import { requireUser } from "@/lib/server/auth";
import { MAKERS } from "@/lib/parts";
import { shortfall, stockFromInventory } from "@/lib/productDb";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({
  board: z.object({
    width: z.number().min(200).max(10000),
    height: z.number().min(200).max(10000),
  }),
  request: z.string().max(2000),
  maker: z.enum(MAKERS).default("kato"),
  /** free=自由に設計, owned=所有パーツだけで組む, expand=所有パーツを広げる拡張案 */
  mode: z.enum(["free", "owned", "expand"]).default("free"),
  /** 所有パーツ（"メーカー:品番" → 箱数） */
  inventory: z.record(z.string().max(40), z.number().int().min(0).max(999)).default({}),
  /** 出す案の数 */
  patterns: z.number().int().min(1).max(3).default(1),
});

/** 複数案を出すときの方向づけ */
const HINTS: Record<"free" | "owned" | "expand", string[]> = {
  free: ["要望にいちばん素直な基本の案", "分岐や待避線を多めにして、運転の変化を楽しめる案", "線路の長さを長くとり、周回を楽しめる案"],
  owned: [
    "所有パーツで確実に組める、シンプルな周回の案",
    "所有しているポイントなどの分岐をできるだけ活かした案",
    "所有パーツをなるべく多く使った、変化のある案",
  ],
  expand: [
    "追加購入を少なめ（5,000円程度まで）に抑えた小さな拡張案",
    "待避線や引き込み線を加える中くらいの拡張案（1万5,000円程度まで）",
    "複線化や駅の拡張など、大きく発展させる案（3万円程度まで）",
  ],
};

/** ログインした人なら誰でも使える。AIは管理者が設定したもの（画面からキーやURLは送れない） */
export async function POST(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "入力が正しくありません（ボードは200〜10000mm、要望は2000文字まで）" }, { status: 400 });
  }
  const { board, request, maker, mode, inventory, patterns } = parsed.data;
  const counts = stockFromInventory(inventory, maker);
  if (mode === "owned" && counts.size === 0) {
    return Response.json({ error: "所有パーツが登録されていません。先に所有パーツを登録してください。" }, { status: 400 });
  }

  let settings: ResolvedAiSettings;
  try {
    settings = settingsForUse(g.data.ai);
  } catch (err) {
    const e = toLlmError(err, undefined);
    return Response.json({ error: e.message }, { status: e.status });
  }

  const hints = patterns > 1 ? HINTS[mode].slice(0, patterns) : [undefined];
  const runs = await Promise.allSettled(
    hints.map(async (hint) => {
      const input: ProposeInput = {
        board,
        request,
        maker,
        hint,
        stock: mode === "free" ? undefined : { counts, mode },
      };
      const session = createSession(settings, sessionOptions(maker));
      const result = await proposeLayout(input, session, settings.model);
      return { ...result, hint: hint ?? null, shortfall: shortfall(usageOf(result.pieces), counts) };
    }),
  );

  const results = runs.map((r) =>
    r.status === "fulfilled"
      ? { ok: true as const, ...r.value }
      : {
          ok: false as const,
          error: r.reason instanceof ProposeError ? r.reason.message : toLlmError(r.reason, settings).message,
        },
  );
  const firstFailure = runs.find((r) => r.status === "rejected");
  if (results.every((r) => !r.ok) && firstFailure?.status === "rejected") {
    const err = firstFailure.reason;
    console.error("propose failed", settings.provider, settings.model, err);
    if (err instanceof ProposeError) return Response.json({ error: err.message }, { status: 422 });
    const e = toLlmError(err, settings);
    return Response.json({ error: e.message }, { status: e.status });
  }
  return Response.json({ provider: settings.provider, mode, patterns: results });
}
