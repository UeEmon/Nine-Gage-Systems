"use client";

import { useState } from "react";
import { SIM_KINDS, SIM_KIND_LABELS, type SimObject } from "@/lib/replica";
import { initialSizeMm, loadModelObject, MODEL_MAX_BYTES, modelFormatOf, MTL_MAX_BYTES } from "@/lib/object3d";

export function SimObjectEditor({ sims, center, onChange }: {
  sims: SimObject[]; center: { x: number; y: number }; onChange: (sims: SimObject[]) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (uid: string, patch: Partial<SimObject>) => onChange(sims.map((s) => s.uid === uid ? { ...s, ...patch } : s));
  return <section className="sim-editor">
    <h3>仮オブジェクト・3Dモデル</h3>
    <label>3Dモデルを追加（STL・glTF の .glb・OBJ、512KB以下）
      <input type="file" multiple accept=".stl,.glb,.obj,.mtl" disabled={busy} onChange={async (e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        const file = files.find((f) => modelFormatOf(f.name));
        if (!file) {
          if (files.length) setError("STL・.glb・OBJ のファイルを選んでください（.gltf は .glb にまとめて書き出してください）。");
          return;
        }
        setError(""); setBusy(true);
        try {
          const format = modelFormatOf(file.name)!;
          if (file.size > MODEL_MAX_BYTES) throw new Error("3Dモデルは512KB以下にしてください。");
          const mtlFile = format === "obj" ? files.find((f) => /\.mtl$/i.test(f.name)) : undefined;
          const mtl = mtlFile && mtlFile.size <= MTL_MAX_BYTES ? await mtlFile.text() : undefined;
          if (sims.reduce((n, s) => n + (s.model?.data.length ?? 0) + (s.model?.mtl?.length ?? 0), 0) + file.size * 4 / 3 > 1400000) throw new Error("レイアウト内の3Dモデルは合計約1MBまでです。");
          let raw = "";
          for (const byte of new Uint8Array(await file.arrayBuffer())) raw += String.fromCharCode(byte);
          const model = { format, data: btoa(raw), ...(mtl ? { mtl } : {}) };
          const loaded = await loadModelObject(model);
          const size = initialSizeMm(format, loaded.size);
          loaded.dispose();
          onChange([...sims, { uid: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, "").slice(0, 80), kind: "other",
            ...center, z: 0, rot: 0, ...size, note: "アップロードした3Dモデル", model }]);
        } catch (err) { setError(err instanceof Error ? err.message : "読み込めませんでした。"); }
        finally { setBusy(false); }
      }} />
    </label>
    <p className="hint">STLはZ軸を高さとして最長辺100mmで、glTF・OBJは実物の大きさ（m）として1/150で、ボードの中央に置きます（極端な大きさなら最長辺100mm）。OBJは.mtlもいっしょに選ぶと色が付きます。寸法は下で変更できます。モデルは保存・書き出しに含まれます。大きなデータはJSONにも書き出してください。</p>
    {error && <p role="alert" className="error">{error}</p>}
    {sims.map((s) => <details key={s.uid}>
      <summary>{s.name}（{s.model ? "3Dモデル" : SIM_KIND_LABELS[s.kind]}）</summary>
      <label>名前<input value={s.name} maxLength={80} onChange={(e) => update(s.uid, { name: e.target.value })} /></label>
      <label>種類<select value={s.kind} onChange={(e) => update(s.uid, { kind: e.target.value as SimObject["kind"] })}>
        {SIM_KINDS.map((k) => <option key={k} value={k}>{SIM_KIND_LABELS[k]}</option>)}
      </select></label>
      <div className="sim-fields">
        {(["x", "y", "z", "rot", "length", "width", "height"] as const).map((key) => <label key={key}>
          {{ x: "X (mm)", y: "Y (mm)", z: "高さZ (mm)", rot: "回転 (°)", length: "長さ (mm)", width: "幅 (mm)", height: "高さ (mm)" }[key]}
          <input key={`${s.uid}-${key}`} type="number" step="any" min={["length", "width", "height"].includes(key) ? 0.1 : undefined}
            defaultValue={s[key] ?? 0} onBlur={(e) => {
              const value = e.currentTarget.valueAsNumber;
              if (Number.isFinite(value) && (!["length", "width", "height"].includes(key) || value >= 0.1)) update(s.uid, { [key]: value });
              else e.currentTarget.value = String(s[key] ?? 0);
            }} />
        </label>)}
      </div>
      <label>内容・説明<textarea value={s.note ?? ""} maxLength={1000} onChange={(e) => update(s.uid, { note: e.target.value })} /></label>
      <button type="button" className="danger" onClick={() => onChange(sims.filter((x) => x.uid !== s.uid))}>削除</button>
    </details>)}
    <p className="hint">座標はボード左上が原点、右が+X・下が+Y。数値は入力欄を離れると反映されます。</p>
  </section>;
}
