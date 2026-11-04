"use client";

// Focus for the mock outbox viewer (developer tool behind /dev, X-06): choosing another row in the
// list (a link to `?id=`) moves focus to the selected email's subject heading, so keyboard and
// screen-reader users land on what they opened, and on a narrow screen (one column: list, then
// email) the email scrolls into view. The first render (a page load or a shared link) leaves focus
// where the browser put it. Renders nothing.
import { useEffect, useRef } from "react";

export function OutboxPreviewFocus({ selectedId, targetId }: { selectedId: string; targetId: string }) {
  const shown = useRef(selectedId);
  useEffect(() => {
    if (shown.current === selectedId) return;
    shown.current = selectedId;
    document.getElementById(targetId)?.focus();
  }, [selectedId, targetId]);
  return null;
}
