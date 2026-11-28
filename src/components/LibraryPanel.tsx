"use client";

import { track } from "@/lib/analytics";
import type { Layout } from "@/lib/geometry";
import { mergePatterns, newPatternId, parsePatternFile, toPatternFile, type SavedPattern } from "@/lib/patternFile";

type Props = {
  layout: Layout;
  patterns: SavedPattern[];
  setPatterns: (fn: (ps: SavedPattern[]) => SavedPattern[]) => void;
  /** 開いているパターン（上書き保存の対象） */
  currentId: string | null;
  setCurrentId: (id: string | null) => void;
  onOpen: (layout: Layout) => void;
  onExpand?: (pattern: SavedPattern) => void;
  expanding: boolean;
};

function downloadJson(name: string, data: unknown) {
  track("export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[\\/:*?"<>|]/g, "_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const clone = (l: Layout): Layout => JSON.parse(JSON.stringify(l));

/** パターンの登録・保存・ファイル出力・読み込み */
export function LibraryPanel({ layout, patterns, setPatterns, currentId, setCurrentId, onOpen, onExpand, expanding }: Props) {
  const current = patterns.find((p) => p.id === currentId) ?? null;

  const saveNew = () => {
    const name = prompt("パターンの名前", layout.title || "パターン");
    if (name === null) return;
    const p: SavedPattern = { id: newPatternId(), name: name || "パターン", savedAt: new Date().toISOString(), layout: clone(layout) };
    setPatterns((ps) => [p, ...ps]);
    setCurrentId(p.id);
    track("save", "new");
  };
  const overwrite = () => {
    if (!current) return;
    setPatterns((ps) =>
      ps.map((p) => (p.id === current.id ? { ...p, savedAt: new Date().toISOString(), layout: clone(layout) } : p)),
    );
    track("save", "overwrite");
  };
  const rename = (p: SavedPattern) => {
    const name = prompt("新しい名前", p.name);
    if (name) setPatterns((ps) => ps.map((q) => (q.id === p.id ? { ...q, name } : q)));
  };
  const remove = (p: SavedPattern) => {
    if (!confirm(`「${p.name}」を削除しますか？`)) return;
    setPatterns((ps) => ps.filter((q) => q.id !== p.id));
    if (currentId === p.id) setCurrentId(null);
  };
  const importFile = async (file: File) => {
    try {
      const incoming = parsePatternFile(await file.text());
      setPatterns((ps) => mergePatterns(ps, incoming));
      track("import");
      if (incoming.length === 1) {
        onOpen(clone(incoming[0].layout));
      }
      alert(`${incoming.length}件のパターンを読み込みました`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "読み込めませんでした");
    }
  };

  return (
    <section>
      <h2>パターンの保存</h2>
      <div className="row wrap">
        <button onClick={saveNew}>新しく登録</button>
        <button onClick={overwrite} disabled={!current} title={current ? `「${current.name}」に上書き` : "登録済みのパターンを開くと上書きできます"}>
          上書き保存
        </button>
      </div>
      {current && <p className="hint">編集中: {current.name}</p>}
      {patterns.length === 0 ? (
        <p className="hint">登録したパターンはまだありません</p>
      ) : (
        <ul className="patterns">
          {patterns.map((p) => (
            <li key={p.id} className={p.id === currentId ? "on" : ""}>
              <button className="link" onClick={() => { onOpen(clone(p.layout)); setCurrentId(p.id); }} title="開いて編集">
                {p.name}
              </button>
              <span className="muted">
                {p.layout.pieces.length}本・{new Date(p.savedAt).toLocaleDateString("ja-JP")}
              </span>
              <span className="actions">
                {onExpand && p.layout.pieces.length > 0 && (
                  <button className="mini" disabled={expanding} onClick={() => onExpand(p)} title={`「${p.name}」を土台にする`}>AIで拡張</button>
                )}
                <button className="mini" onClick={() => rename(p)}>名前</button>
                <button className="mini" onClick={() => downloadJson(p.name, toPatternFile([p]))}>出力</button>
                <button className="mini danger" onClick={() => remove(p)}>削除</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="row wrap">
        <button onClick={() => downloadJson(layout.title || "layout", toPatternFile([{ id: currentId ?? newPatternId(), name: layout.title || "パターン", savedAt: new Date().toISOString(), layout }]))}>
          今の配置をファイルに出力
        </button>
        <button disabled={!patterns.length} onClick={() => downloadJson("senrolab-patterns", toPatternFile(patterns))}>
          全パターンを出力
        </button>
        <label className="button">
          ファイルを読み込む
          <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        </label>
      </div>
      <p className="hint">登録したパターンはこのブラウザに保存されます。別のパソコンへはファイルに出力して読み込んでください。</p>
    </section>
  );
}
