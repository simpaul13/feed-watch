import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  RefreshCw,
  Settings2,
  SignalZero,
  Video,
  X,
} from "lucide-react";
import type { CameraPreference, StreamKind, StreamStatus } from "../../connection/types";
import CameraTile from "./CameraTile";

interface LiveViewProps {
  cameras: CameraPreference[];
  expandedChannel: number | null;
  statuses: Record<number, StreamStatus["state"]>;
  streamPort: number | null;
  streamAccessKey: string | null;
  host: string | null;
  lastUpdated: Date | null;
  connectionError: string;
  isConnecting: boolean;
  draggedChannel: number | null;
  desktop: boolean;
  onOpenSettings: () => void;
  onRetry: () => void;
  onMoveCamera: (channel: number, direction: -1 | 1) => void;
  onDropOnChannel: (channel: number) => void;
  onDragStart: (channel: number) => void;
  onDragEnd: () => void;
  onChangeStream: (camera: CameraPreference, stream: StreamKind) => void;
  onExpand: (camera: CameraPreference) => void;
  onDismissConnectionError: () => void;
  contextMenu: { channel: number; x: number; y: number } | null;
  onContextMenu: (channel: number, point: { x: number; y: number }) => void;
  onCloseContextMenu: () => void;
  onOpenPictureInPicture: (channel: number) => void;
}

export default function LiveView({
  cameras,
  expandedChannel,
  statuses,
  streamPort,
  streamAccessKey,
  host,
  lastUpdated,
  connectionError,
  isConnecting,
  draggedChannel,
  desktop,
  onOpenSettings,
  onRetry,
  onMoveCamera,
  onDropOnChannel,
  onDragStart,
  onDragEnd,
  onChangeStream,
  onExpand,
  onDismissConnectionError,
  contextMenu, onContextMenu, onCloseContextMenu, onOpenPictureInPicture,
}: LiveViewProps) {
  return (
    <main className="live-app">
      <header className="app-topbar">
        <div className="brand-mark"><Video size={17} strokeWidth={2.3} /></div>
        <span className="brand-name">Local Cam</span>
        <span className="topbar-separator" />
        <div className="live-tab"><span className="live-dot" />LIVE</div>
        <div className="topbar-spacer" />
        <div className="recorder-indicator"><span className="connection-dot" />{host}</div>
        <div className="topbar-divider" />
        <div className="clock-readout"><span>{lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}</span><span className="clock-date">LOCAL</span></div>
        <button className="icon-button header-settings" onClick={onOpenSettings} aria-label="Recorder settings"><Settings2 size={17} /></button>
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
              <div key={camera.channel} className={`camera-row ${expandedChannel === camera.channel ? "selected" : ""} ${draggedChannel === camera.channel ? "dragging" : ""}`} draggable onDragStart={() => onDragStart(camera.channel)} onDragOver={(event) => event.preventDefault()} onDrop={() => onDropOnChannel(camera.channel)} onDragEnd={onDragEnd}>
                <button className="drag-handle" aria-label={`Reorder ${camera.label}`} title="Drag to reorder"><GripVertical size={16} /></button>
                <span className={`camera-state ${statuses[camera.channel] === "live" ? "is-live" : statuses[camera.channel] === "connecting" ? "is-connecting" : ""}`} />
                <button className="camera-row-button" onClick={() => document.getElementById(`tile-${camera.channel}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })}>
                  <span className="camera-name">A{camera.channel} {camera.label}</span>
                  <span className="camera-stream-label">{camera.stream === "main" ? "MAIN STREAM" : "SUB STREAM 1"}</span>
                </button>
                <div className="order-buttons">
                  <button onClick={() => onMoveCamera(camera.channel, -1)} aria-label={`Move ${camera.label} up`} disabled={camera.position === 0}><ArrowUp size={13} /></button>
                  <button onClick={() => onMoveCamera(camera.channel, 1)} aria-label={`Move ${camera.label} down`} disabled={camera.position === cameras.length - 1}><ArrowDown size={13} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="rail-bottom">
            <div className="rail-hint"><span className="hint-line" />Drag cameras to reorder</div>
            <button className="rail-action" onClick={onRetry} disabled={isConnecting}><RefreshCw size={15} className={isConnecting ? "spin" : ""} />Reconnect to recorder</button>
          </div>
        </aside>
        <section className={`video-stage ${expandedChannel ? "has-expanded" : ""}`} aria-label="Live camera grid">
          <div className="stage-toolbar">
            <div className="stage-title"><h1>Live view</h1><span className="stage-count">{cameras.length} / 4</span></div>
            <div className="stage-actions"><span className="grid-selection"><span className="layout-grid-icon"><i /><i /><i /><i /></span>2 × 2</span><span className="toolbar-rule" /><span className="transport-label">RTSP <span className="transport-dot" /></span></div>
          </div>
          {connectionError && <div className="connection-banner" role="status"><SignalZero size={16} /><span>{connectionError}</span><button onClick={onRetry}>Retry</button><button className="banner-dismiss" onClick={onDismissConnectionError} aria-label="Dismiss"><X size={15} /></button></div>}
          <div className="camera-grid">
            {cameras.map((camera) => (
              <CameraTile
                key={`${camera.channel}-${camera.stream}`}
                camera={camera}
                status={statuses[camera.channel] ?? "connecting"}
                imageUrl={streamPort ? `http://127.0.0.1:${streamPort}/stream/${camera.channel}?v=${camera.stream}` : null}
                accessKey={streamAccessKey}
                desktop={desktop}
                expanded={expandedChannel === camera.channel}
                onContextMenu={onContextMenu}
                onStreamChange={(stream) => onChangeStream(camera, stream)}
                onExpand={() => onExpand(camera)}
              />
            ))}
          </div>
          {contextMenu && <div className="camera-context-menu" role="menu" style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 214)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 50)) }} onKeyDown={(event) => { if (event.key === "Escape") onCloseContextMenu(); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onCloseContextMenu(); }}><button autoFocus role="menuitem" onClick={() => { onOpenPictureInPicture(contextMenu.channel); onCloseContextMenu(); }}>Open Picture-in-Picture</button></div>}
          <footer className="stage-footer"><span><span className="live-dot" />Live</span><span className="footer-separator">·</span><span>{host}</span><span className="footer-spacer" /><span>Feeds stay on your local network</span></footer>
        </section>
      </div>
    </main>
  );
}
