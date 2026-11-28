"use client";

import { useMemo, useState } from "react";
import { MAX_CONSIST_CARS, type RtmSlot } from "@/lib/drive";
import { autoFormationSlots, autoMiddleFor, findRtmVehicle, groupVehiclesBySource, vehicleId, type RtmVehicle } from "@/lib/rtm/pack";
import { GroupedVehicles, VehicleOptions } from "./GroupedVehicles";
import { FormationSideView } from "./FormationSideView";
import { VehiclePreview, type DrawVehiclePreview } from "./VehiclePreview";

export function FormationEditor({ name, initialSlots, defaultCarId, source, vehicles, drawPreview, onSave, onReset, onDone }: {
  name: string;
  initialSlots: RtmSlot[];
  defaultCarId: string;
  source?: string;
  vehicles: RtmVehicle[];
  drawPreview: DrawVehiclePreview;
  onSave: (slots: RtmSlot[], name: string) => Promise<void>;
  onReset?: () => Promise<void>;
  onDone: () => void;
}) {
  const automatic = source !== undefined;
  const groups = useMemo(() => groupVehiclesBySource(source === undefined ? vehicles : vehicles.filter(vehicle => vehicle.source === source)), [source, vehicles]);
  const [pickSlot, setPickSlot] = useState<number | null>(null);
  const [draftName, setDraftName] = useState(name);
  const [slots, setSlots] = useState(initialSlots);
  const [autoCount, setAutoCount] = useState(initialSlots.length);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const first = slots[0];
  const front = findRtmVehicle(vehicles, first.id);
  const autoMiddle = autoMiddleFor(vehicles, front);
  const change = (i: number, patch: Partial<RtmSlot>) => setSlots(current => current.map((s, k) => k === i ? { ...s, ...patch } : s));
  const choose = (i: number, id: string) => {
    change(i, { id });
    setPickSlot(null);
  };
  const move = (i: number, j: number) => {
    setPickSlot(null);
    setSlots(current => {
      if (i < 0 || j < 0 || i >= current.length || j >= current.length || i === j) return current;
      const next = current.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const slotCars = slots.map(slot => findRtmVehicle(vehicles, slot.id));
  const saveSlots = () => {
    const formation = slots.map((slot, i) => {
      const car = slotCars[i];
      return car ? { ...slot, id: vehicleId(car.name, car.source) } : slot;
    });
    return onSave(formation, draftName.trim());
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
      <legend>{!automatic ? "手動編成" : `${name} の編成`}（{slots.length}両）</legend>
      {automatic && <div className="rtm-actions">
        <label>両数 <select value={autoCount} onChange={e => setAutoCount(Number(e.target.value))}>
          {Array.from({ length: MAX_CONSIST_CARS }, (_, i) => <option key={i} value={i + 1}>{i + 1}両</option>)}
        </select></label>
        <button disabled={!front || front.source !== source} onClick={() => {
          setPickSlot(null);
          if (front) setSlots(autoFormationSlots(front.id, autoMiddle?.id, autoCount));
        }}>この両数で自動編成</button>
      </div>}
      {!automatic && <label>編成名 <input value={draftName} maxLength={60} onChange={e => setDraftName(e.target.value)} /></label>}
      <div className="rtm-formation-preview">
        <VehiclePreview key={`${first.id}:${first.reversed}`} vehicle={front} reversed={first.reversed} drawPreview={drawPreview} />
        <FormationSideView slots={slots} vehicles={vehicles} disabled={saving} onSwap={move} />
      </div>
      <ol>
        {slots.map((slot, i) => {
          const car = slotCars[i];
          const label = i === 0 ? "先頭車" : `${i + 1}両目の車両`;
          return (
            <li key={i}>
              <label>
                {i === 0 && "先頭車 "}
                <select aria-label={label} value={car?.id ?? slot.id} onChange={e => choose(i, e.target.value)}>
                  {!car && <option value={slot.id}>未読込の車両</option>}
                  {car && automatic && car.source !== source && <option value={car.id}>{car.name}（{car.source}）</option>}
                  <VehicleOptions groups={groups} />
                </select>
              </label>
              <button aria-pressed={pickSlot === i} onClick={() => setPickSlot(current => current === i ? null : i)}>側面から選ぶ</button>
              <label><input type="checkbox" checked={slot.reversed} onChange={e => change(i, { reversed: e.target.checked })} />逆向き</label>
              <button disabled={i === 0} onClick={() => move(i, i - 1)}>前へ</button>
              <button disabled={i === slots.length - 1} onClick={() => move(i, i + 1)}>後ろへ</button>
              {i > 0 && <button onClick={() => {
                setPickSlot(null);
                setSlots(slots.filter((_, k) => k !== i));
              }}>編成から外す</button>}
              {pickSlot === i && (
                <GroupedVehicles groups={groups} drawPreview={drawPreview} label={`${label}を側面から選ぶ`} actions={vehicle => (
                  <button disabled={vehicle === car} onClick={() => choose(i, vehicle.id)}
                    aria-label={`${vehicle.name}（${vehicle.source}）を選ぶ`}>{vehicle === car ? "選択中" : "選ぶ"}</button>
                )} />
              )}
            </li>
          );
        })}
      </ol>
      <div className="rtm-actions">
        <button disabled={slots.length >= MAX_CONSIST_CARS || vehicles.length === 0} onClick={() => setSlots([...slots, { id: defaultCarId || front?.id || vehicles[0].id, reversed: false }])}>1両追加</button>
        <button disabled={!draftName.trim() || slotCars.some(car => !car)} onClick={() => void save(saveSlots)}>編成を保存</button>
        {onReset && <button onClick={() => void save(onReset)}>自動編成に戻す</button>}
        <button onClick={onDone}>キャンセル</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
