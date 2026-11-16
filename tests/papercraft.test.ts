import { describe, expect, it, vi } from "vitest";
import { PapercraftError, papercraftConfig, requestNets, type PapercraftObject } from "../src/lib/server/papercraft";

const obj: PapercraftObject = { name: "テストトンネル", kind: "tunnel", length: 248, width: 60, height: 40, note: "長いトンネル" };
const cfg = { url: "http://papercraft:8080", token: "tok", timeoutMs: 1000 };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm"></svg>';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("ペーパークラフト連携の設定", () => {
  it("PAPERCRAFT_URL がなければ無効", () => {
    expect(papercraftConfig({})).toBeNull();
    expect(papercraftConfig({ PAPERCRAFT_URL: " " })).toBeNull();
    expect(papercraftConfig({ PAPERCRAFT_URL: "ftp://x" })).toBeNull();
    expect(papercraftConfig({ PAPERCRAFT_URL: "not a url" })).toBeNull();
  });

  it("末尾のスラッシュを取り、トークンと待ち時間を読む", () => {
    expect(papercraftConfig({ PAPERCRAFT_URL: "http://papercraft:8080/", PAPERCRAFT_API_TOKEN: "t", PAPERCRAFT_TIMEOUT_MS: "5000" })).toEqual({
      url: "http://papercraft:8080",
      token: "t",
      timeoutMs: 5000,
    });
    expect(papercraftConfig({ PAPERCRAFT_URL: "http://p" })?.timeoutMs).toBe(30_000);
  });
});

describe("展開図の依頼", () => {
  it("仕様どおりの要求を送り、ページと警告を返す", async () => {
    const fetchImpl = vi.fn(async () => json({ pages: [svg], warnings: ["高さを30mmにしました"] }));
    const res = await requestNets(obj, "A4", cfg, fetchImpl as unknown as typeof fetch);
    expect(res).toEqual({ pages: [svg], warnings: ["高さを30mmにしました"] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://papercraft:8080/v1/nets");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ source: "senrolab", scale: "1/150", paper: "A4", object: obj });
    expect(body.notice).toContain("シミュレーション上");
  });

  it("トークンがなければ Authorization を付けない", async () => {
    const fetchImpl = vi.fn(async () => json({ pages: [svg] }));
    const res = await requestNets(obj, "A3", { ...cfg, token: undefined }, fetchImpl as unknown as typeof fetch);
    expect(res.warnings).toEqual([]);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("ジェネレーターのエラーメッセージを伝える", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "この種類には対応していません" }, 400));
    await expect(requestNets(obj, "A4", cfg, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      message: "この種類には対応していません",
      status: 422,
    });
  });

  it("SVG でない応答は受け取らない", async () => {
    const fetchImpl = vi.fn(async () => json({ pages: ["<html><script>alert(1)</script></html>"] }));
    await expect(requestNets(obj, "A4", cfg, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(PapercraftError);
  });

  it("つながらないときは 502", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(requestNets(obj, "A4", cfg, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ status: 502 });
  });
});
