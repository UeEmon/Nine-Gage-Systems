"use client";

import { useEffect, useState } from "react";

/** localStorage に保存される state（読めない環境では保存せずに動く） */
export function useLocalState<T>(key: string, initial: T, valid: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(initial);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    let next = initial;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const v = JSON.parse(raw);
        if (valid(v)) next = v;
      }
    } catch {
      /* 保存データなし */
    }
    setValue(next);
    setLoadedKey(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 保存できない環境 */
    }
  }, [key, value, loadedKey]);
  return [value, setValue] as const;
}
