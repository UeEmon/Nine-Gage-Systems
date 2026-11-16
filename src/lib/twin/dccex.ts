// 実物の DCC-EX コマンドステーションとのつながり。
//
// USB（ブラウザの Web Serial。Chrome・Edge）か、Wi‑Fi（DCC-EX の WebSocket。ふつうは ws://<アドレス>:2560）でつなぐ。
// 文字の行き来だけを TextTransport に分けてあるので、テストでは偽物の transport を使う。

import { extractFrames, formatCommand, parseEvent, type TwinCommand, type TwinConnection, type TwinEvent } from "./protocol";

/** 文字を送り、届いた文字を受け取る道 */
export interface TextTransport {
  write(text: string): void;
  onText(cb: (chunk: string) => void): void;
  /** 切れたとき（相手が切った・ケーブルが抜けた）。reason は画面に出す説明 */
  onClose(cb: (reason: string | null) => void): void;
  close(): void;
}

/** つないだ直後に送る問い合わせ（状態・ポイントの一覧・センサーの状態・線路の電源） */
export const SYNC_COMMANDS = ["<s>", "<T>", "<Q>"];

export class DccExConnection implements TwinConnection {
  private listeners = new Set<(ev: TwinEvent) => void>();
  private closeListeners = new Set<(reason: string | null) => void>();
  private buffer = "";
  private cabs = new Set<number>();
  private closed = false;

  constructor(
    readonly label: string,
    private transport: TextTransport,
  ) {
    transport.onText((chunk) => this.feed(chunk));
    transport.onClose((reason) => {
      if (this.closed) return;
      this.closed = true;
      for (const l of this.closeListeners) l(reason);
    });
  }

  /** いまの状態を問い合わせる（つないだ直後と、取り直したいとき） */
  sync(): void {
    for (const c of SYNC_COMMANDS) this.transport.write(c);
  }

  /** 機関車の状態を知りたいアドレス（非常停止のときに止まったと知らせる相手） */
  watchCabs(cabs: number[]): void {
    for (const c of cabs) this.cabs.add(c);
  }

  send(cmd: TwinCommand): void {
    if (this.closed) return;
    this.transport.write(formatCommand(cmd));
    // 機関車の状態は、版や設定によっては返ってこない。送った値をそのまま反映しておく（返ってきたら上書きされる）
    if (cmd.type === "throttle") {
      this.cabs.add(cmd.cab);
      this.emit({ type: "loco", cab: cmd.cab, speed: cmd.speed, forward: cmd.forward });
    }
    if (cmd.type === "estop") for (const cab of this.cabs) this.emit({ type: "loco", cab, speed: 0, forward: true });
  }

  subscribe(listener: (ev: TwinEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(cb: (reason: string | null) => void): () => void {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.closeListeners.clear();
    this.transport.close();
  }

  /** 届いた文字を読む */
  feed(chunk: string): void {
    const { frames, rest } = extractFrames(this.buffer + chunk);
    // 区切りの > が来ないまま長くなったら捨てる（ノイズ）
    this.buffer = rest.length > 512 ? "" : rest;
    for (const f of frames) {
      const ev = parseEvent(f);
      if (!ev) continue;
      if (ev.type === "loco") this.cabs.add(ev.cab);
      this.emit(ev);
    }
  }

  private emit(ev: TwinEvent): void {
    for (const l of this.listeners) l(ev);
  }
}

// ---- USB（Web Serial） ----

type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};
type SerialLike = { requestPort(): Promise<SerialPortLike> };

function serialApi(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { serial?: SerialLike }).serial ?? null;
}

/** このブラウザで USB 接続（Web Serial）が使えるか */
export function serialSupported(): boolean {
  return serialApi() !== null;
}

/** DCC-EX の USB の速さ */
const BAUD_RATE = 115200;

/** USB でつなぐ。ブラウザがポートを選ぶ画面を出す（ボタンを押したときに呼ぶこと） */
export async function openSerialTransport(): Promise<TextTransport> {
  const serial = serialApi();
  if (!serial) throw new Error("このブラウザは USB 接続に対応していません。Chrome か Edge を使ってください");
  const port = await serial.requestPort();
  await port.open({ baudRate: BAUD_RATE });
  if (!port.readable || !port.writable) throw new Error("USB のポートを開けませんでした");
  const reader = port.readable.getReader();
  const writer = port.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let onText: (chunk: string) => void = () => {};
  let onClose: (reason: string | null) => void = () => {};
  let closing = false;

  void (async () => {
    let reason: string | null = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) onText(decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if (!closing) reason = `USB の接続が切れました（${err instanceof Error ? err.message : String(err)}）`;
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      await port.close().catch(() => {});
      onClose(closing ? null : (reason ?? "USB の接続が切れました"));
    }
  })();

  return {
    write: (text) => {
      writer.write(encoder.encode(text)).catch(() => {});
    },
    onText: (cb) => (onText = cb),
    onClose: (cb) => (onClose = cb),
    close: () => {
      closing = true;
      reader.cancel().catch(() => {});
    },
  };
}

// ---- Wi‑Fi（WebSocket） ----

/** Wi‑Fi でつなぐ。つながるまで待つ */
export function openWebSocketTransport(url: string, timeoutMs = 8000): Promise<TextTransport> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(new Error(`アドレスが正しくありません（${err instanceof Error ? err.message : String(err)}）`));
      return;
    }
    let onText: (chunk: string) => void = () => {};
    let onClose: (reason: string | null) => void = () => {};
    let opened = false;
    let closing = false;
    const timer = setTimeout(() => {
      if (!opened) {
        ws.close();
        reject(new Error("つながりませんでした（時間切れ）。アドレスと、同じ Wi‑Fi につながっているかを確かめてください"));
      }
    }, timeoutMs);
    ws.onopen = () => {
      opened = true;
      clearTimeout(timer);
      resolve({
        write: (text) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(text);
        },
        onText: (cb) => (onText = cb),
        onClose: (cb) => (onClose = cb),
        close: () => {
          closing = true;
          ws.close();
        },
      });
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") onText(e.data);
      else if (e.data instanceof Blob) void e.data.text().then((t) => onText(t));
    };
    ws.onerror = () => {
      if (!opened) {
        clearTimeout(timer);
        reject(new Error("つながりませんでした。アドレスと、同じ Wi‑Fi につながっているかを確かめてください"));
      }
    };
    ws.onclose = () => {
      if (opened) onClose(closing ? null : "Wi‑Fi の接続が切れました");
    };
  });
}
