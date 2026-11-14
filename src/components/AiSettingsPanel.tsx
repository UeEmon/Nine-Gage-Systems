"use client";

import { useEffect, useState } from "react";
import { DEFAULT_LOCAL_BASE_URL, PROVIDER_LABELS, PROVIDERS, type AiSettings, type ProviderId } from "@/lib/llm/types";

const STORAGE_KEY = "nine-gage-ai-settings-v1";

type ServerInfo = {
  defaultProvider: ProviderId;
  allowCustomBaseUrl: boolean;
  providers: Record<ProviderId, { hasServerKey: boolean; defaultModel: string; hasServerBaseUrl: boolean }>;
};

/** プロバイダごとに入力を覚えておき、切り替えても消えないようにする */
type Stored = { provider: ProviderId; byProvider: Partial<Record<ProviderId, Omit<AiSettings, "provider">>> };

export function useAiSettings() {
  const [stored, setStored] = useState<Stored>({ provider: "anthropic", byProvider: {} });
  const [info, setInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    let saved: Stored | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw) as Stored;
    } catch {
      /* 保存なし */
    }
    if (saved && PROVIDERS.includes(saved.provider)) setStored(saved);
    fetch("/api/ai-config")
      .then((r) => r.json())
      .then((i: ServerInfo) => {
        setInfo(i);
        if (!saved) setStored((s) => ({ ...s, provider: i.defaultProvider }));
      })
      .catch(() => {});
  }, []);

  const update = (next: Stored) => {
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* 保存できない環境 */
    }
  };

  const current = stored.byProvider[stored.provider] ?? {};
  const settings: AiSettings = {
    provider: stored.provider,
    model: current.model || undefined,
    apiKey: current.apiKey || undefined,
    baseUrl: current.baseUrl || undefined,
  };
  return { stored, update, settings, info };
}

type Props = ReturnType<typeof useAiSettings>;

export function AiSettingsPanel({ stored, update, settings, info }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [listState, setListState] = useState<{ loading: boolean; error?: string }>({ loading: false });
  const p = stored.provider;
  const cur = stored.byProvider[p] ?? {};
  const pinfo = info?.providers[p];
  // サーバーにキーがなければ最初から開いておく（以降は利用者の開閉に従う）
  const [open, setOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (info && !autoOpened) {
      setAutoOpened(true);
      if (!pinfo?.hasServerKey && p !== "local") setOpen(true);
    }
  }, [info, autoOpened, pinfo, p]);

  const set = (patch: Partial<Omit<AiSettings, "provider">>) =>
    update({ ...stored, byProvider: { ...stored.byProvider, [p]: { ...cur, ...patch } } });

  const fetchModels = async () => {
    setListState({ loading: true });
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai: settings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setModels(data.models);
      setListState({ loading: false });
    } catch (err) {
      setListState({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const showBaseUrl = p === "local" || p === "openai" || p === "gemini";
  const baseUrlLocked = info ? !info.allowCustomBaseUrl : false;

  return (
    <details
      className="ai-settings"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        AI設定: <strong>{PROVIDER_LABELS[p]}</strong>
        <span className="muted"> / {settings.model ?? pinfo?.defaultModel ?? ""}</span>
      </summary>
      <div className="form">
        <label>
          プロバイダ
          <select
            value={p}
            onChange={(e) => {
              update({ ...stored, provider: e.target.value as ProviderId });
              setModels([]);
              setListState({ loading: false });
            }}
          >
            {PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </option>
            ))}
          </select>
        </label>

        <label>
          モデル
          <div className="input-row">
            <input
              list="ai-models"
              value={cur.model ?? ""}
              placeholder={pinfo?.defaultModel ?? ""}
              onChange={(e) => set({ model: e.target.value })}
            />
            <button type="button" onClick={fetchModels} disabled={listState.loading}>
              {listState.loading ? "取得中…" : "一覧"}
            </button>
          </div>
          <datalist id="ai-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {listState.error && <span className="error">{listState.error}</span>}
          {models.length > 0 && <span className="muted">{models.length}件のモデルから選べます</span>}
        </label>

        <label>
          APIキー
          <input
            type="password"
            autoComplete="off"
            value={cur.apiKey ?? ""}
            placeholder={
              pinfo?.hasServerKey ? "空欄ならサーバーのキーを使用" : p === "local" ? "不要なら空欄" : "キーを入力"
            }
            onChange={(e) => set({ apiKey: e.target.value })}
          />
        </label>

        {showBaseUrl && (
          <label>
            接続先URL{p !== "local" && "（任意）"}
            <input
              value={cur.baseUrl ?? ""}
              disabled={baseUrlLocked}
              placeholder={
                baseUrlLocked
                  ? "サーバー側の設定を使用"
                  : p === "local"
                    ? `${DEFAULT_LOCAL_BASE_URL}（Ollama）`
                    : "空欄なら公式API"
              }
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </label>
        )}

        <p className="hint">
          {p === "local"
            ? "Ollama・LM Studio・vLLM など OpenAI 互換APIを持つサーバーに接続します。LM Studio は http://localhost:1234/v1。URLはこのアプリのサーバーから見た場所です。"
            : "入力したキーはこのブラウザにだけ保存され、AI呼び出しのときにこのアプリのサーバーへ送られます。"}
        </p>
      </div>
    </details>
  );
}
