"use client";

import { useEffect, useState } from "react";
import { api, ROLE_LABELS } from "@/lib/roles";
import { DEFAULT_LOCAL_BASE_URL, PROVIDER_LABELS, PROVIDERS, type ProviderId } from "@/lib/llm/types";

type ProviderView = {
  model: string;
  baseUrl: string;
  savedKey: string | null;
  envKey: boolean;
  defaultModel: string;
  defaultBaseUrl: string;
};
type View = { provider: ProviderId; providers: Record<ProviderId, ProviderView> };

/** 入力中の値。apiKey は空なら「変えない」 */
type Draft = { model: string; baseUrl: string; apiKey: string; clearKey: boolean };

const emptyDraft = (v?: ProviderView): Draft => ({ model: v?.model ?? "", baseUrl: v?.baseUrl ?? "", apiKey: "", clearKey: false });

/** 管理者だけが使うAI設定。全員のAI提案はこの設定で動く */
export function AdminAiPanel() {
  const [view, setView] = useState<View | null>(null);
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, Draft>>>({});
  const [models, setModels] = useState<string[]>([]);
  const [state, setState] = useState<{ busy?: string; error?: string; saved?: boolean }>({});

  const load = (v: View) => {
    setView(v);
    setProvider(v.provider);
    setDrafts(Object.fromEntries(PROVIDERS.map((p) => [p, emptyDraft(v.providers[p])])));
  };

  useEffect(() => {
    api<View>("/api/admin/ai", "GET")
      .then(load)
      .catch((err) => setState({ error: String(err.message ?? err) }));
  }, []);

  if (!view) {
    return (
      <section className="card">
        <h2>AI設定</h2>
        {state.error ? <p className="error">{state.error}</p> : <p className="hint">読み込み中…</p>}
      </section>
    );
  }

  const pv = view.providers[provider];
  const d = drafts[provider] ?? emptyDraft(pv);
  const set = (patch: Partial<Draft>) => {
    setDrafts({ ...drafts, [provider]: { ...d, ...patch } });
    setState({});
  };
  const change = () => ({
    model: d.model,
    baseUrl: d.baseUrl,
    ...(d.clearKey ? { apiKey: "" } : d.apiKey ? { apiKey: d.apiKey } : {}),
  });

  const save = async () => {
    setState({ busy: "save" });
    try {
      const v = await api<View>("/api/admin/ai", "PUT", { provider, byProvider: { [provider]: change() } });
      load(v);
      setState({ saved: true });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const fetchModels = async () => {
    setState({ busy: "models" });
    try {
      const r = await api<{ models: string[] }>("/api/models", "POST", { provider, change: change() });
      setModels(r.models);
      setState({});
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const keyNote = pv.savedKey
    ? `保存済みのキー ${pv.savedKey}`
    : pv.envKey
      ? "サーバーの環境変数のキーを使用中"
      : provider === "local"
        ? "キーは不要なことが多いです"
        : "キーが未設定です（AI提案が使えません）";
  const showBaseUrl = provider !== "anthropic";

  return (
    <section className="card form">
      <h2>AI設定（全員のAI提案に使われます）</h2>
      <p className="hint">
        いま使っているAI: <strong>{PROVIDER_LABELS[view.provider]}</strong>。管理者と{ROLE_LABELS.ai}のAI提案にこの設定を使います（「一般」のユーザーは自分のAPIキー）。ほかのユーザーにはキーやURLは見えません。
      </p>
      <label>
        プロバイダ
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as ProviderId);
            setModels([]);
            setState({});
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
              {p === view.provider ? "（使用中）" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        モデル
        <div className="input-row">
          <input list="admin-models" value={d.model} placeholder={pv.defaultModel} onChange={(e) => set({ model: e.target.value })} />
          <button type="button" onClick={fetchModels} disabled={!!state.busy}>
            {state.busy === "models" ? "取得中…" : "一覧"}
          </button>
        </div>
        <datalist id="admin-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {models.length > 0 && <span className="muted">{models.length}件のモデルから選べます</span>}
      </label>
      <label>
        APIキー
        <input
          type="password"
          autoComplete="off"
          value={d.apiKey}
          disabled={d.clearKey}
          placeholder={pv.savedKey ? "変えないときは空欄" : "キーを入力"}
          onChange={(e) => set({ apiKey: e.target.value })}
        />
        <span className="muted">{keyNote}</span>
        {pv.savedKey && (
          <span className="check">
            <input type="checkbox" checked={d.clearKey} onChange={(e) => set({ clearKey: e.target.checked, apiKey: "" })} />
            保存済みのキーを削除する
          </span>
        )}
      </label>
      {showBaseUrl && (
        <label>
          接続先URL{provider !== "local" && "（任意）"}
          <input
            value={d.baseUrl}
            placeholder={provider === "local" ? pv.defaultBaseUrl || DEFAULT_LOCAL_BASE_URL : "空欄なら公式API"}
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
          {provider === "local" && (
            <span className="muted">このサーバーから届くURLです。コンテナの中の localhost はコンテナ自身を指します。</span>
          )}
        </label>
      )}
      {state.error && <p className="error">{state.error}</p>}
      {state.saved && <p className="ok-text">保存しました。このプロバイダを全員のAI提案に使います。</p>}
      <button className="primary" type="button" onClick={save} disabled={!!state.busy}>
        {state.busy === "save" ? "保存中…" : "保存して、このプロバイダを使う"}
      </button>
    </section>
  );
}
