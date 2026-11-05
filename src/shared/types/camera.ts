export type StreamKind = "main" | "sub";
export interface CameraPreference { channel: number; position: number; stream: StreamKind; label: string; }
export interface StreamStatus {
  channel: number;
  state: "connecting" | "live" | "offline" | "error" | "authentication_failed";
  message: string | null;
}
export interface FeedZoom { scale: number; x: number; y: number; }
