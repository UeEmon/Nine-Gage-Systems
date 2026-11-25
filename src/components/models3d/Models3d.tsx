"use client";

import { useEffect, useState } from "react";
import { defaultSizeMm, readModelFiles, type Model3d } from "@/lib/models3d/pack";
import { isPlacedModel, MAX_PLACED_MODELS, newPlacedUid, scalePlaced, type PlacedModel } from "@/lib/models3d/placed";
import { deleteModel, listModels, MODELS_CHANGED_EVENT, renameModel, saveModels } from "@/lib/models3d/store";
import { normDeg } from "@/lib/parts";
import { ROLE_LABELS, SPONSORS_URL } from "@/lib/roles";

/** このブラウザに読み込んだ RealTrainMod の設置物（読み込み中は null） */
export function useModels3d(enabled = true): Model3d[] | null {
  const [models, setModels] = useState<Model3d[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      listModels()
        .then((m) => alive && setModels(m))
        .catch(() => alive && setModels([]));
    load();
    window.addEventListener(MODELS_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(MODELS_CHANGED_EVENT, load);
    };
  }, [enabled]);
  return enabled ? models : [];
}

const ACCEPT = ".zip,.jar,.json,.mqo,.mqoz,.obj,.mtl,.png";
const PICK = /\.(zip|jar|json|mqo|mqoz|obj|mtl|png|jpe?g|npm|ngto|rar|7z|lzh)$/i;

const fmtSize = (m: Model3d) => {
  const s = defaultSizeMm(m);
  return `${Math.round(s.length)}×${Math.round(s.width)}×高さ${Math.round(s.height)}mm`;
};

/** RealTrainMod の設置物を読み込む・管理するダイアログ */
export function ModelsDialog({ onClose, onPlace }: { onClose: () => void; onPlace?: (m: Model3d) => void }) {
  const models = useModels3d();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ added: string[]; problems: string[] } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const picked = [...list].filter((f) => PICK.test(f.name));
      const files = await Promise.all(
        picked.map(async (f) => ({ name: f.name, path: f.webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) })),
      );
      const r = await readModelFiles(files);
      // 実際に組み立てて、読めないモデルを外し、寸法を測る（three.js はここで初めて読み込む）
      const { buildModelKit } = await import("@/lib/models3d/three");
      const ok: Model3d[] = [];
      const problems = [...r.problems];
      for (const m of r.models) {
        try {
          const kit = await buildModelKit(m);
          ok.push({ ...m, size: kit.size });
          kit.dispose();
        } catch (e) {
          problems.push(`${m.name}: ${e instanceof Error ? e.message : "モデルを読めませんでした"}`);
        }
      }
      if (ok.length > 0) await saveModels(ok);
      setMessage({ added: ok.map((m) => m.name), problems });
    } catch (e) {
      setMessage({ added: [], problems: [e instanceof Error ? e.message : "読み込めませんでした"] });
    } finally {
      setBusy(false);
    }
  };

  const input = (folder: boolean) => (
    <input
      type="file"
      multiple={!folder}
      disabled={busy}
      accept={folder ? undefined : ACCEPT}
      {...(folder ? ({ webkitdirectory: "" } as Record<string, string>) : {})}
      onChange={(e) => {
        const el = e.currentTarget;
        void onFiles(el.files).finally(() => {
          el.value = "";
        });
      }}
    />
  );

  return (
    <div className="rtm-backdrop" onClick={onClose}>
      <div className="rtm-dialog" role="dialog" aria-label="RealTrainMod の設置物" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>RealTrainMod の設置物</h3>
          <button onClick={onClose}>閉じる</button>
        </header>
        <p className="muted">
          お持ちの RealTrainMod の設置物パック（ModelOrnament・ModelMachine・ModelSignal などの .zip）を選ぶと、街灯・改札機・信号機などの設置物をレイアウトに置けます。置いた設置物は運転席の映像にも表示されます。
          json・モデル（.mqo / .mqoz / .obj）・テクスチャ（.png）をまとめて選んでも読み込めます。
        </p>
        <p className="rtm-note">
          設置物パックはそれぞれの作者の利用規約に従って使ってください。読み込んだ設置物はこのブラウザの中だけに保存され、SenroLab のサーバーには送られません。
          レイアウトに保存されるのは置いた位置と大きさだけなので、別の端末で見るときは、その端末でも同じ設置物パックを読み込んでください。
        </p>
        <div className="rtm-files">
          <label className="rtm-file">
            {busy ? "読み込み中…" : "設置物パックを選ぶ"}
            {input(false)}
          </label>
          <label className="rtm-file" title="展開した設置物パックのフォルダを選びます">
            展開したフォルダを選ぶ
            {input(true)}
          </label>
        </div>
        {message && (
          <div className="rtm-result">
            {message.added.length > 0 && <p>{message.added.length}個を読み込みました：{message.added.join("、")}</p>}
            {message.problems.length > 0 && (
              <ul className="warn-text">
                {message.problems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}
                {message.problems.length > 8 && <li>ほか{message.problems.length - 8}件</li>}
              </ul>
            )}
          </div>
        )}
        {models && models.length > 0 && (
          <ul className="rtm-list">
            {models.map((m) => (
              <li key={m.id}>
                <div className="rtm-name">
                  <input
                    className="model-name"
                    defaultValue={m.name}
                    maxLength={80}
                    aria-label="設置物の名前"
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v && v !== m.name) void renameModel(m.id, v);
                      else e.currentTarget.value = m.name;
                    }}
                  />
                  <span className="muted">
                    {m.kind ? `${m.kind}・` : ""}{fmtSize(m)}・{m.source}
                  </span>
                </div>
                <div className="rtm-actions">
                  {onPlace && <button onClick={() => onPlace(m)}>レイアウトに置く</button>}
                  <button className="danger" onClick={() => void deleteModel(m.id)}>削除</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {models && models.length === 0 && !message && <p className="muted">まだ設置物を読み込んでいません。</p>}
        <p className="muted rtm-help">
          設置物は実物の 1/150 の大きさで置きます。大きさ・向き・高さは、置いたあとに変えられます。
          RealTrainMod の車両は、運転席の映像の「RTMの車両…」から読み込んでください。レール・架線、動き（スクリプト）、暗号化されたモデル（.npm）には対応していません。
          glTF・OBJ・STL などのモデルは、右の「仮オブジェクト・3Dモデル」に置けます。
        </p>
      </div>
    </div>
  );
}

/** 置くモデルを作る（中心に、縮尺どおりの大きさで） */
export function placeNew(m: Model3d, at: { x: number; y: number }): PlacedModel {
  return { uid: newPlacedUid(), modelId: m.id, name: m.name, x: Math.round(at.x), y: Math.round(at.y), rot: 0, ...defaultSizeMm(m) };
}

const num = (v: number) => Math.round(v * 10) / 10;

/** 編集画面の左の「RTMの設置物」の欄 */
export function ModelsSection({
  allowed,
  placed,
  models,
  selectedUid,
  center,
  onChange,
  onSelect,
}: {
  allowed: boolean;
  placed: PlacedModel[];
  /** この端末に読み込んだモデル */
  models: Model3d[] | null;
  selectedUid: string | null;
  center: { x: number; y: number };
  onChange: (next: PlacedModel[]) => void;
  onSelect: (uid: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = placed.find((p) => p.uid === selectedUid);
  const update = (patch: Partial<PlacedModel>) => selected && onChange(placed.map((p) => (p.uid === selected.uid ? { ...p, ...patch } : p)));
  if (!allowed) {
    return (
      <section>
        <h2>RTMの設置物</h2>
        <p className="hint">
          RealTrainMod の設置物パック（街灯・改札機・信号機など）を読み込んでレイアウトに置き、運転席の映像に表示できます。
          {ROLE_LABELS.ai}・{ROLE_LABELS.plus}の特典です（<a href={SPONSORS_URL} target="_blank" rel="noreferrer">GitHub Sponsors で支援する</a>）。
        </p>
        {placed.length > 0 && <p className="hint">このレイアウトには RTM の設置物が {placed.length} 個置かれています（枠だけ表示しています）。</p>}
      </section>
    );
  }
  const have = new Set((models ?? []).map((m) => m.id));
  const model = selected ? models?.find((m) => m.id === selected.modelId) : undefined;
  const field = (key: "x" | "y" | "z" | "rot", label: string) => (
    <label key={`${selected!.uid}-${key}-${num(selected![key] ?? 0)}`}>
      {label}
      <input
        type="number"
        step="any"
        defaultValue={num(selected![key] ?? 0)}
        onBlur={(e) => {
          const v = e.currentTarget.valueAsNumber;
          if (Number.isFinite(v)) update({ [key]: key === "rot" ? normDeg(v) : v });
          else e.currentTarget.value = String(num(selected![key] ?? 0));
        }}
      />
    </label>
  );
  return (
    <section>
      <h2>RTMの設置物</h2>
      <p className="hint">読み込んだ RealTrainMod の設置物を置きます。ボードの上でドラッグすると動かせます。運転席の映像にも表示されます。</p>
      <div className="row wrap">
        <button onClick={() => setOpen(true)}>設置物を読み込む・置く…</button>
      </div>
      {placed.length > 0 && (
        <ul className="model-placed">
          {placed.map((p) => (
            <li key={p.uid}>
              <button className={`link-button${p.uid === selectedUid ? " on" : ""}`} onClick={() => onSelect(p.uid)}>
                {p.name}
              </button>
              {!have.has(p.modelId) && models && <span className="warn-text small-text">（この端末にない）</span>}
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="model-edit" key={selected.uid}>
          <p className="hint">
            <b>{selected.name}</b>：{num(selected.length)}×{num(selected.width)}×高さ{num(selected.height)}mm
            {!model && models && "。この設置物はこの端末に読み込まれていないので、映像には表示されません"}
          </p>
          <div className="sim-fields">
            {field("x", "X (mm)")}
            {field("y", "Y (mm)")}
            {field("z", "高さZ (mm)")}
            {field("rot", "回転 (°)")}
            <label key={`${selected.uid}-len-${selected.length}`}>
              横の長さ (mm)
              <input
                type="number"
                step="any"
                min={0.5}
                defaultValue={num(selected.length)}
                onBlur={(e) => {
                  const v = e.currentTarget.valueAsNumber;
                  if (Number.isFinite(v) && v > 0) onChange(placed.map((p) => (p.uid === selected.uid ? scalePlaced(p, v / p.length) : p)));
                  else e.currentTarget.value = String(num(selected.length));
                }}
              />
            </label>
          </div>
          <div className="row wrap">
            <button onClick={() => update({ rot: normDeg(selected.rot - 15) })}>⟲ 15°</button>
            <button onClick={() => update({ rot: normDeg(selected.rot + 15) })}>⟳ 15°</button>
            <button onClick={() => onChange(placed.map((p) => (p.uid === selected.uid ? scalePlaced(p, 0.8) : p)))}>小さく</button>
            <button onClick={() => onChange(placed.map((p) => (p.uid === selected.uid ? scalePlaced(p, 1.25) : p)))}>大きく</button>
            {model && <button onClick={() => update(defaultSizeMm(model))} title="読み込んだときの大きさ（縮尺どおり）に戻す">元の大きさ</button>}
            <button
              onClick={() => {
                const copy = { ...selected, uid: newPlacedUid(), x: selected.x + 20, y: selected.y + 20 };
                if (placed.length < MAX_PLACED_MODELS) {
                  onChange([...placed, copy]);
                  onSelect(copy.uid);
                }
              }}
            >
              複製
            </button>
            <button
              className="danger"
              onClick={() => {
                onChange(placed.filter((p) => p.uid !== selected.uid));
                onSelect(null);
              }}
            >
              削除
            </button>
          </div>
          <p className="hint">横の長さを変えると、奥行きと高さも同じ割合で変わります。高さZ は高架の上などに置くときに使います（地上のレール面が 0）。</p>
        </div>
      )}
      {open && (
        <ModelsDialog
          onClose={() => setOpen(false)}
          onPlace={(m) => {
            if (placed.length >= MAX_PLACED_MODELS) return;
            const p = placeNew(m, center);
            if (!isPlacedModel(p)) return;
            onChange([...placed, p]);
            onSelect(p.uid);
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}

/** ボードの上の RTM の設置物の枠（上から見た形） */
export function PlacedModelShape({
  model,
  selected,
  missing,
  fontSize,
  onPointerDown,
}: {
  model: PlacedModel;
  selected: boolean;
  missing: boolean;
  fontSize: number;
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void;
}) {
  const hl = model.length / 2;
  const hw = model.width / 2;
  return (
    <g
      className={`placed-model${selected ? " is-selected" : ""}${missing ? " is-missing" : ""}`}
      onPointerDown={onPointerDown}
      style={onPointerDown ? { cursor: "move" } : undefined}
    >
      <g transform={`translate(${model.x} ${model.y}) rotate(${model.rot})`}>
        <rect x={-hl} y={-hw} width={model.length} height={model.width} rx={1} className="placed-model-body" />
        {/* 前（モデルの +X）の向きの印 */}
        <line x1={hl * 0.6} y1={0} x2={hl} y2={0} className="placed-model-front" />
      </g>
      <text x={model.x} y={model.y} className="placed-model-label" style={{ fontSize }}>
        RTM {model.name}
      </text>
      <title>{`${model.name}（RealTrainMod の設置物）${missing ? "。この端末に読み込まれていません" : ""}`}</title>
    </g>
  );
}
