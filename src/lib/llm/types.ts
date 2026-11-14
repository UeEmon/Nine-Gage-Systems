export const PROVIDERS = ["anthropic", "openai", "gemini", "local"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
  gemini: "Gemini (Google)",
  local: "ローカルLLM (OpenAI互換API)",
};

/** 初期値。画面やサーバーの環境変数で変更できる */
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5",
  gemini: "gemini-2.5-pro",
  local: "llama3.1",
};

export const DEFAULT_LOCAL_BASE_URL = "http://localhost:11434/v1";

/** 画面から送られるAI設定（空欄はサーバー側の設定を使う） */
export type AiSettings = {
  provider: ProviderId;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
};

/** サーバー側で環境変数と合わせて確定した設定 */
export type ResolvedAiSettings = {
  provider: ProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
};

export type AskResult = {
  /** 構造化出力として解釈できたJSON（失敗時 null） */
  json: unknown | null;
  /** 生のテキスト（デバッグ・エラー表示用） */
  text: string;
  refused?: boolean;
  truncated?: boolean;
  /** この1回の呼び出しで使ったトークン（分かるプロバイダのみ） */
  usage?: TokenUsage;
};

/**
 * 使ったトークンの内訳。inputTokens はキャッシュを使わなかった入力だけを数える
 * （キャッシュから読んだ分・書き込んだ分は別に数える）。
 */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export const emptyUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export function addUsage(a: TokenUsage, b?: TokenUsage): TokenUsage {
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** 1回の提案のあいだ会話履歴を保持し、追記していくセッション */
export interface ChatSession {
  ask(userText: string): Promise<AskResult>;
}

export type SessionOptions = {
  system: string;
  /** 出力の zod スキーマ（Claude の構造化出力で使う） */
  zodSchema: import("zod").ZodType;
  /** 出力のJSON Schema */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  /**
   * 応答が始まったとき（入力の読み込みが終わり、プロンプトキャッシュが読めるようになったとき）に呼ぶ。
   * 同じシステムプロンプトで複数案を出すとき、2つ目以降をこの後に送るとキャッシュを読める。
   */
  onResponseStart?: () => void;
};

/** プロバイダごとの失敗を画面向けに分類したエラー */
export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
