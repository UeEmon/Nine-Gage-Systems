"use client";

import { useEffect, useState } from "react";
import { middleCandidates, readVehicleFiles, type RtmVehicle } from "@/lib/rtm/pack";
import { deleteRtmVehicle, listRtmVehicles, RTM_CHANGED_EVENT, saveRtmVehicles, updateRtmVehicle } from "@/lib/rtm/store";

/** このブラウザに読み込んだ RealTrainMod の車両（読み込み中は null） */
export function useRtmVehicles(): RtmVehicle[] | null {
  const [vehicles, setVehicles] = useState<RtmVehicle[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      listRtmVehicles()
        .then((v) => alive && setVehicles(v))
        .catch(() => alive && setVehicles([]));
    load();
    window.addEventListener(RTM_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(RTM_CHANGED_EVENT, load);
    };
  }, []);
  return vehicles;
}

const ROLE_LABEL = { cab: "先頭車", middle: "中間車" } as const;

const TRAIN_TYPES: Record<string, string> = {
  EC: "電車", DC: "気動車", EL: "電気機関車", DL: "ディーゼル機関車", SL: "蒸気機関車", CC: "コンテナ車", TC: "タンク車",
};

/** RealTrainMod の車両パックを読み込む・管理するダイアログ */
export function RtmVehiclesDialog({
  onClose,
  onPick,
  pickLabel = "この車両で走る",
}: {
  onClose: () => void;
  /** 車両を選んだとき（なければ選ぶボタンを出さない） */
  onPick?: (id: string) => void;
  pickLabel?: string;
}) {
  const vehicles = useRtmVehicles();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ added: string[]; problems: string[] } | null>(null);
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
      if (r.vehicles.length > 0) await saveRtmVehicles(r.vehicles);
      setMessage({ added: r.vehicles.map((v) => v.name), problems: r.problems });
    } catch (e) {
      setMessage({ added: [], problems: [e instanceof Error ? e.message : "読み込めませんでした"] });
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
            {message.added.length > 0 && <p>{message.added.length}両を読み込みました：{message.added.join("、")}</p>}
            {message.problems.length > 0 && (
              <ul className="warn-text">
                {message.problems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}
                {message.problems.length > 8 && <li>ほか{message.problems.length - 8}件</li>}
              </ul>
            )}
          </div>
        )}
        {vehicles && vehicles.length > 0 && (
          <ul className="rtm-list">
            {vehicles.map((v) => (
              <li key={v.id}>
                <div className="rtm-name">
                  <b>{v.name}</b>
                  <span className="muted">
                    {v.role ? `${ROLE_LABEL[v.role]}・` : ""}{TRAIN_TYPES[v.config.trainType] ?? v.config.trainType}・{v.source}
                  </span>
                </div>
                <div className="rtm-actions">
                  <label title="先頭が後ろ向きに表示されるときに使います">
                    <input type="checkbox" checked={!!v.flip} onChange={(e) => void updateRtmVehicle(v.id, { flip: e.target.checked })} />
                    前後を入れ替える
                  </label>
                  {v.role === "middle" ? (
                    <span className="muted">中間車だけでは走らせません。先頭車の「中間車」で選んでください</span>
                  ) : (
                    <>
                      <label>
                        中間車
                        <select value={v.middleId ?? ""} onChange={(e) => void updateRtmVehicle(v.id, { middleId: e.target.value || undefined })}>
                          <option value="">この車両と同じ</option>
                          {middleCandidates(vehicles, v).map((x) => (
                            <option key={x.id} value={x.id}>{x.name}{x.role ? `（${ROLE_LABEL[x.role]}）` : ""}</option>
                          ))}
                        </select>
                      </label>
                      {onPick && <button onClick={() => onPick(v.id)}>{pickLabel}</button>}
                    </>
                  )}
                  <button className="danger" onClick={() => void deleteRtmVehicle(v.id)}>削除</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {vehicles && vehicles.length === 0 && !message && <p className="muted">まだ車両を読み込んでいません。</p>}
        <p className="muted rtm-help">
          先頭車と最後尾はこの車両（最後尾は向きを逆に）、中間車は「中間車」で選んだ車両になります。
          車両パックの中で先頭車と中間車を見分けられたとき（形式名の Tc・Mc と T・M など）は、読み込んだときに先頭車に合う中間車を自動で選びます（あとから変えられます）。中間車は単独では選べず、両端が先頭車、そのあいだが選んだ中間車の編成になります。車両は実物の 1/150 の長さで表示し、運行計画の編成の長さやホームに収まる両数も、その車両の長さで計算します。
          ドアやパンタグラフの動き（スクリプト）と、暗号化されたモデル（.npm）には対応していません。
        </p>
      </div>
    </div>
  );
}
