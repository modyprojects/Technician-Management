"use client";

// "לא נשלח" on a row of "היום" (D95 as corrected 22.11 (e)): shown while this device still holds
// data of the visit that the server has not confirmed. Reads the device store only; sends nothing.
import { useEffect, useState } from "react";
import { idbVisitFlowStore } from "@/features/visit-flow/idb";
import { NotSentPill } from "./SyncStatus";

export function UnsentMarker({ visitId, userId }: { visitId: string; userId: string }) {
  const [unsent, setUnsent] = useState(false);
  useEffect(() => {
    let live = true;
    idbVisitFlowStore
      .list()
      .then((items) => {
        if (live) setUnsent(items.some((i) => i.visitId === visitId && i.userId === userId));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [visitId, userId]);
  return unsent ? <NotSentPill /> : null;
}
