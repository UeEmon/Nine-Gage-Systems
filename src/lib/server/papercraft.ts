import { z } from "zod";
import { SIM_KINDS } from "../replica";

/**
 * ペーパークラフトジェネレーター（別のコンテナ）との連携。
 * 仕様は docs/PAPERCRAFT_API.md。PAPERCRAFT_URL がなければ無効。
 */

type Env = Record<string, string | undefined>;

export const PAPERS = ["A4", "A3"] as const;
export type Paper = (typeof PAPERS)[number];

export const PAPERCRAFT_NOTICE =
  "SenroLab のシミュレーション上の仮オブジェクトです。実在の製品・鉄道会社の公式なものではありません。";

export type PapercraftConfig = { url: string; token?: string; timeoutMs: number };

export function papercraftConfig(env: Env = process.env): PapercraftConfig | null {
  const raw = env.PAPERCRAFT_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const t = Number(env.PAPERCRAFT_TIMEOUT_MS);
  return {
    url: url.toString().replace(/\/+$/, ""),
    token: env.PAPERCRAFT_API_TOKEN?.trim() || undefined,
    timeoutMs: Number.isFinite(t) && t > 0 ? Math.min(t, 120_000) : 30_000,
  };
}

/** 画面から受け取る仮オブジェクト（ジェネレーターに渡す分だけ） */
export const PapercraftObjectSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(SIM_KINDS),
  length: z.number().min(1).max(2000),
  width: z.number().min(1).max(800),
  height: z.number().min(0).max(400),
  note: z.string().max(200).default(""),
});
export type PapercraftObject = z.infer<typeof PapercraftObjectSchema>;

const MAX_PAGES = 20;
const MAX_SVG_BYTES = 2_000_000;

const ResponseSchema = z.object({
  pages: z
    .array(
      z
        .string()
        .max(MAX_SVG_BYTES)
        .refine((s) => /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(s), "SVG ではありません"),
    )
    .min(1)
    .max(MAX_PAGES),
  warnings: z.array(z.string().max(300)).max(20).optional(),
});

export type PapercraftResult = { pages: string[]; warnings: string[] };

export class PapercraftError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** ジェネレーターに展開図を作ってもらう */
export async function requestNets(
  object: PapercraftObject,
  paper: Paper,
  config: PapercraftConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<PapercraftResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.url}/v1/nets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({ source: "senrolab", scale: "1/150", paper, object, notice: PAPERCRAFT_NOTICE }),
      signal: AbortSignal.timeout(config.timeoutMs),
      redirect: "error",
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new PapercraftError(
      timeout ? "ペーパークラフトジェネレーターの応答が時間内にありませんでした。" : "ペーパークラフトジェネレーターにつながりませんでした。",
      502,
    );
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as { error?: unknown } | null)?.error;
    throw new PapercraftError(
      typeof msg === "string" && msg.trim() ? msg.slice(0, 300) : `ペーパークラフトジェネレーターがエラーを返しました（HTTP ${res.status}）。`,
      res.status >= 400 && res.status < 500 ? 422 : 502,
    );
  }
  const parsed = ResponseSchema.safeParse(data);
  if (!parsed.success) throw new PapercraftError("ペーパークラフトジェネレーターの応答を読み取れませんでした。", 502);
  return { pages: parsed.data.pages, warnings: parsed.data.warnings ?? [] };
}
