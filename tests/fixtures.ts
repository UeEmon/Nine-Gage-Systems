import type { LayoutPlan } from "../src/lib/plan";

export const p = (part: string, dir: "L" | "R" = "L", enter = 0, exit = 1) => ({ part, dir, enter, exit });

export function sidingPlan(): LayoutPlan {
  const C = p("R249-45", "R");
  return {
    title: "待避線付きエンドレス",
    description: "",
    start: { x: 300, y: 120, heading: 0 },
    segments: [
      {
        from: null,
        pieces: [p("TO6", "L"), p("S248"), p("S124"), p("TO6", "R", 1, 0), C, C, C, C,
          p("S186"), p("S248"), p("S186"), p("S124"), C, C, C, C],
      },
      { from: { segment: 0, piece: 0, joint: 2 }, pieces: [p("R718-15", "R"), p("R718-15", "R")] },
    ],
  };
}

