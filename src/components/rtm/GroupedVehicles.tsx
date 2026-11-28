import type { ReactNode } from "react";
import { groupVehiclesBySource, isFreightCar, type RtmVehicle } from "@/lib/rtm/pack";
import { VehiclePreview, type DrawVehiclePreview } from "./VehiclePreview";

type VehicleGroups = ReturnType<typeof groupVehiclesBySource>;

export function VehicleOptions({ groups }: { groups: VehicleGroups }) {
  return groups.map(([source, vehicles]) => (
    <optgroup key={source} label={source}>
      {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
    </optgroup>
  ));
}

export function GroupedVehicles({ groups, drawPreview, label, actions }: {
  groups: VehicleGroups;
  drawPreview: DrawVehiclePreview;
  label: string;
  actions: (vehicle: RtmVehicle) => ReactNode;
}) {
  return (
    <div className="rtm-vehicle-choices" role="group" aria-label={label}>
      {groups.map(([source, vehicles]) => (
        <section key={source} className="rtm-vehicle-group" aria-label={source}>
          <h4>{source} <small className="muted">{vehicles.length}両</small></h4>
          <ul>
            {vehicles.map(vehicle => (
              <li key={vehicle.id}>
                <VehiclePreview view="side" vehicle={vehicle} drawPreview={drawPreview} />
                <span className="rtm-vehicle-choice-name">
                  {vehicle.name}<small className="muted">
                    {vehicle.role === "cab" ? "先頭車" : vehicle.role === "middle" ? "中間車" : isFreightCar(vehicle) ? "貨車" : "種別未判定"}
                  </small>
                </span>
                {actions(vehicle)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
