"use client";

import { useEffect, useState } from "react";
import type { RtmLibrary } from "@/lib/rtm/pack";
import { loadRtmLibrary, RTM_CHANGED_EVENT } from "@/lib/rtm/store";

/** このブラウザに保存した RTM 車両と手動編成（読み込み中は null） */
export function useRtmLibrary(enabled = true) {
  const [library, setLibrary] = useState<RtmLibrary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void loadRtmLibrary().then(
        result => {
          if (current !== revision) return;
          setLibrary(result);
          setError("");
        },
        () => { if (current === revision) setError("登録した車両と編成を読み込めませんでした。"); },
      );
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === RTM_CHANGED_EVENT) refresh();
    };
    refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(RTM_CHANGED_EVENT, refresh);
    return () => {
      revision++;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(RTM_CHANGED_EVENT, refresh);
    };
  }, [enabled]);
  return { library: enabled ? library : null, error };
}
