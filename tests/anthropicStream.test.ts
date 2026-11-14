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

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const text = JSON.stringify(sidingPlan());
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
        ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 321 } }) +
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
});
