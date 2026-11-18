"use client";

import { useEffect, useState } from "react";
import { PROVIDER_LABELS } from "@/lib/llm/types";
import Link from "next/link";
import { api, API_KEY_GUIDE_PATH, ROLE_LABELS } from "@/lib/roles";

const PROVIDERS = ["anthropic", "openai", "gemini"] as const;
type Provider = (typeof PROVIDERS)[number];

type View = {
  provider: Provider;
  model: string;
  defaultModels: Record<Provider, string>;
  savedKey: string | null;
  unreadable: boolean;
};

/** キーを作るページ（各社の公式） */
const KEY_PAGE: Record<Provider, { label: string; url: string }> = {
  anthropic: { label: "Claude Console の API Keys", url: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI Platform の API keys", url: "https://platform.openai.com/api-keys" },
  gemini: { label: "Google AI Studio の API キー", url: "https://aistudio.google.com/apikey" },
};

const KEY_HINT: Record<Provider, string> = {
  anthropic: "sk-ant-…（Claude Console の API Keys で作れます）",
  openai: "sk-…（OpenAI Platform の API keys で作れます）",
  gemini: "Google AI Studio の API キー",
};

/**
 * 自分のAPIキーを設定する（一般・プレミアムユーザー）。キーは暗号化して保存し、末尾4文字だけ表示する。
 * premium: プレミアムユーザー向けの表示（キーは任意。登録したときだけ自分のキーを使う）
 */
export function OwnAiForm({ premium = false }: { premium?: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: string }>({ busy: false });

  const apply = (v: View) => {
    setView(v);
    setProvider(v.provider);
    setModel(v.model);
    setApiKey("");
  };

  useEffect(() => {
    api<View>("/api/account/ai", "GET")
      .then(apply)
      .catch((err) => setState({ busy: false, error: err instanceof Error ? err.message : String(err) }));
  }, []);

  const save = async (body: { provider: Provider; model?: string; apiKey?: string }, done: string) => {
    setState({ busy: true });
    try {
      apply(await api<View>("/api/account/ai", "PUT", body));
      setState({ busy: false, done });
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save({ provider, model, ...(apiKey ? { apiKey } : {}) }, "保存しました。AI提案でこのキーを使います。");
  };

  const removeKey = () => {
    if (!view) return;
    save(
      { provider: view.provider, apiKey: "" },
      premium ? "キーを削除しました。AI提案は管理者が設定したAIに戻ります。" : "キーを削除しました。",
    );
  };

  if (!view) return <section className="card">{state.error ? <p className="error">{state.error}</p> : <p className="hint">読み込み中…</p>}</section>;
  const sameProvider = provider === view.provider;

  return (
    <form className="card form" onSubmit={submit}>
      <h2>AIの設定（自分のAPIキー{premium ? "・任意" : ""}）</h2>
      {premium ? (
        <p className="hint">
          {ROLE_LABELS.ai}は、ふだんは管理者が設定したAIを使います。自分で用意したAPIキーを登録すると、AI提案にそのキーとモデルを使います（料金はキーの持ち主＝あなたのアカウントに請求されます）。キーを削除すると、管理者が設定したAIに戻ります。
        </p>
      ) : (
        <p className="hint">
          一般ユーザーは、自分で用意したAPIキーでAI提案を使えます。料金はキーの持ち主（あなた）のアカウントに請求されます。キーはサーバーに暗号化して保存し、画面には末尾4文字だけを表示します。
        </p>
      )}
      <p className="hint">
        はじめての方は <Link href={API_KEY_GUIDE_PATH}>APIキー登録のチュートリアル</Link> を見ながら進めてください。
      </p>
      {premium && (
        <p className="hint">
          いまAI提案に使っているキー: <strong>{view.savedKey && !view.unreadable ? `自分のキー（${view.savedKey}）` : "管理者が設定したキー"}</strong>
        </p>
      )}
      {!view.savedKey && (
        <ol className="hint steps">
          <li>使うAIを選びます（迷ったら Claude）。</li>
          <li>
            <a href={KEY_PAGE[provider].url} target="_blank" rel="noreferrer">
              {KEY_PAGE[provider].label}
            </a>
            でAPIキーを作ります（各社のアカウントと支払いの登録が要ります）。
          </li>
          <li>作ったキーを下に貼り付けて「保存する」を押します。</li>
        </ol>
      )}
      <label>
        AI
        <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <label>
        モデル（空欄なら {view.defaultModels[provider]}）
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={view.defaultModels[provider]} autoComplete="off" />
      </label>
      <label>
        APIキー
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={sameProvider && view.savedKey ? `保存済み ${view.savedKey}（変えるときだけ入力）` : KEY_HINT[provider]}
          autoComplete="off"
          required={!(sameProvider && view.savedKey)}
        />
      </label>
      {!sameProvider && view.savedKey && <p className="hint">AIを変えると、保存済みのキー（{view.savedKey}）は消えます。</p>}
      {view.unreadable && <p className="warn-text">保存したキーを読めなくなりました。もう一度入力してください。</p>}
      {state.error && <p className="error">{state.error}</p>}
      {state.done && (
        <p className="ok-text">
          {state.done} <a href="/">エディタでAI提案を使う</a>
        </p>
      )}
      <div className="row">
        <button className="primary" disabled={state.busy}>
          {state.busy ? "保存中…" : "保存する"}
        </button>
        {view.savedKey && (
          <button
            type="button"
            className="danger"
            disabled={state.busy}
            onClick={removeKey}
          >
            キーを削除
          </button>
        )}
      </div>
    </form>
  );
}
