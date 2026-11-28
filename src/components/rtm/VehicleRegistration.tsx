import { useMemo, useState } from "react";
import { autoMiddleFor, findRtmVehicle, groupVehiclesBySource, readVehicleFiles, rtmConsists, type RtmLibrary, type RtmVehicle } from "@/lib/rtm/pack";
import { deleteRtmVehicles, saveRtmVehicles, updateRtmVehicle } from "@/lib/rtm/store";
import { GroupedVehicles, VehicleOptions } from "./GroupedVehicles";
import { VehiclePreview, type DrawVehiclePreview } from "./VehiclePreview";

export function VehicleRegistration({ library, drawPreview }: { library: RtmLibrary; drawPreview: DrawVehiclePreview }) {
  const { vehicles } = library;
  const [manageId, setManageId] = useState("");
  const managed = findRtmVehicle(vehicles, manageId);
  const groups = useMemo(() => groupVehiclesBySource(vehicles), [vehicles]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selected = vehicles.filter(vehicle => selectedIds.has(vehicle.id));
  const [busy, setBusy] = useState<"import" | "update" | "delete" | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState<{ added: number; problems: string[] } | null>(null);
  const write = async (action: "update" | "delete", save: () => Promise<void>) => {
    setBusy(action);
    setError("");
    setDeleted(false);
    try {
      await save();
    } catch {
      setError("登録車両の変更を保存できませんでした。");
    } finally {
      setBusy(null);
    }
  };

  const remove = (cars: RtmVehicle[]) => {
    if (!cars.length) return;
    const ids = new Set(cars.map(car => car.id));
    const deleting = (id: string | undefined) => {
      const vehicle = findRtmVehicle(vehicles, id);
      return vehicle !== undefined && ids.has(vehicle.id);
    };
    const affected = rtmConsists(library).filter(entry => {
      if ("config" in entry && ids.has(entry.id)) return true;
      if (entry.formation?.length) return entry.formation.some(slot => deleting(slot.id));
      return "config" in entry && deleting(autoMiddleFor(vehicles, entry)?.id);
    });
    const names = (items: { name: string }[]) => {
      const limit = 6;
      const preview = items.slice(0, limit).map(item => item.name).join("、");
      return items.length > limit ? `${preview} ほか${items.length - limit}件` : preview;
    };
    const warning = affected.length
      ? `\n\n影響を受ける編成（${affected.length}件）\n${names(affected)}\n削除した先頭車にひもづく自動編成は一覧から外れます。ほかの編成で使っていた車両は、再登録するか編成を設定し直してください。`
      : "";
    if (!window.confirm(`登録車両を${cars.length}両削除しますか？\n${names(cars)}${warning}`)) return;
    void write("delete", async () => {
      await deleteRtmVehicles([...ids]);
      setSelectedIds(current => new Set([...current].filter(id => !ids.has(id))));
      setManageId(current => deleting(current) ? "" : current);
      setMessage(null);
      setDeleted(true);
    });
  };

  const toggle = (id: string, checked: boolean) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy("import");
    setError("");
    setDeleted(false);
    setMessage(null);
    try {
      // フォルダを選んだときは、使うファイルだけ読む（音などは読まない）
      const picked = [...list].filter((f) => /\.(zip|jar|json|mqo|mqoz|obj|mtl|png|jpe?g|npm|ngto|rar|7z|lzh)$/i.test(f.name));
      const files = await Promise.all(
        picked.map(async (f) => ({ name: f.name, path: f.webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) })),
      );
      const r = await readVehicleFiles(files);
      if (r.vehicles.length > 0) {
        await saveRtmVehicles(r.vehicles);
        setManageId(r.vehicles[0].id);
      }
      setMessage({ added: r.vehicles.length, problems: r.problems });
    } catch (e) {
      setMessage({ added: 0, problems: [e instanceof Error ? e.message : "読み込めませんでした"] });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <h2>車両登録（{vehicles.length}両）</h2>
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
          {busy === "import" ? "読み込み中…" : "車両パックを登録"}
          <input
            type="file"
            multiple
            disabled={!!busy}
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
            disabled={!!busy}
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
        <div className="rtm-result" role="status">
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
        <fieldset className="rtm-vehicle-management" disabled={!!busy}>
          <legend>個別車両の管理</legend>
          <div className="rtm-actions">
            {managed && <VehiclePreview vehicle={managed} drawPreview={drawPreview} />}
            <label>
              車両
              <select value={managed?.id ?? ""} onChange={e => setManageId(e.target.value)}>
                <option value="">車両を選ぶ</option>
                <VehicleOptions groups={groups} />
              </select>
            </label>
            <button className="danger" disabled={!managed} onClick={() => managed && remove([managed])}>登録車両を削除</button>
            {managed && <label>
              <input type="checkbox" checked={!!managed.flip} onChange={e => void write("update", () => updateRtmVehicle(managed.id, { flip: e.target.checked }))} />
              前後を入れ替える
            </label>}
          </div>
          <details className="rtm-bulk-delete" open>
            <summary>登録車両の一覧・一括削除</summary>
            <div className="rtm-actions">
              <button disabled={selected.length === vehicles.length} onClick={() => setSelectedIds(new Set(vehicles.map(vehicle => vehicle.id)))}>全選択</button>
              <button disabled={!selected.length} onClick={() => setSelectedIds(new Set())}>選択を解除</button>
              <span role="status">{selected.length}両を選択中</span>
            </div>
            <GroupedVehicles groups={groups} drawPreview={drawPreview} label="削除する車両" actions={vehicle => (
              <input type="checkbox" aria-label={`${vehicle.name}（${vehicle.source}）を削除対象にする`}
                checked={selectedIds.has(vehicle.id)} onChange={e => toggle(vehicle.id, e.target.checked)} />
            )} />
            <button className="danger" disabled={!selected.length} onClick={() => remove(selected)}>
              {busy === "delete" ? "削除中…" : "選択した車両を削除"}
            </button>
          </details>
        </fieldset>
      )}
      {deleted && <p role="status">登録車両を削除しました。</p>}
      {error && <p role="alert">{error}</p>}
      <p className="hint">登録すると、先頭車ごとの編成が「自動編成」に追加されます。暗号化モデル（.npm）やスクリプトによる動作には対応していません。</p>
    </section>
  );
}
