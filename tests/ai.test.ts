import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { proposeLayout, sessionOptions } from "../src/lib/ai";
import { resolveSettings, serverAiInfo, toLlmError } from "../src/lib/llm";
import { createAnthropicSession } from "../src/lib/llm/anthropic";
import { createGeminiSession } from "../src/lib/llm/gemini";
import { extractJson } from "../src/lib/llm/json";
import { createOpenAiSession } from "../src/lib/llm/openai";
import type { ChatSession } from "../src/lib/llm/types";
import { sidingPlan } from "./fixtures";

const board = { width: 1400, height: 800 };

function fakeSession(outputs: unknown[]) {
  const prompts: string[] = [];
  const session: ChatSession = {
    ask: vi.fn(async (text: string) => {
      prompts.push(text);
      const json = outputs.shift() ?? null;
      return { json, text: JSON.stringify(json) };
    }),
  };
  return { session, prompts };
}

describe("proposeLayout (provider independent loop)", () => {
  it("returns immediately when the first plan is valid", async () => {
    const { session, prompts } = fakeSession([sidingPlan()]);
    const res = await proposeLayout({ board, request: "待避線" }, session, "m");
    expect(prompts).toHaveLength(1);
    expect(res.remainingProblems).toBeNull();
    expect(res.pieces.length).toBe(18);
  });

  it("feeds geometry problems back and retries", async () => {
    const broken = sidingPlan();
    broken.segments[0].pieces.pop();
    const { session, prompts } = fakeSession([broken, sidingPlan()]);
    const res = await proposeLayout({ board, request: "待避線" }, session, "m");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("つながっていない端");
    expect(res.attempts).toBe(2);
    expect(res.remainingProblems).toBeNull();
  });

  it("asks again when the JSON does not match the schema", async () => {
    const { session, prompts } = fakeSession([{ title: "x" }, sidingPlan()]);
    const res = await proposeLayout({ board, request: "" }, session, "m");
    expect(prompts[1]).toContain("JSON形式に合いませんでした");
    expect(res.remainingProblems).toBeNull();
  });

  it("in owned mode, lists the owned parts and retries when a part is over-used", async () => {
    const { stockFromInventory } = await import("../src/lib/productDb");
    // R718-15 は1箱(4本)、TO6 は左右1つずつ、直線・曲線は十分ある
    const counts = stockFromInventory({
      "kato:20-202": 1, "kato:20-203": 1, "kato:20-150": 1, "kato:20-100": 2,
      "kato:20-000": 1, "kato:20-010": 1, "kato:20-020": 1,
    });
    const tooMany = sidingPlan();
    tooMany.segments[0].pieces.splice(1, 0, { part: "TO6", dir: "L", enter: 0, exit: 1 });
    const { session, prompts } = fakeSession([tooMany, sidingPlan()]);
    const res = await proposeLayout({ board, request: "", stock: { counts, mode: "owned" } }, session, "m");
    expect(prompts[0]).toContain("使える部品");
    expect(prompts[0]).toContain("TO6 dir=L: 1本");
    expect(prompts[1]).toContain("部品不足: TO6 dir=L を2本");
    expect(res.remainingProblems).toBeNull();
  });

  it("with a budget, passes unit prices and retries plans that cost too much", async () => {
    const circle = {
      title: "円",
      description: "",
      start: { x: 600, y: 100, heading: 0 },
      segments: [{ from: null, pieces: Array(8).fill({ part: "R249-45", dir: "R", enter: 0, exit: 1 }) }],
    };
    const { session, prompts } = fakeSession([sidingPlan(), circle]);
    const res = await proposeLayout({ board, request: "", budgetJpy: 2500 }, session, "m");
    expect(prompts[0]).toContain("2,500円以内");
    expect(prompts[0]).toMatch(/R249-45: 約248円\/本/);
    expect(prompts[1]).toContain("予算超過");
    expect(res.remainingProblems).toBeNull();
    expect(res.plan.title).toBe("円");
  });

  it("does not charge for owned parts when checking the budget", async () => {
    const { stockFromInventory } = await import("../src/lib/productDb");
    const counts = stockFromInventory({
      "kato:20-202": 1, "kato:20-203": 1, "kato:20-150": 1, "kato:20-100": 2,
      "kato:20-000": 1, "kato:20-010": 1, "kato:20-020": 1,
    });
    const { session, prompts } = fakeSession([sidingPlan()]);
    const res = await proposeLayout({ board, request: "", budgetJpy: 0, stock: { counts, mode: "expand" } }, session, "m");
    expect(prompts).toHaveLength(1);
    expect(res.remainingProblems).toBeNull();
  });

  it("fails clearly when no attempt yields a plan", async () => {
    const { session } = fakeSession([null, null, null, null]);
    await expect(proposeLayout({ board, request: "" }, session, "tiny-model")).rejects.toThrow(/tiny-model/);
  });
});

describe("settings", () => {
  it("uses server env keys and defaults", () => {
    const s = resolveSettings({ provider: "openai" }, { OPENAI_API_KEY: "k", OPENAI_MODEL: "my-model" });
    expect(s).toEqual({ provider: "openai", model: "my-model", apiKey: "k", baseUrl: undefined });
  });

  it("lets the screen override model and key", () => {
    const s = resolveSettings({ provider: "gemini", model: "g", apiKey: "user" }, { GEMINI_API_KEY: "server" });
    expect(s.apiKey).toBe("user");
    expect(s.model).toBe("g");
  });

  it("requires a key except for local LLMs", () => {
    expect(() => resolveSettings({ provider: "anthropic" }, {})).toThrow(/APIキー/);
    expect(resolveSettings({ provider: "local" }, {}).baseUrl).toBe("http://localhost:11434/v1");
  });

  it("blocks custom base URLs in production unless allowed", () => {
    const input = { provider: "local" as const, baseUrl: "http://10.0.0.5:1234/v1" };
    expect(() => resolveSettings(input, { NODE_ENV: "production" })).toThrow(/許可されていません/);
    expect(resolveSettings(input, { NODE_ENV: "production", AI_ALLOW_CUSTOM_BASE_URL: "true" }).baseUrl).toBe(
      input.baseUrl,
    );
    expect(() => resolveSettings({ provider: "local", baseUrl: "file:///etc" }, {})).toThrow(/http/);
  });

  it("reports which providers have server keys without exposing them", () => {
    const info = serverAiInfo({ OPENAI_API_KEY: "secret" });
    expect(info.providers.openai.hasServerKey).toBe(true);
    expect(info.providers.anthropic.hasServerKey).toBe(false);
    expect(JSON.stringify(info)).not.toContain("secret");
  });

  it("maps connection errors to a readable message", () => {
    const e = toLlmError(Object.assign(new Error("Connection error."), {}), {
      provider: "local",
      model: "m",
      baseUrl: "http://localhost:1/v1",
    });
    expect(e.status).toBe(502);
    expect(e.message).toContain("接続できません");
  });
});

describe("extractJson", () => {
  it("reads fenced or surrounded JSON", () => {
    expect(extractJson('はい\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('結果: {"a":{"b":2}} です')).toEqual({ a: { b: 2 } });
    expect(extractJson("no json")).toBeNull();
  });
});

describe("Claude adapter", () => {
  it("sends structured output request and keeps history append-only", async () => {
    const plan = sidingPlan();
    const parse = vi.fn(async () => ({
      stop_reason: "end_turn",
      parsed_output: plan,
      content: [{ type: "text", text: JSON.stringify(plan) }],
    }));
    const client = { beta: { messages: { parse } } } as unknown as Anthropic;
    const session = createAnthropicSession({ provider: "anthropic", model: "claude-opus-5-5" }, sessionOptions(), client);
    await session.ask("1");
    await session.ask("2");
    const req = (parse.mock.calls[1] as unknown as [Record<string, unknown>])[0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.fallbacks).toBe("default");
    expect((req.messages as unknown[]).length).toBe(4);
  });
});

// ---- 実際のHTTPで、OpenAI互換サーバーとGeminiの模擬サーバーに対して動かす ----

type Handler = (path: string, body: Record<string, unknown>) => { status?: number; json: unknown };
let server: Server;
let baseUrl = "";
let handler: Handler = () => ({ json: {} });
const requests: { path: string; body: Record<string, unknown> }[] = [];

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({ path: req.url ?? "", body });
    const out = handler(req.url ?? "", body);
    res.writeHead(out.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(out.json));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const chatReply = (content: string) => ({
  id: "x",
  object: "chat.completion",
  created: 0,
  model: "m",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, refusal: null } }],
});

describe("OpenAI-compatible adapter (local LLM)", () => {
  it("uses json_schema response_format and parses the reply", async () => {
    requests.length = 0;
    handler = () => ({ json: chatReply(JSON.stringify(sidingPlan())) });
    const session = createOpenAiSession(
      { provider: "local", model: "qwen", baseUrl: `${baseUrl}/v1`, apiKey: undefined },
      sessionOptions(),
    );
    const res = await proposeLayout({ board, request: "待避線" }, session, "qwen");
    expect(res.remainingProblems).toBeNull();
    const body = requests[0].body as { model: string; response_format: { type: string }; messages: { role: string }[] };
    expect(requests[0].path).toBe("/v1/chat/completions");
    expect(body.model).toBe("qwen");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[0].role).toBe("system");
  });

  it("falls back to plain JSON instructions when the server rejects json_schema", async () => {
    requests.length = 0;
    handler = (_p, body) =>
      body.response_format
        ? { status: 400, json: { error: { message: "response_format not supported" } } }
        : { json: chatReply("```json\n" + JSON.stringify(sidingPlan()) + "\n```") };
    const session = createOpenAiSession(
      { provider: "local", model: "llama", baseUrl: `${baseUrl}/v1` },
      { ...sessionOptions() },
    );
    const answer = await session.ask("要望");
    expect(answer.json).toEqual(sidingPlan());
    expect(requests).toHaveLength(2);
    const second = requests[1].body as { messages: { content: string }[] };
    expect(second.messages[1].content).toContain("JSON Schema");
  });

  it("sends strict schema to OpenAI", async () => {
    requests.length = 0;
    handler = () => ({ json: chatReply(JSON.stringify(sidingPlan())) });
    const session = createOpenAiSession(
      { provider: "openai", model: "gpt-x", apiKey: "k", baseUrl: `${baseUrl}/v1` },
      sessionOptions(),
    );
    await session.ask("要望");
    const body = requests[0].body as { response_format: { json_schema: { strict: boolean; schema: object } } };
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(JSON.stringify(body.response_format.json_schema.schema)).not.toContain("$schema");
  });
});

describe("Gemini adapter", () => {
  it("calls generateContent with a JSON schema and keeps model turns", async () => {
    requests.length = 0;
    handler = () => ({
      json: {
        candidates: [
          {
            content: { role: "model", parts: [{ text: JSON.stringify(sidingPlan()) }] },
            finishReason: "STOP",
          },
        ],
      },
    });
    const session = createGeminiSession(
      { provider: "gemini", model: "gemini-test", apiKey: "k", baseUrl },
      sessionOptions(),
    );
    const first = await session.ask("1");
    expect(first.json).toEqual(sidingPlan());
    await session.ask("2");
    expect(requests[0].path).toContain("models/gemini-test:generateContent");
    const body = requests[1].body as {
      contents: { role: string }[];
      generationConfig: { responseMimeType: string; responseJsonSchema: object };
    };
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toBeTruthy();
  });
});
