"use client";

import { useEffect, useState } from "react";
import { isFreightCar, leadVehicles, middleCandidates, readVehicleFiles, rtmConsists, type RtmLibrary } from "@/lib/rtm/pack";
import { FormationEditor } from "./FormationEditor";
import { useDrawVehicleFront, VehicleFrontPreview } from "./VehicleFrontPreview";
import { deleteRtmFormation, deleteRtmVehicle, loadRtmLibrary, RTM_CHANGED_EVENT, saveRtmFormation, saveRtmVehicles, updateRtmVehicle } from "@/lib/rtm/store";

/** このブラウザに保存した RTM 車両と手動編成（読み込み中は null） */
export function useRtmLibrary(): RtmLibrary | null {
  const [library, setLibrary] = useState<RtmLibrary | null>(null);
  useEffect(() => {
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void loadRtmLibrary().then(
        result => { if (current === revision) setLibrary(result); },
        () => { if (current === revision) setLibrary({ vehicles: [], formations: [] }); },
      );
    };
    refresh();
    window.addEventListener(RTM_CHANGED_EVENT, refresh);
    return () => {
      revision++;
      window.removeEventListener(RTM_CHANGED_EVENT, refresh);
    };
  }, []);
  return library;
}

const TRAIN_TYPES: Record<string, string> = {
  EC: "電車", DC: "気動車", EL: "電気機関車", DL: "ディーゼル機関車", SL: "蒸気機関車", CC: "コンテナ車", TC: "タンク車",
};
const NEW_FORMATION = "new";
const REMOVALS = {
  vehicle: { label: "登録車両", write: deleteRtmVehicle },
  manual: { label: "手動編成", write: deleteRtmFormation },
  auto: { label: "パックの編成", write: (id: string) => updateRtmVehicle(id, { autoFormationDeleted: true }) },
};

/** RealTrainMod の車両パックを読み込む・管理するダイアログ */
export function RtmVehiclesDialog({
  onClose,
  onPick,
  pickLabel = "この編成で走る",
}: {
  onClose: () => void;
  /** 車両を選んだとき（なければ選ぶボタンを出さない） */
  onPick?: (id: string, library: RtmLibrary) => void;
  pickLabel?: string;
}) {
  const library = useRtmLibrary();
  const vehicles = library?.vehicles ?? [];
  const drawFront = useDrawVehicleFront();
  const [editId, setEditId] = useState<string | null>(null);
  const byId = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const formations = rtmConsists(library);
  const editing = formations.find(entry => entry.id === editId);
  const editLead = editing && "config" in editing ? editing : undefined;
  const editManual = editing && !("config" in editing) ? editing : undefined;
  const starter = editLead ?? formations.find(entry => "config" in entry) ?? vehicles[0];
  const defaultMiddle = editLead && (byId.get(editLead.middleId ?? "")?.id ?? editLead.id);
  const editSlots = editManual?.formation ?? (editLead?.formation?.length ? editLead.formation : undefined)
    ?? (editLead ? [
      { id: editLead.id, reversed: false },
      { id: defaultMiddle ?? editLead.id, reversed: false },
      { id: editLead.id, reversed: true },
    ] : editId === NEW_FORMATION && starter ? [{ id: starter.id, reversed: false }] : undefined);
  const [manageId, setManageId] = useState("");
  const managed = byId.get(manageId);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ added: number; problems: string[] } | null>(null);
  // Esc はこのダイアログだけを閉じる（後ろの運転や運行計画の画面は閉じない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const remove = async (id: string, name: string, kind: keyof typeof REMOVALS) => {
    const { label, write } = REMOVALS[kind];
    const detail = kind === "auto" ? "\n登録済み車両は引き続き手動編成に使えます。" : "";
    if (!window.confirm(`${label}「${name}」を削除しますか？${detail}`)) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await write(id);
      setEditId(current => current === id ? null : current);
      if (kind === "vehicle") setManageId(current => current === id ? "" : current);
    } catch {
      setDeleteError(`${label}を削除できませんでした。`);
    } finally {
      setDeleting(false);
    }
  };

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      // フォルダを選んだときは、使うファイルだけ読む（音などは読まない）
      const picked = [...list].filter((f) => /\.(zip|jar|json|mqo|mqoz|obj|mtl|png|jpe?g|npm|ngto|rar|7z|lzh)$/i.test(f.name));
      const files = await Promise.all(
        picked.map(async (f) => ({ name: f.name, path: f.webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) })),
      );
      const r = await readVehicleFiles(files);
      if (r.vehicles.length > 0) {
        const saved = await saveRtmVehicles(r.vehicles);
        setEditId(leadVehicles(saved)[0]?.id ?? null);
      }
      setMessage({ added: r.vehicles.length, problems: r.problems });
    } catch (e) {
      setMessage({ added: 0, problems: [e instanceof Error ? e.message : "読み込めませんでした"] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rtm-backdrop" onClick={onClose}>
      <div className="rtm-dialog" role="dialog" aria-label="RealTrainMod の車両" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>RealTrainMod の車両</h3>
          <button onClick={onClose}>閉じる</button>
        </header>
        <p className="muted">
          お持ちの RealTrainMod の車両パック（.zip）を選ぶと、その車両で走行の映像を見られます。
          json・モデル（.mqo / .mqoz / .obj）・テクスチャ（.png）をまとめて選んでも読み込めます。
        </p>
        <p className="rtm-note">
          車両パックはそれぞれの作者の利用規約に従って使ってください。読み込んだ車両はこのブラウザの中だけに保存され、SenroLab のサーバーには送られません。
          録画した映像を公開するときは、車両パックの規約で許されているか確かめてください。
        </p>
        <div className="rtm-files">
          <label className="rtm-file">
            {busy ? "読み込み中…" : "車両パックを選ぶ"}
            <input
              type="file"
              multiple
              disabled={busy}
              accept=".zip,.jar,.json,.mqo,.mqoz,.obj,.mtl,.png"
              onChange={(e) => {
                const input = e.currentTarget;
                void onFiles(input.files).finally(() => {
                  input.value = "";
                });
              }}
            />
          </label>
          <label className="rtm-file" title="展開した車両パックのフォルダを選びます">
            展開したフォルダを選ぶ
            <input
              type="file"
              disabled={busy}
              // フォルダを選ぶ（React の型にないので属性で渡す）
              {...({ webkitdirectory: "" } as Record<string, string>)}
              onChange={(e) => {
                const input = e.currentTarget;
                void onFiles(input.files).finally(() => {
                  input.value = "";
                });
              }}
            />
          </label>
        </div>
        {message && (
          <div className="rtm-result">
            {message.added > 0 && <p>{message.added}両を読み込みました。</p>}
            {message.problems.length > 0 && (
              <ul className="warn-text">
                {message.problems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}
                {message.problems.length > 8 && <li>ほか{message.problems.length - 8}件</li>}
              </ul>
            )}
          </div>
        )}
        {vehicles.length > 0 && (
          <fieldset className="rtm-vehicle-management" disabled={deleting}>
            <legend>個別車両の管理</legend>
            <div className="rtm-actions">
              <label>
                車両
                <select value={managed?.id ?? ""} onChange={e => setManageId(e.target.value)}>
                  <option value="">車両を選ぶ</option>
                  {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
                </select>
              </label>
              <button className="danger" disabled={!managed} onClick={() => managed && void remove(managed.id, managed.name, "vehicle")}>登録車両を削除</button>
              {managed && <label>
                <input type="checkbox" checked={!!managed.flip} onChange={e => void updateRtmVehicle(managed.id, { flip: e.target.checked })} />
                前後を入れ替える
              </label>}
            </div>
          </fieldset>
        )}
        {deleteError && <p role="alert">{deleteError}</p>}
        <button disabled={vehicles.length === 0 || editId === NEW_FORMATION} onClick={() => setEditId(NEW_FORMATION)}>手動編成を作成</button>
        {editSlots && (
          <FormationEditor
            key={editId}
            name={editLead?.name ?? editManual?.name ?? ""}
            initialSlots={editSlots}
            defaultCarId={defaultMiddle ?? ""}
            manual={!editLead}
            vehicles={vehicles}
            drawFront={drawFront}
            onSave={(formation, name) => editLead
              ? updateRtmVehicle(editLead.id, { formation })
              : saveRtmFormation({ id: editManual?.id ?? `f${crypto.randomUUID().replaceAll("-", "")}`, name, formation })}
            onReset={editLead?.formation ? () => updateRtmVehicle(editLead.id, { formation: undefined }) : undefined}
            onDone={() => setEditId(current => current === editId ? null : current)}
          />
        )}
        {library && formations.length > 0 && (
          <ul className="rtm-list" aria-label="読み込んだ編成">
            {formations.map(entry => {
              const lead = "config" in entry ? entry : undefined;
              const first = entry.formation?.[0];
              const front = first ? byId.get(first.id) : lead;
              const selectedMiddle = lead?.middleId ? byId.get(lead.middleId) : undefined;
              const cars = entry.formation?.map(slot => byId.get(slot.id)?.name ?? "未読込の車両");
              const summary = cars
                ? cars.join(" → ")
                : selectedMiddle ? `先頭・最後尾 ${entry.name} ／ 中間 ${selectedMiddle.name}` : "同じ車両で連結";
              const detail = lead ? `${isFreightCar(lead) ? "貨車" : TRAIN_TYPES[lead.config.trainType] ?? lead.config.trainType}・${lead.source}` : "手動編成";
              return (
                <li key={entry.id} className="rtm-vehicle-row">
                  <VehicleFrontPreview key={`${front?.id}:${first?.reversed}`} vehicle={front} reversed={first?.reversed} drawFront={drawFront} />
                  <div className="rtm-vehicle-details">
                    <div className="rtm-name">
                      <b>{entry.name}</b>
                      <span className="muted">
                        {cars ? `${cars.length}両編成` : "自動編成"}・{detail}
                      </span>
                    </div>
                    <p className="rtm-formation-summary">{summary}</p>
                    <div className="rtm-actions">
                      {lead && front && <label title={`${front.name} の前後を入れ替えます`}>
                        <input type="checkbox" checked={!!front.flip} onChange={(e) => void updateRtmVehicle(front.id, { flip: e.target.checked })} />
                        前後を入れ替える
                      </label>}
                      <button onClick={() => setEditId(entry.id)}>編成を設定{cars ? `（${cars.length}両）` : ""}</button>
                      {lead && !cars && <label>
                        中間車
                        <select value={selectedMiddle?.id ?? ""} onChange={(e) => void updateRtmVehicle(lead.id, { middleId: e.target.value || undefined })}>
                          <option value="">この車両と同じ</option>
                          {middleCandidates(vehicles, lead).map(vehicle => (
                            <option key={vehicle.id} value={vehicle.id}>{vehicle.name}{vehicle.role === "middle" ? "（中間車）" : ""}</option>
                          ))}
                        </select>
                      </label>}
                      <button className="danger" disabled={deleting} onClick={() => void remove(entry.id, entry.name, lead ? "auto" : "manual")}>編成を削除</button>
                      {onPick && <button disabled={editId === entry.id} onClick={() => onPick(entry.id, library)}>{pickLabel}</button>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {library && vehicles.length === 0 && !message && <p className="muted">まだ車両を読み込んでいません。</p>}
        <p className="muted rtm-help">
          自動編成では先頭車と最後尾はこの車両（最後尾は向きを逆に）、中間車は「中間車」で選んだ車両になります。
          車両パックの中で先頭車と中間車を見分けられたとき（形式名の Tc・Mc と T・M など）は、読み込んだときに先頭車に合う中間車を自動で選びます。「編成を設定」では先頭から最後尾まで車両と向きを指定できます。車両は実物の 1/150 の長さで表示し、運行計画の編成の長さやホームに収まる両数も、その車両の長さで計算します。
          ドアやパンタグラフの動き（スクリプト）と、暗号化されたモデル（.npm）には対応していません。
        </p>
      </div>
    </div>
  );
}
