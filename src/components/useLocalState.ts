"use client";

import { useEffect, useRef, useState } from "react";

/** localStorage に保存される state（読めない環境では保存せずに動く） */
export function useLocalState<T>(key: string, initial: T, valid: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const v = JSON.parse(raw);
        if (valid(v)) setValue(v);
      }
    } catch {
      /* 保存データなし */
    }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 保存できない環境 */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
