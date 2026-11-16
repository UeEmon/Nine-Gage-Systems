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

/**
 * DCC-EX の応答の文字列を出来事にする。知らない形なら null。
 * 版によって後ろに語が付く形（`<p1 MAIN>`、`<H 1 DCC 5 0 1>` など）も読む。
 */
export function parseEvent(text: string): TwinEvent | null {
  const m = /^<\s*([A-Za-z])\s*([^>]*)>$/.exec(text.trim());
  if (!m) return null;
  const op = m[1];
  const tokens = m[2].trim() === "" ? [] : m[2].trim().split(/\s+/);
  const nums = tokens.map(Number);
  const isInt = (i: number) => i < nums.length && Number.isInteger(nums[i]);
  switch (op) {
    case "Q":
    case "q":
      // <Q id>（状態）。<Q id pin pullup> はセンサーの定義なので読まない
      return tokens.length === 1 && isInt(0) ? { type: "sensor", id: nums[0], active: op === "Q" } : null;
    case "H": {
      // <H id state>、または <H id DCC addr sub state> のように状態が最後に来る形
      const last = nums.length - 1;
      return nums.length >= 2 && isInt(0) && isInt(last) ? { type: "turnout", id: nums[0], thrown: nums[last] !== 0 } : null;
    }
    case "l": {
      if (!(isInt(0) && isInt(2))) return null;
      const byte = nums[2];
      const raw = byte & 127;
      return { type: "loco", cab: nums[0], speed: raw <= 1 ? 0 : raw - 1, forward: (byte & 128) !== 0 };
    }
    case "p":
      return isInt(0) ? { type: "power", on: nums[0] !== 0 } : null;
    default:
      return null;
  }
}

/** 届いた文字の並びから `<...>` の形をすべて取り出す。途中で切れている分は rest に残す */
export function extractFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let i = 0;
  for (;;) {
    const open = buffer.indexOf("<", i);
    if (open < 0) return { frames, rest: "" };
    const close = buffer.indexOf(">", open);
    if (close < 0) return { frames, rest: buffer.slice(open) };
    // 閉じる前に次の < があれば、前の分は壊れているので捨てる
    const next = buffer.indexOf("<", open + 1);
    if (next >= 0 && next < close) {
      i = next;
      continue;
    }
    frames.push(buffer.slice(open, close + 1));
    i = close + 1;
  }
}

function clampSpeed(s: number): number {
  return Math.max(0, Math.min(MAX_SPEED_STEP, Math.round(s)));
}
