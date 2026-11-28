import { useState } from "react";
import { readVehicleFiles, type RtmVehicle } from "@/lib/rtm/pack";
import { deleteRtmVehicle, saveRtmVehicles, updateRtmVehicle } from "@/lib/rtm/store";
import { VehicleFrontPreview, type DrawFront } from "./VehicleFrontPreview";

export function VehicleRegistration({ vehicles, drawFront }: { vehicles: RtmVehicle[]; drawFront: DrawFront }) {
  const [manageId, setManageId] = useState("");
  const managed = vehicles.find(vehicle => vehicle.id === manageId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState<{ added: number; problems: string[] } | null>(null);
  const write = async (save: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await save();
    } catch {
      setError("登録車両の変更を保存できませんでした。");
    } finally {
      setBusy(false);
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
        await saveRtmVehicles(r.vehicles);
        setManageId(r.vehicles[0].id);
      }
      setMessage({ added: r.vehicles.length, problems: r.problems });
    } catch (e) {
      setMessage({ added: 0, problems: [e instanceof Error ? e.message : "読み込めませんでした"] });
    } finally {
      setBusy(false);
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
          {busy ? "読み込み中…" : "車両パックを登録"}
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
        <fieldset className="rtm-vehicle-management" disabled={busy}>
          <legend>個別車両の管理</legend>
          <div className="rtm-actions">
            {managed && <VehicleFrontPreview vehicle={managed} drawFront={drawFront} />}
            <label>
              車両
              <select value={managed?.id ?? ""} onChange={e => setManageId(e.target.value)}>
                <option value="">車両を選ぶ</option>
                {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
              </select>
            </label>
            <button className="danger" disabled={!managed} onClick={() => managed && window.confirm(`登録車両「${managed.name}」を削除しますか？`) && void write(() => deleteRtmVehicle(managed.id))}>登録車両を削除</button>
            {managed && <label>
              <input type="checkbox" checked={!!managed.flip} onChange={e => void write(() => updateRtmVehicle(managed.id, { flip: e.target.checked }))} />
              前後を入れ替える
            </label>}
          </div>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="hint">登録すると、先頭車ごとの編成が「自動編成」に追加されます。暗号化モデル（.npm）やスクリプトによる動作には対応していません。</p>
    </section>
  );
}
