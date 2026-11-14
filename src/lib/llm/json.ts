/** モデルのテキスト出力からJSONを取り出す（```json フェンスや前後の説明文を許容） */
export function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

/**
 * zod の JSON Schema から、各社の構造化出力が受け付けにくいキーを取り除く
 * （$schema、整数の minimum/maximum など）。
 */
export function sanitizeSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema) as T;
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === "$schema" || k === "minimum" || k === "maximum") continue;
      out[k] = sanitizeSchema(v);
    }
    return out as T;
  }
  return schema;
}
