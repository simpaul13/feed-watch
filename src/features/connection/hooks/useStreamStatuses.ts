import { useEffect, useState } from "react";
import { streamStatuses } from "../services/recorderService";
import type { StreamStatus } from "../types";

export function useStreamStatuses(desktop: boolean, live: boolean, connectionError: string, setConnectionError: (value: string) => void) {
  const [statuses, setStatuses] = useState<Record<number, StreamStatus["state"]>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  useEffect(() => {
    if (!desktop || !live) return;
    const poll = async () => {
      try {
        const next = await streamStatuses();
        setStatuses(Object.fromEntries(next.map((item) => [item.channel, item.state])));
        if (next.some((item) => item.state === "authentication_failed")) setConnectionError("authentication_failed");
        else if (next.every((item) => item.state === "offline" || item.state === "error")) setConnectionError(next.find((item) => item.message)?.message ?? "recorder_unreachable");
        else if (connectionError) setConnectionError("");
        setLastUpdated(new Date());
      } catch { /* Existing tile state remains visible; retry is available in the header. */ }
    };
    void poll();
    const timer = window.setInterval(poll, 1500);
    return () => window.clearInterval(timer);
  }, [connectionError, desktop, live, setConnectionError]);
  return { statuses, setStatuses, lastUpdated };
}
