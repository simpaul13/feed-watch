import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CameraPreference, StreamStatus } from "../../../shared/types/camera";
import { useMjpegFeed } from "../hooks/useMjpegFeed";

interface PiPState { camera: CameraPreference; streamPort: number; accessKey: string | null; status: StreamStatus["state"]; }

export default function PictureInPicture() {
  const [state, setState] = useState<PiPState | null>(null);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try { const next = await invoke<PiPState | null>("picture_in_picture_state"); if (active) setState(next); }
      catch { if (active) setState(null); }
    };
    void poll(); const timer = window.setInterval(poll, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const { imageRef, imageLoaded, streamError } = useMjpegFeed(state ? `http://127.0.0.1:${state.streamPort}/stream/${state.camera.channel}?v=${state.camera.stream}` : null, state?.accessKey ?? null);
  return <main className="pip-player" aria-label={state ? `${state.camera.label} picture in picture` : "Picture in Picture"}>
    {state && <img ref={imageRef} className="pip-feed" alt={`${state.camera.label} live feed`} />}
    {(!imageLoaded || !state) && <div className="pip-status" role="status"><span className={state?.status === "connecting" ? "pip-spinner" : "pip-signal"} />{streamError ?? (state ? state.status === "authentication_failed" ? "Camera login rejected" : "Waiting for camera video" : "Waiting for camera")}</div>}
  </main>;
}
