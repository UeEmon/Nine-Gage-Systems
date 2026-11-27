"use client";

import { useState } from "react";
import { MAX_CONSIST_CARS, type RtmSlot } from "@/lib/drive";
import type { RtmVehicle } from "@/lib/rtm/pack";
import { updateRtmVehicle } from "@/lib/rtm/store";
import { FormationSideView } from "./FormationSideView";

export function FormationEditor({ lead, vehicles, onDone }: {
  lead: RtmVehicle;
  vehicles: RtmVehicle[];
  onDone: () => void;
}) {
  const [slots, setSlots] = useState<RtmSlot[]>(() => lead.formation ?? [
    { id: lead.id, reversed: false }, { id: lead.middleId ?? lead.id, reversed: false }, { id: lead.id, reversed: true },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const change = (i: number, patch: Partial<RtmSlot>) => setSlots(slots.map((s, k) => k === i ? { ...s, ...patch } : s));
  const move = (i: number, j: number) => {
    setSlots(current => {
      if (i < 1 || j < 1 || i >= current.length || j >= current.length || i === j) return current;
      const next = current.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const save = async (formation?: RtmSlot[]) => {
    setSaving(true);
    try {
      await updateRtmVehicle(lead.id, { formation });
      onDone();
    } catch {
      setError("編成を保存できませんでした。");
      setSaving(false);
    }
  };
  return (
    <fieldset disabled={saving} className="rtm-formation">
      <legend>{lead.name} の編成（{slots.length}両）</legend>
      <FormationSideView slots={slots} vehicles={vehicles} disabled={saving} onSwap={move} />
      <ol>
        {slots.map((slot, i) => (
          <li key={i}>
            {i === 0 ? <strong>{lead.name}（先頭）</strong> : (
              <select aria-label={`${i + 1}両目の車両`} value={slot.id} onChange={e => change(i, { id: e.target.value })}>
                {!vehicles.some(v => v.id === slot.id) && <option value={slot.id}>未読込の車両</option>}
                {vehicles.map(v => <option value={v.id} key={v.id}>{v.name}</option>)}
              </select>
            )}
            <label><input type="checkbox" checked={slot.reversed} onChange={e => change(i, { reversed: e.target.checked })} />逆向き</label>
            {i > 0 && <>
              <button disabled={i === 1} onClick={() => move(i, i - 1)}>前へ</button>
              <button disabled={i === slots.length - 1} onClick={() => move(i, i + 1)}>後ろへ</button>
              <button onClick={() => setSlots(slots.filter((_, k) => k !== i))}>外す</button>
            </>}
          </li>
        ))}
      </ol>
      <div className="rtm-actions">
        <button disabled={slots.length >= MAX_CONSIST_CARS} onClick={() => setSlots([...slots, { id: lead.middleId ?? lead.id, reversed: false }])}>1両追加</button>
        <button disabled={slots.some(s => !vehicles.some(v => v.id === s.id))} onClick={() => void save(slots)}>編成を保存</button>
        {lead.formation && <button onClick={() => void save()}>自動編成に戻す</button>}
        <button onClick={onDone}>キャンセル</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
