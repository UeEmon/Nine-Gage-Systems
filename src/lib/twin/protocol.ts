// 実物のレイアウト（実機）とアプリのあいだでやりとりする出来事（イベント）と操作（コマンド）。
//
// 実機からは「センサーに列車が乗った・離れた」「ポイントが切り替わった」「機関車の速度が変わった」「線路の電源」が届く。
// アプリからは「ポイントを切り替える」「機関車の速度を変える」「非常停止」「線路の電源」を送る。
// 文字の形は DCC-EX（Arduino で作るオープンソースのコマンドステーション）に合わせてある。
// いまは模擬の実機（simulator.ts）だけがつながるが、実機につなぐときもこの型のまま差し替える。

export type TwinEvent =
  | { type: "sensor"; id: number; active: boolean }
  | { type: "turnout"; id: number; thrown: boolean }
  | { type: "loco"; cab: number; speed: number; forward: boolean }
  | { type: "power"; on: boolean };

export type TwinCommand =
  | { type: "turnout"; id: number; thrown: boolean }
  | { type: "throttle"; cab: number; speed: number; forward: boolean }
  | { type: "estop" }
  | { type: "power"; on: boolean };

/** 実機とのつながり（模擬でも実機でも同じ形） */
export interface TwinConnection {
  /** 画面に出す名前（例: 模擬の実機） */
  readonly label: string;
  send(cmd: TwinCommand): void;
  /** 出来事を受け取る。戻り値で受け取りをやめる */
  subscribe(listener: (ev: TwinEvent) => void): () => void;
  close(): void;
}

/** DCC の速度段（0 = 停止, 1〜126） */
export const MAX_SPEED_STEP = 126;

// ---- DCC-EX の文字の形 ----

/** アプリからの操作を DCC-EX のコマンド文字列にする */
export function formatCommand(cmd: TwinCommand): string {
  switch (cmd.type) {
    case "turnout":
      return `<T ${cmd.id} ${cmd.thrown ? 1 : 0}>`;
    case "throttle":
      return `<t ${cmd.cab} ${clampSpeed(cmd.speed)} ${cmd.forward ? 1 : 0}>`;
    case "estop":
      return "<!>";
    case "power":
      return cmd.on ? "<1>" : "<0>";
  }
}

/** 実機からの出来事を DCC-EX の応答の文字列にする（模擬の実機と記録の表示に使う） */
export function formatEvent(ev: TwinEvent): string {
  switch (ev.type) {
    case "sensor":
      return ev.active ? `<Q ${ev.id}>` : `<q ${ev.id}>`;
    case "turnout":
      return `<H ${ev.id} ${ev.thrown ? 1 : 0}>`;
    case "loco": {
      // 速度の1バイト: 最上位ビットが前進。0 = 停止、1 = 非常停止、2〜127 = 速度段 1〜126
      const s = clampSpeed(ev.speed);
      const byte = (ev.forward ? 128 : 0) + (s === 0 ? 0 : s + 1);
      return `<l ${ev.cab} 0 ${byte} 0>`;
    }
    case "power":
      return ev.on ? "<p1>" : "<p0>";
  }
}

/** DCC-EX の応答の文字列を出来事にする。知らない形なら null */
export function parseEvent(text: string): TwinEvent | null {
  const m = /^<\s*([A-Za-z])\s*([^>]*)>$/.exec(text.trim());
  if (!m) return null;
  const op = m[1];
  const args = m[2].trim() === "" ? [] : m[2].trim().split(/\s+/).map(Number);
  if (args.some((n) => !Number.isFinite(n))) return null;
  switch (op) {
    case "Q":
    case "q":
      return args.length === 1 ? { type: "sensor", id: args[0], active: op === "Q" } : null;
    case "H":
      return args.length >= 2 ? { type: "turnout", id: args[0], thrown: args[1] !== 0 } : null;
    case "l": {
      if (args.length < 3) return null;
      const byte = args[2];
      const raw = byte & 127;
      return { type: "loco", cab: args[0], speed: raw <= 1 ? 0 : raw - 1, forward: (byte & 128) !== 0 };
    }
    case "p":
      return args.length >= 1 ? { type: "power", on: args[0] !== 0 } : null;
    default:
      return null;
  }
}

function clampSpeed(s: number): number {
  return Math.max(0, Math.min(MAX_SPEED_STEP, Math.round(s)));
}
