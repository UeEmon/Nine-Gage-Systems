// 読み込んだ 3D モデルを、このブラウザ（IndexedDB）に保存する。サーバーには送らない。

import type { Model3d } from "./pack";

const DB = "senrolab-models";
const STORE = "models";
export const MODELS_CHANGED_EVENT = "senrolab-models-changed";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("このブラウザでは 3D モデルを保存できません"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("3D モデルの保存先を開けませんでした"));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error ?? new Error("3D モデルの保存に失敗しました"));
      tx.onabort = () => reject(tx.error ?? new Error("3D モデルの保存に失敗しました（ブラウザの保存領域が足りない可能性があります）"));
    });
  } finally {
    db.close();
  }
}

const changed = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MODELS_CHANGED_EVENT));
};

export async function listModels(): Promise<Model3d[]> {
  const all = (await run<Model3d[]>("readonly", (s) => s.getAll() as IDBRequest<Model3d[]>)) ?? [];
  return all.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/** モデルを保存する（同じ ID のモデルは置き換える。付けた名前は引き継ぐ） */
export async function saveModels(models: Model3d[]): Promise<void> {
  const before = new Map((await listModels().catch(() => [])).map((m) => [m.id, m]));
  await run("readwrite", (s) => {
    for (const m of models) s.put({ ...m, name: before.get(m.id)?.name ?? m.name });
  });
  changed();
}

export async function renameModel(id: string, name: string): Promise<void> {
  const m = (await listModels()).find((x) => x.id === id);
  if (!m || !name.trim()) return;
  await run("readwrite", (s) => {
    s.put({ ...m, name: name.trim().slice(0, 80) });
  });
  changed();
}

export async function deleteModel(id: string): Promise<void> {
  await run("readwrite", (s) => {
    s.delete(id);
  });
  changed();
}
