import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionOptions } from "../src/lib/ai";
import { createAnthropicSession } from "../src/lib/llm/anthropic";
import { sidingPlan } from "./fixtures";

// 実際のSDKでストリーミングを受け、構造化出力とトークン数を取り出せることを確かめる（模擬サーバー）
let server: Server;
let baseURL = "";
const bodies: Record<string, unknown>[] = [];
// 次の応答を差し替える（空なら正常な計画を返す）
const nextResponses: { text: string; stopReason: string }[] = [];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const next = nextResponses.shift() ?? { text: JSON.stringify(sidingPlan()), stopReason: "end_turn" };
    const text = next.text;
    const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      ev("message_start", {
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 40, output_tokens: 1, cache_read_input_tokens: 8000, cache_creation_input_tokens: 200 },
        },
      }) +
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }) +
        ev("content_block_stop", { index: 0 }) +
        ev("message_delta", { delta: { stop_reason: next.stopReason, stop_sequence: null }, usage: { output_tokens: 321 } }) +
        ev("message_stop", {}),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

describe("Claude adapter over HTTP streaming", () => {
  it("parses the plan, reports usage and sends cache markers", async () => {
    let started = 0;
    const session = createAnthropicSession(
      { provider: "anthropic", model: "claude-opus-5-5", apiKey: "test", baseUrl: baseURL },
      { ...sessionOptions(), onResponseStart: () => started++ },
      undefined,
      {},
    );
    const r = await session.ask("1");
    expect(r.json).toMatchObject({ title: sidingPlan().title });
    expect(started).toBe(1);
    expect(r.usage).toEqual({ inputTokens: 40, outputTokens: 321, cacheReadTokens: 8000, cacheWriteTokens: 200 });
    expect(bodies[0].stream).toBe(true);
    expect(bodies[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("reports a cut-off answer as truncated instead of throwing, and resends the request", async () => {
    bodies.length = 0;
    const full = JSON.stringify(sidingPlan());
    nextResponses.push({ text: full.slice(0, full.indexOf(":") + 1), stopReason: "max_tokens" });
    const session = createAnthropicSession(
      { provider: "anthropic", model: "claude-opus-5-5", apiKey: "test", baseUrl: baseURL },
      sessionOptions(),
      undefined,
      {},
    );
    const r1 = await session.ask("待避線のあるレイアウト");
    expect(r1.json).toBeNull();
    expect(r1.truncated).toBe(true);

    // 切れた応答は履歴に残さず、元の依頼を付けて出し直す
    const r2 = await session.ask("出力が長すぎて途中で切れました。");
    expect(r2.json).toMatchObject({ title: sidingPlan().title });
    const messages = bodies[1].messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("待避線のあるレイアウト");
    expect(messages[0].content).toContain("出力が長すぎて途中で切れました。");
  });

  it("returns null for an empty answer instead of throwing", async () => {
    nextResponses.push({ text: "", stopReason: "end_turn" });
    const session = createAnthropicSession(
      { provider: "anthropic", model: "claude-opus-5-5", apiKey: "test", baseUrl: baseURL },
      sessionOptions(),
      undefined,
      {},
    );
    const r = await session.ask("1");
    expect(r.json).toBeNull();
    expect(r.truncated).toBe(false);
  });
});
