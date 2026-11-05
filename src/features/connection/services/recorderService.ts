import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, CameraPreference, ConnectInput, StreamKind, StreamStatus } from "../types";

export async function loadSettings() { return invoke<AppSettings>("load_settings"); }
export async function reconnectSaved() { return invoke<{ streamPort: number; cameras: CameraPreference[] }>("reconnect_saved"); }
export async function connectDevice(input: ConnectInput) { return invoke<{ settings: AppSettings; streamPort: number }>("connect_device", { input }); }
export async function retryConnection() { return invoke<{ streamPort: number; cameras: CameraPreference[] }>("retry_connection"); }
export async function streamStatuses() { return invoke<StreamStatus[]>("stream_statuses"); }
export async function saveCameraOrder(order: number[]) { return invoke("save_camera_order", { order }); }
export async function setChannelStream(channel: number, stream: StreamKind) { return invoke("set_channel_stream", { update: { channel, stream } }); }

export async function waitForStreamAccessKey(): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { return await invoke<string>("stream_access_key"); }
    catch (error) {
      if (!String(error).includes("stream_not_authenticated")) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
  }
  throw new Error("recorder_unreachable");
}
