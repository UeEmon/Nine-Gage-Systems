// 読み込んだ RealTrainMod の車両を、このブラウザ（IndexedDB）に保存する。サーバーには送らない。

import type { RtmFormation, RtmLibrary, RtmVehicle } from "./pack";

const DB = "senrolab-rtm";
const VEHICLES = "vehicles";
const FORMATIONS = "formations";
export const RTM_CHANGED_EVENT = "senrolab-rtm-vehicles-changed";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("このブラウザでは車両を保存できません"));
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = ({ oldVersion }) => {
      if (oldVersion === 0) req.result.createObjectStore(VEHICLES, { keyPath: "id" });
      req.result.createObjectStore(FORMATIONS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("車両の保存先を開けませんでした"));
  });
}

async function run(store: string, fn: (s: IDBObjectStore) => void): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      fn(tx.objectStore(store));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("車両の保存に失敗しました"));
      tx.onabort = () => reject(tx.error ?? new Error("車両の保存に失敗しました"));
    });
  } finally {
    db.close();
  }
}

const changed = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RTM_CHANGED_EVENT));
};

export async function loadRtmLibrary(): Promise<RtmLibrary> {
  const db = await open();
  try {
    return await new Promise<RtmLibrary>((resolve, reject) => {
      const tx = db.transaction([VEHICLES, FORMATIONS], "readonly");
      const vehicles = tx.objectStore(VEHICLES).getAll() as IDBRequest<RtmVehicle[]>;
      const formations = tx.objectStore(FORMATIONS).getAll() as IDBRequest<RtmFormation[]>;
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "ja");
      tx.oncomplete = () => resolve({ vehicles: vehicles.result.sort(byName), formations: formations.result.sort(byName) });
      tx.onabort = () => reject(tx.error ?? new Error("車両を読み込めませんでした"));
    });
  } finally {
    db.close();
  }
}

/** 車両を保存する（同じ ID の車両は置き換える。前後の向き・中間車の設定は引き継ぐ） */
export async function saveRtmVehicles(vehicles: RtmVehicle[]): Promise<void> {
  await run(VEHICLES, (s) => {
    for (const v of vehicles) {
      const req = s.get(v.id);
      req.onsuccess = () => {
        const old: RtmVehicle | undefined = req.result;
        s.put({ ...v, flip: old?.flip ?? v.flip, middleId: old?.middleId ?? v.middleId, formation: old?.formation });
      };
    }
  });
  changed();
}

export async function updateRtmVehicle(id: string, patch: Partial<Pick<RtmVehicle, "flip" | "middleId" | "formation">>): Promise<void> {
  await run(VEHICLES, (s) => {
    const req = s.get(id);
    req.onsuccess = () => {
      if (req.result) s.put({ ...req.result, ...patch });
    };
  });
  changed();
}

export async function deleteRtmVehicle(id: string): Promise<void> {
  await run(VEHICLES, (s) => s.delete(id));
  changed();
}

export async function saveRtmFormation(formation: RtmFormation): Promise<void> {
  await run(FORMATIONS, (s) => s.put(formation));
  changed();
}

export async function deleteRtmFormation(id: string): Promise<void> {
  await run(FORMATIONS, (s) => s.delete(id));
  changed();
}
