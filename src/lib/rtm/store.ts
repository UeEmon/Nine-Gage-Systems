// 読み込んだ RealTrainMod の車両を、このブラウザ（IndexedDB）に保存する。サーバーには送らない。

import type { RtmVehicle } from "./pack";

const DB = "senrolab-rtm";
const STORE = "vehicles";
export const RTM_CHANGED_EVENT = "senrolab-rtm-vehicles-changed";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("このブラウザでは車両を保存できません"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("車両の保存先を開けませんでした"));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
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

export async function listRtmVehicles(): Promise<RtmVehicle[]> {
  const all = (await run<RtmVehicle[]>("readonly", (s) => s.getAll() as IDBRequest<RtmVehicle[]>)) ?? [];
  return all.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/** 車両を保存する（同じ ID の車両は置き換える。前後の向き・中間車の設定は引き継ぐ） */
export async function saveRtmVehicles(vehicles: RtmVehicle[]): Promise<void> {
  const before = new Map((await listRtmVehicles().catch(() => [])).map((v) => [v.id, v]));
  await run("readwrite", (s) => {
    for (const v of vehicles) {
      const old = before.get(v.id);
      s.put({ ...v, ...(old?.flip ? { flip: true } : {}), ...(old?.middleId ? { middleId: old.middleId } : {}) });
    }
  });
  changed();
}

export async function updateRtmVehicle(id: string, patch: Partial<Pick<RtmVehicle, "flip" | "middleId">>): Promise<void> {
  const all = await listRtmVehicles();
  const v = all.find((x) => x.id === id);
  if (!v) return;
  const next: RtmVehicle = { ...v, ...patch };
  if (!next.flip) delete next.flip;
  if (!next.middleId) delete next.middleId;
  await run("readwrite", (s) => {
    s.put(next);
  });
  changed();
}

export async function deleteRtmVehicle(id: string): Promise<void> {
  await run("readwrite", (s) => {
    s.delete(id);
  });
  changed();
}
