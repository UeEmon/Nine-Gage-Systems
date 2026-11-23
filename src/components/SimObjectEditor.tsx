"use client";

import { useState } from "react";
import { SIM_KINDS, SIM_KIND_LABELS, type SimObject } from "@/lib/replica";
import { MODEL_MAX_BYTES, parseStl } from "@/lib/object3d";

export function SimObjectEditor({ sims, center, onChange }: {
  sims: SimObject[]; center: { x: number; y: number }; onChange: (sims: SimObject[]) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (uid: string, patch: Partial<SimObject>) => onChange(sims.map((s) => s.uid === uid ? { ...s, ...patch } : s));
  return <section className="sim-editor">
    <h3>仮オブジェクト・3Dモデル</h3>
    <label>3Dモデルを追加（STL・256KB以下）
      <input type="file" accept=".stl" disabled={busy} onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setError(""); setBusy(true);
        try {
          if (!/\.stl$/i.test(file.name) || file.size > MODEL_MAX_BYTES) throw new Error("256KB以下のSTLを選んでください。");
          if (sims.reduce((n, s) => n + (s.model?.data.length ?? 0), 0) + file.size * 4 / 3 > 1400000) throw new Error("レイアウト内の3Dモデルは合計約1MBまでです。");
          const buffer = await file.arrayBuffer();
          const geometry = parseStl(buffer);
          const b = geometry.boundingBox!;
          const size = { length: b.max.x - b.min.x, height: b.max.y - b.min.y, width: b.max.z - b.min.z };
          geometry.dispose();
          let raw = "";
          for (const byte of new Uint8Array(buffer)) raw += String.fromCharCode(byte);
          const factor = 100 / Math.max(size.length, size.width, size.height);
          onChange([...sims, { uid: crypto.randomUUID(), name: file.name.replace(/\.stl$/i, "").slice(0, 80), kind: "other",
            ...center, z: 0, rot: 0, length: size.length * factor, width: size.width * factor, height: size.height * factor,
            note: "アップロードした3Dモデル", model: { format: "stl", data: btoa(raw) } }]);
        } catch (err) { setError(err instanceof Error ? err.message : "読み込めませんでした。"); }
        finally { setBusy(false); }
      }} />
    </label>
    <p className="hint">STLのZ軸を高さとして、中央に最長辺100mmで配置します。寸法は下で変更できます。モデルは保存・書き出しに含まれます。大きなデータはJSONにも書き出してください。</p>
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
