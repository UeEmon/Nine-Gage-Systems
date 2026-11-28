import type { ReactNode } from "react";
import { autoMiddleFor, findRtmVehicle, isFreightCar, type RtmFormation, type RtmVehicle } from "@/lib/rtm/pack";
import { VehiclePreview, type DrawVehiclePreview } from "./VehiclePreview";

const TRAIN_TYPES: Record<string, string> = {
  EC: "電車", DC: "気動車", EL: "電気機関車", DL: "ディーゼル機関車", SL: "蒸気機関車", CC: "コンテナ車", TC: "タンク車",
};

export function FormationList({ entries, vehicles, drawPreview, actions }: {
  entries: (RtmVehicle | RtmFormation)[];
  vehicles: RtmVehicle[];
  drawPreview: DrawVehiclePreview;
  actions: (entry: RtmVehicle | RtmFormation) => ReactNode;
}) {
  return (
    <ul className="rtm-list" aria-label="登録済みの編成">
      {entries.map(entry => {
        const lead = "config" in entry ? entry : undefined;
        const first = entry.formation?.[0];
        const front = first ? findRtmVehicle(vehicles, first.id) : lead;
        const selectedMiddle = autoMiddleFor(vehicles, lead);
        const cars = entry.formation?.map(slot => findRtmVehicle(vehicles, slot.id)?.name ?? "未読込の車両");
        const summary = cars
          ? cars.join(" → ")
          : selectedMiddle ? `先頭・最後尾 ${entry.name} ／ 中間 ${selectedMiddle.name}` : "同じ車両で連結";
        const detail = lead ? `${isFreightCar(lead) ? "貨車" : TRAIN_TYPES[lead.config.trainType] ?? lead.config.trainType}・${lead.source}` : "手動編成";
        return (
          <li key={entry.id} className="rtm-vehicle-row">
            <VehiclePreview key={`${front?.id}:${first?.reversed}`} vehicle={front} reversed={first?.reversed} drawPreview={drawPreview} />
            <div className="rtm-vehicle-details">
              <div className="rtm-name">
                <b>{entry.name}</b>
                <span className="muted">
                  {cars ? `${cars.length}両編成` : "自動編成"}・{detail}
                </span>
              </div>
              <p className="rtm-formation-summary">{summary}</p>
              <div className="rtm-actions">{actions(entry)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
