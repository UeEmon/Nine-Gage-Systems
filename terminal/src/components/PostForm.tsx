"use client";

import { useMemo, useState } from "react";
import { track } from "../../../src/lib/analytics";
import { findConnectors } from "../../../src/lib/modules";
import { parsePatternFile, type SavedPattern } from "../../../src/lib/patternFile";
import { EDGE_LABELS } from "../../../src/lib/modules";
import { LayoutSvg } from "./LayoutSvg";
import type { Layout } from "../../../src/lib/geometry";

/** 運行計画を載せないときは外して送る */
function postedLayout(layout: Layout, withOperation: boolean): Layout {
  if (withOperation) return layout;
  const { operation: _omit, ...rest } = layout;
  void _omit;
  return rest;
}

export function PostForm() {
  const [patterns, setPatterns] = useState<SavedPattern[]>([]);
  const [index, setIndex] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [withOperation, setWithOperation] = useState(true);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const chosen = patterns[index];
  const connectors = useMemo(() => (chosen ? findConnectors(chosen.layout) : []), [chosen]);
  const trains = chosen?.layout.operation?.trains.length ?? 0;
  const bounded = chosen && Number.isFinite(chosen.layout.board.width) && Number.isFinite(chosen.layout.board.height);

  const pick = (list: SavedPattern[], i: number) => {
    setPatterns(list);
    setIndex(i);
    setTitle(list[i]?.name ?? "");
    setDescription(list[i]?.layout.description ?? "");
    setWithOperation(true);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setState({ busy: false });
    try {
      pick(parsePatternFile(await file.text()), 0);
    } catch (e) {
      setPatterns([]);
      setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    setState({ busy: true });
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, layout: postedLayout(chosen.layout, withOperation) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `エラー（${res.status}）`);
      track("terminal_post");
      window.location.href = `/l/${data.id}`;
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>レイアウトを投稿する</h2>
      <p className="notice">
        プラットフォームの「パターンの保存」で書き出したファイル（.json）を選んでください。「JSONで保存」で作った1つだけのファイルも使えます。運行計画（ダイヤ）を作ってあれば、一緒に投稿できます。
      </p>
      <label>
        ファイル
        <input type="file" accept=".json,application/json" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {patterns.length > 1 && (
        <label>
          投稿するパターン
          <select value={index} onChange={(e) => pick(patterns, Number(e.target.value))}>
            {patterns.map((p, i) => (
              <option key={p.id + i} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {chosen && (
        <>
          <LayoutSvg layout={chosen.layout} connectors={connectors} />
          {!bounded ? (
            <p className="error">ボードの大きさが決まっていないレイアウトは投稿できません。プラットフォームでボードの大きさを決めてから書き出してください。</p>
          ) : connectors.length ? (
            <p className="notice ok">
              ほかのレイアウトとつなげる端子が {connectors.length} か所あります（
              {connectors.map((c, i) => `${i + 1}: ${EDGE_LABELS[c.edge]}の端まで${c.inset.toFixed(0)}mm`).join("、")}）。
            </p>
          ) : (
            <p className="notice">
              ボードの端に向かう線路の端がないので、ほかのレイアウトとはつなげません（見せるだけの投稿になります）。線路の端をボードの端と直角に、300mm以内まで延ばすと端子になります。
            </p>
          )}
          {trains > 0 ? (
            <label className="check">
              <input type="checkbox" checked={withOperation} onChange={(e) => setWithOperation(e.target.checked)} />
              運行計画（列車 {trains}本）も一緒に投稿する
            </label>
          ) : (
            <p className="notice">このレイアウトには運行計画がありません。プラットフォームの「運行計画」で列車を作ってから書き出すと、ダイヤも一緒に投稿できます。</p>
          )}
          <label>
            題名
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required />
          </label>
          <label>
            説明（任意）
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </label>
          <p className="notice">投稿したレイアウトはだれでも見られ、ファイルに保存したり、ほかの人がつないだりできます。</p>
          {state.error && <p className="error">{state.error}</p>}
          <button type="submit" className="primary" disabled={state.busy || !bounded || !title.trim()}>
            {state.busy ? "投稿しています…" : "投稿する"}
          </button>
        </>
      )}
      {!chosen && state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
