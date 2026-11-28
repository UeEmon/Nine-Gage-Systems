"use client";

import { useEffect } from "react";
import { rtmConsists, type RtmLibrary } from "@/lib/rtm/pack";
import { FormationList } from "./FormationList";
import { useDrawVehicleFront } from "./VehicleFrontPreview";

export function RtmVehiclesDialog({ library, error, onClose, onPick, pickLabel = "この編成で走る" }: {
  library: RtmLibrary | null;
  error: string;
  onClose: () => void;
  onPick?: (id: string, library: RtmLibrary) => void;
  pickLabel?: string;
}) {
  const drawFront = useDrawVehicleFront();
  const entries = rtmConsists(library);
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

  return (
    <div className="rtm-backdrop" onClick={onClose}>
      <div className="rtm-dialog" role="dialog" aria-modal="true" aria-label="RTMの編成" onClick={e => e.stopPropagation()}>
        <header><h3>RTMの編成</h3><button onClick={onClose}>閉じる</button></header>
        {error && <p role="alert">{error}</p>}
        {!error && !library && <p role="status">読み込み中…</p>}
        {library && (entries.length ? (
          <FormationList entries={entries} vehicles={library.vehicles} drawFront={drawFront}
            actions={entry => onPick && <button onClick={() => onPick(entry.id, library)}>{pickLabel}</button>} />
        ) : <p>選択できる編成がありません。RTM車両管理から車両パックを登録してください。</p>)}
        <a className="button" href="/rtm" target="_blank" rel="noopener">RTM車両管理を開く（別タブ）</a>
      </div>
    </div>
  );
}
