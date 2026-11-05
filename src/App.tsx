import { useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import ConnectionSetup from "./features/connection/components/ConnectionSetup";
import { DEFAULT_CAMERAS } from "./features/connection/defaults";
import { useConnectionForm } from "./features/connection/hooks/useConnectionForm";
import { useRecorderSession } from "./features/connection/hooks/useRecorderSession";
import { useStreamStatuses } from "./features/connection/hooks/useStreamStatuses";
import LiveView from "./features/live-view/components/LiveView";
import { useCameraLayout } from "./features/live-view/hooks/useCameraLayout";
import LoadingScreen from "./components/LoadingScreen";
import type { ConnectInput } from "./features/connection/types";

function App() {
  const session = useRecorderSession();
  const form = useConnectionForm(session.settings);
  const { statuses, setStatuses, lastUpdated } = useStreamStatuses(session.desktop, session.view === "live", session.connectionError, session.setConnectionError);
  const layout = useCameraLayout(session.settings, session.persistOrder);
  const [showSettings, setShowSettings] = useState(false);
  const [pipMenu, setPipMenu] = useState<{ channel: number; x: number; y: number } | null>(null);
  const openPip = async (channel: number) => { try { await invoke("open_picture_in_picture", { channel }); } catch { session.setConnectionError("Could not open Picture-in-Picture. Reconnect to the recorder and try again."); } };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input: ConnectInput = { ...form.login, host: form.login.host.trim(), port: Number(form.login.port) || 554, username: form.login.username.trim(), rememberPassword: form.rememberPassword, cameras: session.settings.configured ? session.settings.cameras : DEFAULT_CAMERAS };
    if (await session.connect(input)) {
      setStatuses(Object.fromEntries(session.settings.cameraOrder.map((channel) => [channel, "connecting"])));
      form.setLogin((current) => ({ ...current, password: "" })); setShowSettings(false);
    }
  };
  if (session.view === "loading") return <LoadingScreen />;
  if (session.view === "setup" || showSettings) return <ConnectionSetup desktop={session.desktop} settings={session.settings} showSettings={showSettings} setShowSettings={setShowSettings} connectionError={session.connectionError} isConnecting={session.isConnecting} login={form.login} setLogin={form.setLogin} rememberPassword={form.rememberPassword} setRememberPassword={form.setRememberPassword} showPassword={form.showPassword} setShowPassword={form.setShowPassword} showHint={form.showHint} setShowHint={form.setShowHint} formRef={form.formRef} onSubmit={submit} />;
  return <LiveView contextMenu={pipMenu} onContextMenu={(channel, point) => setPipMenu({ channel, ...point })} onCloseContextMenu={() => setPipMenu(null)} onOpenPictureInPicture={(channel) => void openPip(channel)} cameras={layout.cameras} expandedChannel={layout.expandedChannel} statuses={statuses} streamPort={session.streamPort} streamAccessKey={session.streamAccessKey} host={session.settings.host} lastUpdated={lastUpdated} connectionError={session.connectionError} isConnecting={session.isConnecting} draggedChannel={layout.draggedChannel} desktop={session.desktop} onOpenSettings={() => { setShowSettings(true); session.setConnectionError(""); }} onRetry={() => void session.retry()} onMoveCamera={(channel, direction) => void layout.move(channel, direction)} onDropOnChannel={(channel) => void layout.drop(channel)} onDragStart={layout.setDraggedChannel} onDragEnd={() => layout.setDraggedChannel(null)} onChangeStream={(camera, stream) => { void session.changeStream(camera, stream).then((changed) => { if (changed) setStatuses((current) => ({ ...current, [camera.channel]: "connecting" })); }); }} onExpand={(camera) => layout.setExpandedChannel((current) => current === camera.channel ? null : camera.channel)} onDismissConnectionError={() => session.setConnectionError("")} />;
}
export default App;
