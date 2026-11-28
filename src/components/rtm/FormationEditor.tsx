"use client";

import { useState } from "react";
import { MAX_CONSIST_CARS, type RtmSlot } from "@/lib/drive";
import type { RtmVehicle } from "@/lib/rtm/pack";
import { FormationSideView } from "./FormationSideView";
import { VehicleFrontPreview, type DrawFront } from "./VehicleFrontPreview";

export function FormationEditor({ name, initialSlots, defaultCarId, manual, vehicles, drawFront, onSave, onReset, onDone }: {
  name: string;
  initialSlots: RtmSlot[];
  defaultCarId: string;
  manual: boolean;
  vehicles: RtmVehicle[];
  drawFront: DrawFront;
  onSave: (slots: RtmSlot[], name: string) => Promise<void>;
  onReset?: () => Promise<void>;
  onDone: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [slots, setSlots] = useState(initialSlots);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const first = slots[0];
  const front = vehicles.find(vehicle => vehicle.id === first.id);
  const change = (i: number, patch: Partial<RtmSlot>) => setSlots(current => current.map((s, k) => k === i ? { ...s, ...patch } : s));
  const move = (i: number, j: number) => {
    setSlots(current => {
      if (i < 0 || j < 0 || i >= current.length || j >= current.length || i === j) return current;
      const next = current.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const save = async (write: () => Promise<void>) => {
    setSaving(true);
    setError("");
    try {
      await write();
      onDone();
    } catch {
      setError("編成を保存できませんでした。");
      setSaving(false);
    }
  };
  return (
    <fieldset disabled={saving} className="rtm-formation">
      <legend>{manual ? "手動編成" : `${name} の編成`}（{slots.length}両）</legend>
      {manual && <label>編成名 <input value={draftName} maxLength={60} onChange={e => setDraftName(e.target.value)} /></label>}
      <div className="rtm-formation-preview">
        <VehicleFrontPreview key={`${first.id}:${first.reversed}`} vehicle={front} reversed={first.reversed} drawFront={drawFront} />
        <FormationSideView slots={slots} vehicles={vehicles} disabled={saving} onSwap={move} />
      </div>
      <ol>
        {slots.map((slot, i) => (
          <li key={i}>
            <label>
              {i === 0 && "先頭車 "}
              <select aria-label={i === 0 ? "先頭車" : `${i + 1}両目の車両`} value={slot.id} onChange={e => change(i, { id: e.target.value })}>
                {!vehicles.some(v => v.id === slot.id) && <option value={slot.id}>未読込の車両</option>}
                {vehicles.map(v => <option value={v.id} key={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label><input type="checkbox" checked={slot.reversed} onChange={e => change(i, { reversed: e.target.checked })} />逆向き</label>
            <button disabled={i === 0} onClick={() => move(i, i - 1)}>前へ</button>
            <button disabled={i === slots.length - 1} onClick={() => move(i, i + 1)}>後ろへ</button>
            {i > 0 && <button onClick={() => setSlots(slots.filter((_, k) => k !== i))}>編成から外す</button>}
          </li>
        ))}
      </ol>
      <div className="rtm-actions">
        <button disabled={slots.length >= MAX_CONSIST_CARS || vehicles.length === 0} onClick={() => setSlots([...slots, { id: defaultCarId || front?.id || vehicles[0].id, reversed: false }])}>1両追加</button>
        <button disabled={!draftName.trim() || slots.some(s => !vehicles.some(v => v.id === s.id))} onClick={() => void save(() => onSave(slots, draftName.trim()))}>編成を保存</button>
        {onReset && <button onClick={() => void save(onReset)}>自動編成に戻す</button>}
        <button onClick={onDone}>キャンセル</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
