import type { AppSettings, CameraPreference } from "./types";

export const DEFAULT_CAMERAS: CameraPreference[] = [1, 2, 3, 4].map((channel) => ({
  channel,
  position: channel - 1,
  stream: "sub",
  label: `Channel ${channel}`,
}));

export const EMPTY_SETTINGS: AppSettings = {
  configured: false,
  host: null,
  port: 554,
  username: null,
  rememberPassword: false,
  passwordNeedsEntry: false,
  cameraOrder: [1, 2, 3, 4],
  cameras: DEFAULT_CAMERAS,
};
