import { requireUser } from "@/lib/server/auth";
import { DB_INFO, PRODUCTS, productsCsv } from "@/lib/productDb";

/** 品番データベースを JSON（既定）または CSV（?format=csv）で返す */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const format = new URL(req.url).searchParams.get("format");
  if (format === "csv") {
    // Excel で文字化けしないよう BOM を付ける
    return new Response("﻿" + productsCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="nine-gage-track-database.csv"',
      },
    });
  }
  return Response.json({ ...DB_INFO, products: PRODUCTS });
}
