export type { StreamKind, CameraPreference, StreamStatus } from "../../shared/types/camera";
import type { CameraPreference } from "../../shared/types/camera";

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
