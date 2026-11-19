"use client";

import { useEffect, useState } from "react";
import { api, ROLE_LABELS } from "@/lib/roles";
import { ModelSelect } from "./ModelSelect";
import { DEFAULT_LOCAL_BASE_URL, PROVIDER_LABELS, PROVIDERS, type ProviderId } from "@/lib/llm/types";

type ProviderView = {
  model: string;
  baseUrl: string;
  savedKey: string | null;
  envKey: boolean;
  defaultModel: string;
  defaultBaseUrl: string;
};
type View = {
  provider: ProviderId;
  /** プレミアムユーザー用。provider が null なら管理者用と同じ */
  premium: { provider: ProviderId | null; model: string; savedKey: string | null };
  providers: Record<ProviderId, ProviderView>;
};

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
      <h2>AI設定（サーバーのAIとAPIキー）</h2>
      <p className="hint">
        管理者用のAI: <strong>{PROVIDER_LABELS[view.provider]}</strong>。ここで選んだプロバイダとモデルを管理者のAI提案に使います。APIキーと接続先URLはプロバイダごとに保存し、下の「{ROLE_LABELS.ai}用のAI」で専用のキーを入れなければ同じものを使います（「一般」のユーザーと、自分のキーを登録した{ROLE_LABELS.ai}は自分のAPIキー）。ほかのユーザーにはキーやURLは見えません。
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
          <input value={d.model} placeholder={pv.defaultModel} onChange={(e) => set({ model: e.target.value })} />
          <button type="button" onClick={fetchModels} disabled={!!state.busy}>
            {state.busy === "models" ? "取得中…" : "一覧"}
          </button>
        </div>
        <ModelSelect models={models} value={d.model} onPick={(m) => set({ model: m })} />
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
      {state.saved && <p className="ok-text">保存しました。このプロバイダとモデルを管理者のAI提案に使います。</p>}
      <button className="primary" type="button" onClick={save} disabled={!!state.busy}>
        {state.busy === "save" ? "保存中…" : "保存して、管理者用に使う"}
      </button>
      <PremiumAiSection view={view} onSaved={load} />
    </section>
  );
}

/**
 * プレミアムユーザーが使うプロバイダ・モデル・APIキー。
 * キーを入れなければ上の設定（プロバイダごとの共通のキー）を使う。接続先URLは上の設定を使う
 */
function PremiumAiSection({ view, onSaved }: { view: View; onSaved: (v: View) => void }) {
  const [provider, setProvider] = useState<ProviderId | "">(view.premium.provider ?? "");
  const [model, setModel] = useState(view.premium.model);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [state, setState] = useState<{ busy?: string; error?: string; saved?: boolean }>({});

  useEffect(() => {
    setProvider(view.premium.provider ?? "");
    setModel(view.premium.model);
    setApiKey("");
    setClearKey(false);
  }, [view.premium.provider, view.premium.model, view.premium.savedKey]);

  const effective = provider || view.provider;
  const pv = view.providers[effective];
  const fallbackModel = pv.model || pv.defaultModel;
  /** 保存済みの専用キーは、同じプロバイダのあいだだけ使う */
  const savedKey = provider && provider === view.premium.provider ? view.premium.savedKey : null;

  const save = async () => {
    setState({ busy: "save" });
    try {
      const premium = provider
        ? { provider, model, ...(clearKey ? { apiKey: "" } : apiKey ? { apiKey } : {}) }
        : { provider: null };
      const v = await api<View>("/api/admin/ai", "PUT", { premium });
      onSaved(v);
      setState({ saved: true });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const fetchModels = async () => {
    setState({ busy: "models" });
    try {
      const r = await api<{ models: string[] }>("/api/models", "POST", {
        provider: effective,
        premium: { ...(apiKey && !clearKey ? { apiKey } : {}) },
      });
      setModels(r.models);
      setState({});
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const sharedKeyReady = !!pv.savedKey || pv.envKey || effective === "local";
  const keyNote = savedKey && !clearKey
    ? `${ROLE_LABELS.ai}専用のキー ${savedKey} を使用中`
    : sharedKeyReady
      ? "空欄なら、上で保存したこのプロバイダの共通のキーを使います"
      : "このプロバイダのキーがまだありません。ここに入力してください";

  return (
    <div className="form sub-section">
      <h3>{ROLE_LABELS.ai}用のAI</h3>
      <p className="hint">
        {ROLE_LABELS.ai}のAI提案に使うプロバイダ・モデル・APIキーを、管理者用とは別に設定できます。いまの設定:{" "}
        <strong>
          {view.premium.provider
            ? `${PROVIDER_LABELS[view.premium.provider]} / ${view.premium.model || view.providers[view.premium.provider].model || view.providers[view.premium.provider].defaultModel}（${view.premium.savedKey ? `専用のキー ${view.premium.savedKey}` : "共通のキー"}）`
            : `管理者用と同じ（${PROVIDER_LABELS[view.provider]}）`}
        </strong>
        。自分のAPIキーを登録した{ROLE_LABELS.ai}は、自分のキーとモデルを使います。
      </p>
      <label>
        プロバイダ
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as ProviderId | "");
            setModel("");
            setApiKey("");
            setClearKey(false);
            setModels([]);
            setState({});
          }}
        >
          <option value="">管理者用と同じ</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
        {!provider && <span className="muted">専用のモデルやAPIキーを使うときは、プロバイダを選んでください。</span>}
      </label>
      {provider && (
        <>
          <label>
            モデル（空欄なら {fallbackModel}）
            <div className="input-row">
              <input
                value={model}
                placeholder={fallbackModel}
                onChange={(e) => {
                  setModel(e.target.value);
                  setState({});
                }}
              />
              <button type="button" onClick={fetchModels} disabled={!!state.busy}>
                {state.busy === "models" ? "取得中…" : "一覧"}
              </button>
            </div>
            <ModelSelect
              models={models}
              value={model}
              onPick={(m) => {
                setModel(m);
                setState({});
              }}
            />
          </label>
          <label>
            APIキー（{ROLE_LABELS.ai}専用・任意）
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              disabled={clearKey}
              placeholder={savedKey ? "変えないときは空欄" : sharedKeyReady ? "空欄なら共通のキー" : "キーを入力"}
              onChange={(e) => {
                setApiKey(e.target.value);
                setState({});
              }}
            />
            <span className={!savedKey && !sharedKeyReady && !apiKey ? "warn-text" : "muted"}>{keyNote}</span>
            {savedKey && (
              <span className="check">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(e) => {
                    setClearKey(e.target.checked);
                    setApiKey("");
                  }}
                />
                専用のキーを削除して、共通のキーに戻す
              </span>
            )}
          </label>
        </>
      )}
      {state.error && <p className="error">{state.error}</p>}
      {state.saved && <p className="ok-text">保存しました。{ROLE_LABELS.ai}のAI提案にこの設定を使います。</p>}
      <button className="primary" type="button" onClick={save} disabled={!!state.busy}>
        {state.busy === "save" ? "保存中…" : `${ROLE_LABELS.ai}用として保存`}
      </button>
    </div>
  );
}
