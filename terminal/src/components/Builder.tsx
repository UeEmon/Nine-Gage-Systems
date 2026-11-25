"use client";

import { useEffect, useMemo, useState } from "react";
import type { Candidate } from "../../../src/lib/modules";
import { EDGE_LABELS } from "../../../src/lib/modules";
import { track } from "../../../src/lib/analytics";
import { assemble, fileName, patternFileOf, type ModulePost, type ModuleRef } from "../lib/assembly";
import { AssemblySvg, type AssemblyModule } from "./LayoutSvg";

type Props = {
  posts: ModulePost[];
  modules: ModuleRef[];
  setId?: string;
  title?: string;
  description?: string;
  loggedIn: boolean;
  /** ログインから戻ったとき、ログイン前に並べていた状態を戻す */
  resume?: boolean;
};

const RESUME_KEY = "ls_builder";

type Target = { module: number; connector: string };

export function Builder(props: Props) {
  const [posts, setPosts] = useState(() => new Map(props.posts.map((p) => [p.id, p])));
  const [modules, setModules] = useState<ModuleRef[]>(props.modules);
  const [target, setTarget] = useState<Target | null>(null);
  const [cands, setCands] = useState<{ list: Candidate[]; loading: boolean; error?: string }>({ list: [], loading: false });
  /** 押して選んだ候補と、マウスを乗せている候補（どちらも試し置きで薄く描く） */
  const [preview, setPreview] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [title, setTitle] = useState(props.title ?? "");
  const [description, setDescription] = useState(props.description ?? "");
  const [save, setSave] = useState<{ busy: boolean; error?: string }>({ busy: false });

  useEffect(() => {
    if (!props.resume) return;
    let saved: { modules: ModuleRef[]; title: string; description: string } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null");
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      saved = null;
    }
    if (!saved?.modules?.length) return;
    const s = saved;
    Promise.all([...new Set(s.modules.map((m) => m.postId))].map((id) => fetch(`/api/posts/${id}`).then((r) => (r.ok ? r.json() : null))))
      .then((rows) => {
        const loaded = rows.filter(Boolean).map((r) => r.post as ModulePost);
        setPosts(new Map(loaded.map((p) => [p.id, p])));
        setModules(s.modules.filter((m) => loaded.some((p) => p.id === m.postId)));
        setTitle(s.title);
        setDescription(s.description);
      })
      .catch(() => {});
  }, [props.resume]);

  const loginForSave = () => {
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ modules, title, description }));
    } catch {
      // 保存できなくてもログインはできる
    }
    window.location.href = `/auth/login?next=${encodeURIComponent("/connect?resume=1")}`;
  };

  const { check, layout, offset } = useMemo(() => assemble(title || "つないだレイアウト", modules, [...posts.values()]), [modules, posts, title]);
  const linked = new Set(check.junctions.flatMap((j) => [`${j.a.module}:${j.a.connector}`, `${j.b.module}:${j.b.connector}`]));
  const bad = new Set(check.mismatches.map((m) => `${m.a.module}:${m.a.connector}`));

  const view: AssemblyModule[] = modules.flatMap((m) => {
    const p = posts.get(m.postId);
    return p ? [{ key: p.id, title: p.title, layout: p.layout, connectors: p.connectors, placement: m.placement }] : [];
  });
  const shown = hover ?? preview;
  const ghostCand = shown !== null ? cands.list[shown] : null;
  const ghostPost = ghostCand ? posts.get(ghostCand.key) : null;
  const ghost = ghostCand && ghostPost ? { key: ghostPost.id, title: ghostPost.title, layout: ghostPost.layout, connectors: ghostPost.connectors, placement: ghostCand.placement } : null;

  const choose = async (module: number, connector: string) => {
    if (target && target.module === module && target.connector === connector) {
      setTarget(null);
      setCands({ list: [], loading: false });
      setPreview(null);
      return;
    }
    setTarget({ module, connector });
    setPreview(null);
    setCands({ list: [], loading: true });
    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules, target: { module, connector } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `エラー（${res.status}）`);
      setPosts((cur) => {
        const next = new Map(cur);
        for (const p of data.posts as ModulePost[]) next.set(p.id, p);
        return next;
      });
      setCands({ list: data.candidates, loading: false });
    } catch (e) {
      setCands({ list: [], loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const add = (c: Candidate) => {
    setModules((m) => [...m, { postId: c.key, placement: c.placement }]);
    setTarget(null);
    setPreview(null);
    setHover(null);
    setCands({ list: [], loading: false });
  };

  const removeLast = () => {
    if (modules.length <= 1) return;
    setModules((m) => m.slice(0, -1));
    setTarget(null);
    setPreview(null);
    setHover(null);
    setCands({ list: [], loading: false });
  };

  const download = () => {
    const name = title || "つないだレイアウト";
    const blob = new Blob([JSON.stringify(patternFileOf(name, { ...layout, title: name, description: description || layout.description }), null, 1)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName(name);
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const submit = async () => {
    setSave({ busy: true });
    try {
      const res = await fetch(props.setId ? `/api/sets/${props.setId}` : "/api/sets", {
        method: props.setId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, modules }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `エラー（${res.status}）`);
      if (!props.setId) track("terminal_set");
      window.location.href = `/s/${data.id}`;
    } catch (e) {
      setSave({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const unfilled = check.junctions.filter((j) => j.fill === null).length;
  const fillers = layout.pieces.filter((p) => p.uid.startsWith("fill"));

  return (
    <div className="builder">
      <div className="figure detail-figure card">
        <AssemblySvg
          modules={view}
          fillers={fillers}
          fillerOffset={offset}
          ghost={ghost}
          connectorState={(i, c) => {
            const k = `${i}:${c.id}`;
            if (target && target.module === i && target.connector === c.id) return "selected";
            return linked.has(k) ? "linked" : bad.has(k) ? "problem" : "free";
          }}
          onConnector={(i, c) => choose(i, c.id)}
        />
        <p className="notice">
          緑の丸が空いている端子です。押すと右に候補が出ます。青はつながった端子、黄色の線路はつなぎ目に足す直線です。
        </p>
      </div>
      <div className="side">
        <div className="card">
          <h2>並べたレイアウト（{view.length}枚）</h2>
          <ol className="module-list">
            {view.map((m, i) => (
              <li key={i}>
                <a href={`/l/${m.key}`} target="_blank" rel="noreferrer">
                  {m.title}
                </a>
              </li>
            ))}
          </ol>
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" onClick={removeLast} disabled={modules.length <= 1}>
              最後の1枚を外す
            </button>
            <button type="button" onClick={download} disabled={!view.length}>
              全体をファイルに保存
            </button>
          </div>
          {check.overlaps.length > 0 && <p className="problem">重なっているボードがあります。</p>}
          {unfilled > 0 && <p className="problem">ちょうどの長さの直線がないつなぎ目が {unfilled} か所あります（スライド線路・バリアブルレールで合わせる）。</p>}
          {check.mismatches.map((m, i) => (
            <p key={i} className="problem">
              {m.a.module + 1}枚目: {m.reason}
            </p>
          ))}
        </div>
        {target && (
          <div className="card">
            <h2>つなげられる投稿</h2>
            {cands.loading && <p className="notice">探しています…</p>}
            {cands.error && <p className="error">{cands.error}</p>}
            {!cands.loading && !cands.error && !cands.list.length && <p className="notice">この端子につなげられる投稿は見つかりませんでした。</p>}
            <ul className="cand-list" onMouseLeave={() => setHover(null)}>
              {cands.list.map((c, i) => {
                const p = posts.get(c.key);
                const conn = p?.connectors.find((x) => x.id === c.connector);
                return (
                  <li key={`${c.key}-${c.connector}`}>
                    <button
                      type="button"
                      className={preview === i ? "on" : ""}
                      onMouseEnter={() => setHover(i)}
                      onClick={() => setPreview(i)}
                    >
                      <strong>{p?.title}</strong>
                      <small>
                        {p?.ownerName}・{conn ? `${EDGE_LABELS[conn.edge]}の端子で` : ""}
                        {c.placement.rot ? `${c.placement.rot}°回して` : "そのまま"}・つながる線路 {c.links}本
                        {c.fillers ? `・足す直線 ${c.fillers}本` : ""}
                      </small>
                      {c.problems.map((pr, k) => (
                        <small key={k} className="problem">
                          {pr}
                        </small>
                      ))}
                    </button>
                    {preview === i && (
                      <button type="button" className="primary" onClick={() => add(c)}>
                        この置き方でつなぐ
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="card form">
          <h2>{props.setId ? "変更を保存" : "つないだレイアウトを保存"}</h2>
          {props.loggedIn ? (
            <>
              <label>
                題名
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
              </label>
              <label>
                説明（任意）
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
              </label>
              {save.error && <p className="error">{save.error}</p>}
              <button type="button" className="primary" onClick={submit} disabled={save.busy || modules.length < 2 || !title.trim()}>
                {save.busy ? "保存しています…" : "保存して公開する"}
              </button>
            </>
          ) : (
            <>
              <p className="notice">保存して公開するには、SenroLab のアカウントでログインしてください。並べた状態はログインのあとに戻ります（ファイルへの保存はログインなしでできます）。</p>
              <button type="button" onClick={loginForSave}>
                ログインして保存する
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
