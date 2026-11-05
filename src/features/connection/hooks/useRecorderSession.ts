import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { DEFAULT_CAMERAS, EMPTY_SETTINGS } from "../defaults";
import { normalizeConnectionError } from "../errors";
import { connectDevice, loadSettings, reconnectSaved, retryConnection, saveCameraOrder, setChannelStream, waitForStreamAccessKey } from "../services/recorderService";
import type { AppSettings, CameraPreference, ConnectInput, StreamKind } from "../types";

export function useRecorderSession() {
  const desktop = isTauri();
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [view, setView] = useState<"loading" | "setup" | "live">("loading");
  const [streamPort, setStreamPort] = useState<number | null>(null);
  const [streamAccessKey, setStreamAccessKey] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!desktop) { setView("setup"); return; }
      try {
        const saved = await loadSettings(); if (!active) return;
        setSettings(saved);
        if (!saved.configured || saved.passwordNeedsEntry) { setView("setup"); return; }
        const result = await reconnectSaved(); const key = await waitForStreamAccessKey(); if (!active) return;
        setStreamPort(result.streamPort); setStreamAccessKey(key);
        setSettings((current) => ({ ...current, cameras: result.cameras })); setView("live");
      } catch (error) { if (active) { setConnectionError(String(error)); setView("setup"); } }
    })();
    return () => { active = false; };
  }, [desktop]);
  const connect = useCallback(async (input: ConnectInput) => {
    if (!desktop) return;
    setConnectionError(""); setStreamAccessKey(null); setIsConnecting(true);
    try {
      const result = await connectDevice({ ...input, cameras: settings.configured ? settings.cameras : DEFAULT_CAMERAS });
      const key = await waitForStreamAccessKey();
      setSettings(result.settings); setStreamPort(result.streamPort); setStreamAccessKey(key); setView("live");
      return true;
    } catch (error) { setConnectionError(normalizeConnectionError(String(error))); return false; }
    finally { setIsConnecting(false); }
  }, [desktop, settings]);
  const retry = useCallback(async () => {
    setConnectionError(""); setStreamAccessKey(null); setIsConnecting(true);
    try { const result = await retryConnection(); const key = await waitForStreamAccessKey(); setStreamPort(result.streamPort); setStreamAccessKey(key); setSettings((current) => ({ ...current, cameras: result.cameras })); }
    catch (error) { setConnectionError(normalizeConnectionError(String(error))); }
    finally { setIsConnecting(false); }
  }, []);
  const persistOrder = useCallback(async (order: number[]) => {
    setSettings((current) => ({ ...current, cameraOrder: order }));
    if (desktop) await saveCameraOrder(order).catch(() => undefined);
  }, [desktop]);
  const changeStream = useCallback(async (camera: CameraPreference, stream: StreamKind) => {
    if (camera.stream === stream) return true;
    if (desktop) try { await setChannelStream(camera.channel, stream); } catch (error) { setConnectionError(normalizeConnectionError(String(error))); return false; }
    setSettings((current) => ({ ...current, cameras: current.cameras.map((item) => item.channel === camera.channel ? { ...item, stream } : item) })); return true;
  }, [desktop]);
  return { desktop, settings, setSettings, view, setView, streamPort, streamAccessKey, connectionError, setConnectionError, isConnecting, connect, retry, persistOrder, changeStream };
}
