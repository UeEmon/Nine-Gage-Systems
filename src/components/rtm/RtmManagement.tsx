"use client";

import { useState } from "react";
import { autoFormationSlots, leadVehicles, middleCandidates, type RtmVehicle, type RtmFormation } from "@/lib/rtm/pack";
import { deleteRtmFormation, saveRtmFormation, updateRtmVehicle } from "@/lib/rtm/store";
import { FormationEditor } from "./FormationEditor";
import { FormationList } from "./FormationList";
import { useDrawVehicleFront } from "./VehicleFrontPreview";
import { VehicleRegistration } from "./VehicleRegistration";
import { useRtmLibrary } from "./useRtmLibrary";

const sections = { register: "車両登録", auto: "自動編成", manual: "手動編成" };

export function RtmManagement() {
  const { library, error } = useRtmLibrary();
  const [section, setSection] = useState<keyof typeof sections>("register");
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const drawFront = useDrawVehicleFront();
  if (!library) return <p role={error ? "alert" : "status"}>{error || "車両と編成を読み込み中…"}</p>;
  const { vehicles, formations } = library;
  const automatic = leadVehicles(vehicles);
  const entries = section === "auto" ? automatic : formations;
  const lead = automatic.find(vehicle => vehicle.id === editId);
  const manual = formations.find(formation => formation.id === editId);
  const middle = lead && vehicles.find(vehicle => vehicle.id === lead.middleId);
  const starter = automatic[0] ?? vehicles[0];
  const slots = lead ? lead.formation ?? autoFormationSlots(lead.id, middle?.id, 3)
    : manual?.formation ?? (editId === "new" && starter ? [{ id: starter.id, reversed: false }] : undefined);

  const write = async (action: () => Promise<void>) => {
    setSaving(true);
    setSaveError("");
    try {
      await action();
    } catch {
      setSaveError("編成の変更を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  };
  const remove = (entry: RtmVehicle | RtmFormation) => {
    const auto = "config" in entry;
    const detail = auto ? "\n登録済みの車両は手動編成に使えます。パックを再登録するとこの編成を復元できます。" : "";
    if (window.confirm(`編成「${entry.name}」を削除しますか？${detail}`)) {
      void write(() => auto ? updateRtmVehicle(entry.id, { autoFormationDeleted: true }) : deleteRtmFormation(entry.id));
    }
  };
  return (
    <>
      <nav className="rtm-sections" aria-label="RTM車両管理メニュー">
        {(Object.keys(sections) as (keyof typeof sections)[]).map(key => (
          <button key={key} aria-pressed={section === key} onClick={() => {
            setSection(key);
            if (section !== key) { setEditId(null); setSaveError(""); }
          }}>{sections[key]}</button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      <div hidden={section !== "register"}><VehicleRegistration vehicles={vehicles} drawFront={drawFront} /></div>
      {section !== "register" && (
        <section className="card">
          <h2>{sections[section]}（{entries.length}件）</h2>
          <p className="muted">{section === "auto"
            ? "パックの先頭車ごとに編成を作成します。最後尾は逆向きになり、両数は運行計画に合わせて変わります。「編成を設定」で両数を固定できます。"
            : "登録した車両をパックをまたいで組み合わせ、名前を付けて保存できます。"}</p>
          {section === "manual" && <button disabled={!vehicles.length || !!slots} onClick={() => setEditId("new")}>手動編成を作成</button>}
          {slots && (
            <FormationEditor
              key={editId}
              name={lead?.name ?? manual?.name ?? ""}
              initialSlots={slots}
              defaultCarId={middle?.id ?? lead?.id ?? ""}
              automatic={!!lead}
              vehicles={vehicles}
              drawFront={drawFront}
              onSave={(formation, name) => lead
                ? updateRtmVehicle(lead.id, { formation })
                : saveRtmFormation({ id: manual?.id ?? `f${crypto.randomUUID().replaceAll("-", "")}`, name, formation })}
              onReset={lead?.formation ? () => updateRtmVehicle(lead.id, { formation: undefined }) : undefined}
              onDone={() => setEditId(current => current === editId ? null : current)}
            />
          )}
          {saveError && <p role="alert">{saveError}</p>}
          {entries.length > 0 ? (
            <FormationList entries={entries} vehicles={vehicles} drawFront={drawFront} actions={entry => (
              <>
                <button disabled={!!slots || saving} onClick={() => setEditId(entry.id)}>編成を設定</button>
                {"config" in entry && !entry.formation?.length && <label>
                  中間車
                  <select disabled={saving || !!slots} value={vehicles.find(v => v.id === entry.middleId)?.id ?? ""}
                    onChange={e => {
                      const middleId = e.target.value || undefined;
                      void write(() => updateRtmVehicle(entry.id, { middleId }));
                    }}>
                    <option value="">先頭車と同じ</option>
                    {middleCandidates(vehicles, entry).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </label>}
                <button className="danger" disabled={saving || !!slots} onClick={() => remove(entry)}>編成を削除</button>
              </>
            )} />
          ) : <p className="hint">{vehicles.length ? `${sections[section]}はまだありません。` : "「車両登録」から車両パックを登録してください。"}</p>}
        </section>
      )}
    </>
  );
}
