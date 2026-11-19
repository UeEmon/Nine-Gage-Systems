"use client";

/**
 * 「一覧」で取ったモデルから選ぶ。選ぶとモデル名の欄に入る。
 * （入力欄の候補表示 datalist は、欄に文字が入っていると候補が絞られて選べないことがあるので、select にする）
 */
export function ModelSelect({ models, value, onPick }: { models: string[]; value: string; onPick: (model: string) => void }) {
  if (models.length === 0) return null;
  return (
    <select className="model-select" value={models.includes(value) ? value : ""} onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">一覧から選ぶ（{models.length}件）</option>
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}
