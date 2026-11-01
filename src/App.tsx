import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  Expand,
  Eye,
  EyeOff,
  GripVertical,
  LoaderCircle,
  LockKeyhole,
  MonitorPlay,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Signal,
  SignalZero,
  Video,
  X,
} from "lucide-react";
import type { AppSettings, CameraPreference, ConnectInput, StreamKind, StreamStatus } from "./types";

const DEFAULT_CAMERAS: CameraPreference[] = [1, 2, 3, 4].map((channel) => ({
  channel,
  position: channel - 1,
  stream: "sub",
  label: `Channel ${channel}`,
}));

const EMPTY_SETTINGS: AppSettings = {
  configured: false,
  host: null,
  port: 554,
  username: null,
  rememberPassword: false,
  passwordNeedsEntry: false,
  cameraOrder: [1, 2, 3, 4],
  cameras: DEFAULT_CAMERAS,
};

async function waitForStreamAccessKey(): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return await invoke<string>("stream_access_key");
    } catch (error) {
      if (!String(error).includes("stream_not_authenticated")) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
  }
  throw new Error("recorder_unreachable");
}

function App() {
  const desktop = isTauri();
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [view, setView] = useState<"loading" | "setup" | "live">("loading");
  const [showSettings, setShowSettings] = useState(false);
  const [expandedChannel, setExpandedChannel] = useState<number | null>(null);
  const [statuses, setStatuses] = useState<Record<number, StreamStatus["state"]>>({});
  const [streamPort, setStreamPort] = useState<number | null>(null);
  const [streamAccessKey, setStreamAccessKey] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [draggedChannel, setDraggedChannel] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [login, setLogin] = useState({ host: "", port: "554", username: "admin", password: "" });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showHint, setShowHint] = useState(false);
  const connectFormRef = useRef<HTMLFormElement>(null);

  const cameras = useMemo(() => {
    const prefByChannel = new Map(settings.cameras.map((camera) => [camera.channel, camera]));
    const order = settings.cameraOrder.length ? settings.cameraOrder : [1, 2, 3, 4];
    return order.map((channel, position) => ({
      ...(prefByChannel.get(channel) ?? DEFAULT_CAMERAS[channel - 1]),
      position,
    }));
  }, [settings.cameraOrder, settings.cameras]);

  const loadSettings = useCallback(async () => {
    if (!desktop) {
      setView("setup");
      return;
    }
    try {
      const saved = await invoke<AppSettings>("load_settings");
      setSettings(saved);
      setRememberPassword(saved.rememberPassword);
      if (saved.host) {
        setLogin((current) => ({
          ...current,
          host: saved.host ?? "",
          port: String(saved.port || 554),
          username: saved.username ?? "admin",
        }));
      }
      if (!saved.configured) {
        setView("setup");
        return;
      }
      if (saved.passwordNeedsEntry) {
        setView("setup");
        return;
      }
      const result = await invoke<{ streamPort: number; cameras: CameraPreference[] }>("reconnect_saved");
      const accessKey = await waitForStreamAccessKey();
      setStreamPort(result.streamPort);
      setStreamAccessKey(accessKey);
      setSettings((current) => ({ ...current, cameras: result.cameras }));
      setView("live");
    } catch (error) {
      setConnectionError(String(error));
      setView("setup");
    }
  }, [desktop]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!desktop || view !== "live") return;
    const poll = async () => {
      try {
        const next = await invoke<StreamStatus[]>("stream_statuses");
        setStatuses(Object.fromEntries(next.map((item) => [item.channel, item.state])));
        if (next.some((item) => item.state === "authentication_failed")) {
          setConnectionError("authentication_failed");
        } else if (next.every((item) => item.state === "offline" || item.state === "error")) {
          setConnectionError(next.find((item) => item.message)?.message ?? "recorder_unreachable");
        } else if (connectionError) {
          setConnectionError("");
        }
        setLastUpdated(new Date());
      } catch {
        // Tile state remains visible; Retry is available in the header.
      }
    };
    void poll();
    const timer = window.setInterval(poll, 1500);
    return () => window.clearInterval(timer);
  }, [connectionError, desktop, view]);

  const connect = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!desktop) return;
    setConnectionError("");
    setStreamAccessKey(null);
    setIsConnecting(true);
    try {
      const input: ConnectInput = {
        host: login.host.trim(),
        port: Number(login.port) || 554,
        username: login.username.trim(),
        password: login.password,
        rememberPassword,
        cameras: settings.configured ? settings.cameras : DEFAULT_CAMERAS,
      };
      const result = await invoke<{ settings: AppSettings; streamPort: number }>("connect_device", { input });
      const accessKey = await waitForStreamAccessKey();
      setSettings(result.settings);
      setStreamPort(result.streamPort);
      setStreamAccessKey(accessKey);
      setStatuses(Object.fromEntries(result.settings.cameraOrder.map((channel) => [channel, "connecting"])));
      setLogin((current) => ({ ...current, password: "" }));
      setView("live");
      setShowSettings(false);
    } catch (error) {
      setConnectionError(normalizeError(String(error)));
    } finally {
      setIsConnecting(false);
    }
  };

  const moveCamera = async (channel: number, direction: -1 | 1) => {
    const currentOrder = [...settings.cameraOrder];
    const index = currentOrder.indexOf(channel);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return;
    [currentOrder[index], currentOrder[nextIndex]] = [currentOrder[nextIndex], currentOrder[index]];
    await saveOrder(currentOrder);
  };

  const saveOrder = async (order: number[]) => {
    setSettings((current) => ({ ...current, cameraOrder: order }));
    if (desktop) await invoke("save_camera_order", { order }).catch(() => undefined);
  };

  const dropOnChannel = async (target: number) => {
    if (draggedChannel === null || draggedChannel === target) return;
    const order = [...settings.cameraOrder];
    const from = order.indexOf(draggedChannel);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) return;
    order.splice(from, 1);
    order.splice(to, 0, draggedChannel);
    await saveOrder(order);
    setDraggedChannel(null);
  };

  const changeStream = async (camera: CameraPreference, stream: StreamKind) => {
    if (camera.stream === stream) return;
    const updated = settings.cameras.map((item) =>
      item.channel === camera.channel ? { ...item, stream } : item,
    );
    setSettings((current) => ({ ...current, cameras: updated }));
    setStatuses((current) => ({ ...current, [camera.channel]: "connecting" }));
    if (desktop) {
      await invoke("set_channel_stream", { update: { channel: camera.channel, stream } }).catch((error) => {
        setConnectionError(normalizeError(String(error)));
      });
    }
  };

  const expandCamera = async (camera: CameraPreference) => {
    if (expandedChannel === camera.channel) {
      setExpandedChannel(null);
      await changeStream(camera, "sub");
      return;
    }
    setExpandedChannel(camera.channel);
    await changeStream(camera, "main");
  };

  const retry = async () => {
    setConnectionError("");
    setStreamAccessKey(null);
    setIsConnecting(true);
    try {
      const result = await invoke<{ streamPort: number; cameras: CameraPreference[] }>("retry_connection");
      const accessKey = await waitForStreamAccessKey();
      setStreamPort(result.streamPort);
      setStreamAccessKey(accessKey);
      setSettings((current) => ({ ...current, cameras: result.cameras }));
      setStatuses(Object.fromEntries(result.cameras.map((camera) => [camera.channel, "connecting"])));
    } catch (error) {
      setConnectionError(normalizeError(String(error)));
    } finally {
      setIsConnecting(false);
    }
  };

  const openSettings = () => {
    setShowSettings(true);
    setConnectionError("");
  };

  if (view === "loading") {
    return (
      <main className="boot-screen">
        <LoaderCircle className="spin" size={19} />
        <span>Opening Live view…</span>
      </main>
    );
  }

  if (view === "setup" || showSettings) {
    return (
      <main className="setup-shell">
        <header className="setup-topbar">
          <div className="brand-mark"><Video size={17} strokeWidth={2.3} /></div>
          <span className="brand-name">Local Cam</span>
          <span className="topbar-separator" />
          <span className="topbar-current">{showSettings ? "Recorder settings" : "First-time setup"}</span>
          {showSettings && <button className="icon-button topbar-close" onClick={() => setShowSettings(false)} aria-label="Close settings"><X size={18} /></button>}
        </header>
        <section className="setup-content">
          <div className="setup-copy">
            <div className="setup-symbol"><MonitorPlay size={22} /></div>
            <h1>{settings.configured ? "Connect to your recorder" : "Set up your recorder"}</h1>
            <p>Connect on your local network. Your camera video and saved preferences stay on this computer.</p>
          </div>
          <form ref={connectFormRef} className="connect-form" onSubmit={connect}>
            <label className="field-label" htmlFor="recorder-ip">Recorder IP address</label>
            <div className="input-with-icon"><Signal size={16} /><input id="recorder-ip" autoFocus required inputMode="url" placeholder="192.168.1.100" value={login.host} onChange={(e) => setLogin({ ...login, host: e.target.value })} /></div>
            <div className="field-row">
              <div className="field-group">
                <label className="field-label" htmlFor="rtsp-port">RTSP port</label>
                <input id="rtsp-port" required type="number" min="1" max="65535" value={login.port} onChange={(e) => setLogin({ ...login, port: e.target.value })} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="recorder-user">Username</label>
                <input id="recorder-user" required autoComplete="username" value={login.username} onChange={(e) => setLogin({ ...login, username: e.target.value })} />
              </div>
            </div>
            <label className="field-label" htmlFor="recorder-password">Password</label>
            <div className="password-field">
              <LockKeyhole size={16} />
              <input id="recorder-password" required type={showPassword ? "text" : "password"} autoComplete="current-password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
            <label className="remember-row">
              <input type="checkbox" checked={rememberPassword} onChange={(e) => setRememberPassword(e.target.checked)} />
              <span className="custom-check"><Check size={12} /></span>
              <span>Remember password for 30 days</span>
              <button type="button" className="hint-button" onClick={() => setShowHint((visible) => !visible)} aria-label="About saved passwords"><CircleHelp size={15} /></button>
            </label>
            {showHint && <p className="hint-copy">When selected, the password is kept in your operating system’s credential store. It is never saved in the app’s SQLite settings file.</p>}
            {connectionError && <div className="form-error" role="alert"><SignalZero size={16} /><span>{connectionError}</span></div>}
            <button className="primary-button connect-button" type="submit" disabled={isConnecting || !desktop}>
              {isConnecting ? <LoaderCircle className="spin" size={17} /> : <Play size={16} fill="currentColor" />}
              {isConnecting ? "Connecting…" : "Connect and open Live"}
            </button>
            <div className="security-note"><ShieldCheck size={15} /><span>Local connection · no cloud account</span></div>
          </form>
          {!desktop && <div className="runtime-notice">Run this screen inside the Local Cam desktop app to connect to a recorder.</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="live-app">
      <header className="app-topbar">
        <div className="brand-mark"><Video size={17} strokeWidth={2.3} /></div>
        <span className="brand-name">Local Cam</span>
        <span className="topbar-separator" />
        <div className="live-tab"><span className="live-dot" />LIVE</div>
        <div className="topbar-spacer" />
        <div className="recorder-indicator"><span className="connection-dot" />{settings.host}</div>
        <div className="topbar-divider" />
        <div className="clock-readout"><span>{lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}</span><span className="clock-date">LOCAL</span></div>
        <button className="icon-button header-settings" onClick={openSettings} aria-label="Recorder settings"><Settings2 size={17} /></button>
      </header>
      <div className="live-workspace">
        <aside className="camera-rail">
          <div className="rail-heading">
            <div>
              <h2>Cameras</h2>
              <span>{cameras.length} channels</span>
            </div>
            <span className="rail-layout"><span className="layout-grid-icon"><i /><i /><i /><i /></span>4</span>
          </div>
          <div className="rail-subtitle">LIVE SOURCES</div>
          <div className="camera-list">
            {cameras.map((camera) => (
              <div key={camera.channel} className={`camera-row ${expandedChannel === camera.channel ? "selected" : ""} ${draggedChannel === camera.channel ? "dragging" : ""}`} draggable onDragStart={() => setDraggedChannel(camera.channel)} onDragOver={(event) => event.preventDefault()} onDrop={() => void dropOnChannel(camera.channel)} onDragEnd={() => setDraggedChannel(null)}>
                <button className="drag-handle" aria-label={`Reorder ${camera.label}`} title="Drag to reorder"><GripVertical size={16} /></button>
                <span className={`camera-state ${statuses[camera.channel] === "live" ? "is-live" : statuses[camera.channel] === "connecting" ? "is-connecting" : ""}`} />
                <button className="camera-row-button" onClick={() => document.getElementById(`tile-${camera.channel}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })}>
                  <span className="camera-name">A{camera.channel} {camera.label}</span>
                  <span className="camera-stream-label">{camera.stream === "main" ? "MAIN STREAM" : "SUB STREAM 1"}</span>
                </button>
                <div className="order-buttons">
                  <button onClick={() => void moveCamera(camera.channel, -1)} aria-label={`Move ${camera.label} up`} disabled={camera.position === 0}><ArrowUp size={13} /></button>
                  <button onClick={() => void moveCamera(camera.channel, 1)} aria-label={`Move ${camera.label} down`} disabled={camera.position === cameras.length - 1}><ArrowDown size={13} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="rail-bottom">
            <div className="rail-hint"><span className="hint-line" />Drag cameras to reorder</div>
            <button className="rail-action" onClick={() => void retry()} disabled={isConnecting}><RefreshCw size={15} className={isConnecting ? "spin" : ""} />Reconnect to recorder</button>
          </div>
        </aside>
        <section className={`video-stage ${expandedChannel ? "has-expanded" : ""}`} aria-label="Live camera grid">
          <div className="stage-toolbar">
            <div className="stage-title"><h1>Live view</h1><span className="stage-count">{cameras.length} / 4</span></div>
            <div className="stage-actions"><span className="grid-selection"><span className="layout-grid-icon"><i /><i /><i /><i /></span>2 × 2</span><span className="toolbar-rule" /><span className="transport-label">RTSP <span className="transport-dot" /></span></div>
          </div>
          {connectionError && <div className="connection-banner" role="status"><SignalZero size={16} /><span>{connectionError}</span><button onClick={() => void retry()}>Retry</button><button className="banner-dismiss" onClick={() => setConnectionError("")} aria-label="Dismiss"><X size={15} /></button></div>}
          <div className="camera-grid">
            {cameras.map((camera) => (
              <CameraTile
                key={`${camera.channel}-${camera.stream}`}
                camera={camera}
                host={settings.host ?? "Recorder"}
                status={statuses[camera.channel] ?? "connecting"}
                imageUrl={streamPort ? `http://127.0.0.1:${streamPort}/stream/${camera.channel}?v=${camera.stream}` : null}
                accessKey={streamAccessKey}
                expanded={expandedChannel === camera.channel}
                onStreamChange={(stream) => void changeStream(camera, stream)}
                onExpand={() => void expandCamera(camera)}
              />
            ))}
          </div>
          <footer className="stage-footer"><span><span className="live-dot" />Live</span><span className="footer-separator">·</span><span>{settings.host}</span><span className="footer-spacer" /><span>Feeds stay on your local network</span></footer>
        </section>
      </div>
    </main>
  );
}

function CameraTile({
  camera,
  host,
  status,
  imageUrl,
  accessKey,
  expanded,
  onStreamChange,
  onExpand,
}: {
  camera: CameraPreference;
  host: string;
  status: StreamStatus["state"];
  imageUrl: string | null;
  accessKey: string | null;
  expanded: boolean;
  onStreamChange: (stream: StreamKind) => void;
  onExpand: () => void;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || !imageUrl || !accessKey) {
      setImageLoaded(false);
      setStreamError(!image ? null : !imageUrl ? "Local video server is unavailable" : "Video session key is unavailable");
      if (image) image.removeAttribute("src");
      return;
    }

    const controller = new AbortController();
    let active = true;
    let imageReady = false;
    let pending = new Uint8Array(0);
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    setImageLoaded(false);
    setStreamError(null);

    const pumpFrames = async () => {
      try {
        const response = await fetch(imageUrl, {
          headers: { Authorization: `Bearer ${accessKey}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`stream_http_${response.status}`);
        if (!response.body) throw new Error("stream_body_unavailable");
        reader = response.body.getReader();
        setStreamError("Local stream connected; waiting for video frames");
        const headerEnd = new Uint8Array([13, 10, 13, 10]);

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!imageReady && value.length > 0) setStreamError("Local stream sent data; waiting for a valid frame");
          const combined = new Uint8Array(pending.length + value.length);
          combined.set(pending);
          combined.set(value, pending.length);
          pending = combined;

          while (active) {
            const end = findByteSequence(pending, headerEnd);
            if (end < 0) break;
            const headers = new TextDecoder().decode(pending.subarray(0, end));
            const length = Number(headers.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i)?.[1]);
            if (!Number.isSafeInteger(length) || length < 0 || length > 8 * 1024 * 1024) {
              throw new Error("invalid_frame_length");
            }
            const frameStart = end + headerEnd.length;
            const frameEnd = frameStart + length;
            if (pending.length < frameEnd + 2) break;
            if (pending[frameEnd] !== 13 || pending[frameEnd + 1] !== 10) throw new Error("invalid_frame_boundary");

            const frame = pending.slice(frameStart, frameEnd);
            pending = pending.slice(frameEnd + 2);
            const nextUrl = URL.createObjectURL(new Blob([frame.buffer as ArrayBuffer], { type: "image/jpeg" }));
            const previousUrl = objectUrlRef.current;
            objectUrlRef.current = nextUrl;
            image.onload = () => {
              if (active) {
                imageReady = true;
                setImageLoaded(true);
                setStreamError(null);
              }
              if (previousUrl) URL.revokeObjectURL(previousUrl);
            };
            image.onerror = () => {
              if (active) {
                setImageLoaded(false);
                setStreamError("Local stream sent an image the app could not decode");
              }
            };
            image.src = nextUrl;
          }

          if (pending.length > 8 * 1024 * 1024 + 4096) throw new Error("frame_too_large");
        }
      } catch (error) {
        if (active) {
          setImageLoaded(false);
          const message = error instanceof Error ? error.message : "";
          setStreamError(message.startsWith("stream_http_")
            ? `Local video endpoint returned HTTP ${message.slice("stream_http_".length)}`
            : "Local video request failed or was blocked");
        }
      }
    };

    void pumpFrames();
    return () => {
      active = false;
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [accessKey, imageUrl]);

  return (
    <article id={`tile-${camera.channel}`} className={`camera-tile ${expanded ? "expanded" : ""}`}>
      <div className="tile-head">
        <div className="tile-source"><span className={`tile-state-dot ${imageLoaded ? "live" : ""}`} />{host}&nbsp; <span>{camera.channel}</span><span className="tile-stream-short">{camera.stream === "main" ? "M" : "S"}</span></div>
        <div className="tile-controls">
          <div className="stream-menu-wrap">
            <button className="tile-control stream-trigger" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label="Choose stream"><span>{camera.stream === "main" ? "Main" : "Sub"}</span><ChevronDown size={12} /></button>
            {menuOpen && <div className="stream-menu" role="menu"><button role="menuitem" className={camera.stream === "main" ? "active" : ""} onClick={() => { onStreamChange("main"); setMenuOpen(false); }}>Main Stream</button><button role="menuitem" className={camera.stream === "sub" ? "active" : ""} onClick={() => { onStreamChange("sub"); setMenuOpen(false); }}>Sub Stream 1</button></div>}
          </div>
          <button className="tile-control" onClick={onExpand} aria-label={expanded ? "Return to grid" : "Expand camera"}><Expand size={13} /></button>
        </div>
      </div>
      <div className="tile-video">
        <img ref={imageRef} className={`feed-image ${imageLoaded ? "visible" : ""}`} alt={`${camera.label} live feed`} />
        {!imageLoaded && <div className="tile-offline">
          {status === "connecting" ? <LoaderCircle className="spin" size={18} /> : <SignalZero size={19} />}
          <span>{streamError ?? (status === "connecting" ? "Connecting to camera" : status === "authentication_failed" ? "Login rejected" : status === "error" ? "Stream unavailable" : "No signal")}</span>
        </div>}
        <span className="tile-camera-name">{camera.label}</span>
        {imageLoaded && <span className="tile-time">LIVE</span>}
      </div>
    </article>
  );
}

function findByteSequence(buffer: Uint8Array, sequence: Uint8Array): number {
  outer: for (let index = 0; index <= buffer.length - sequence.length; index += 1) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (buffer[index + offset] !== sequence[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function normalizeError(error: string) {
  return error
    .replace(/^Error: /, "")
    .replace("recorder_unreachable", "Could not reach the recorder. Check its address and local network, then retry.")
    .replace("authentication_failed", "The recorder rejected this login. Re-enter the username or password.")
    .replace("password_expired", "Enter your recorder password to continue.")
    .replace("credential_store_unavailable", "The operating system credential store is unavailable. Turn off Remember password to connect for this session.");
}

export default App;
