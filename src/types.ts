export type StreamKind = "main" | "sub";

export interface CameraPreference {
  channel: number;
  position: number;
  stream: StreamKind;
  label: string;
}

export interface AppSettings {
  configured: boolean;
  host: string | null;
  port: number;
  username: string | null;
  rememberPassword: boolean;
  passwordNeedsEntry: boolean;
  cameraOrder: number[];
  cameras: CameraPreference[];
}

export interface ConnectInput {
  host: string;
  port: number;
  username: string;
  password: string;
  rememberPassword: boolean;
  cameras: CameraPreference[];
}

export interface StreamStatus {
  channel: number;
  state: "connecting" | "live" | "offline" | "error" | "authentication_failed";
  message: string | null;
}
