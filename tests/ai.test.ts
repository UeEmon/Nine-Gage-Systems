import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { proposeLayout } from "../src/lib/ai";
import { sidingPlan } from "./fixtures";

function fakeClient(outputs: unknown[]) {
  const parse = vi.fn(async () => {
    const parsed_output = outputs.shift();
    return { stop_reason: "end_turn", parsed_output, content: [{ type: "text", text: JSON.stringify(parsed_output) }] };
  });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe("proposeLayout", () => {
  const board = { width: 1400, height: 800 };

  it("returns immediately when the first plan is valid", async () => {
    const { client, parse } = fakeClient([sidingPlan()]);
    const res = await proposeLayout({ board, request: "待避線" }, client);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(res.remainingProblems).toBeNull();
    expect(res.pieces.length).toBe(18);
  });

  it("feeds problems back to the model and retries", async () => {
    const broken = sidingPlan();
    broken.segments[0].pieces.pop();
    const { client, parse } = fakeClient([broken, sidingPlan()]);
    const res = await proposeLayout({ board, request: "待避線" }, client);
    expect(parse).toHaveBeenCalledTimes(2);
    const second = (parse.mock.calls[1] as unknown as [{ messages: { role: string; content: unknown }[] }])[0];
    expect(second.messages).toHaveLength(3);
    expect(String(second.messages[2].content)).toContain("つながっていない端");
    expect(res.remainingProblems).toBeNull();
    expect(res.attempts).toBe(2);
  });
});
