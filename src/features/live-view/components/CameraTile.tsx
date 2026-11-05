import { useState, type KeyboardEvent, type WheelEvent, type MouseEvent } from "react";
import { ChevronDown, LoaderCircle, SignalZero } from "lucide-react";
import type { CameraPreference, StreamKind, StreamStatus } from "../../connection/types";
import { useMjpegFeed } from "../hooks/useMjpegFeed";

const MIN_FEED_ZOOM = 1;
const MAX_FEED_ZOOM = 5;
const FEED_ZOOM_SENSITIVITY = 0.002;
export default function CameraTile({
  camera,
  status,
  imageUrl,
  accessKey,
  expanded,
  onStreamChange,
  onExpand,
  onContextMenu,
  desktop,
}: {
  camera: CameraPreference;
  status: StreamStatus["state"];
  imageUrl: string | null;
  accessKey: string | null;
  expanded: boolean;
  onStreamChange: (stream: StreamKind) => void;
  onExpand: () => void;
  onContextMenu: (channel: number, anchor: { x: number; y: number }) => void;
  desktop: boolean;
}) {
  const { imageRef, imageLoaded, streamError } = useMjpegFeed(imageUrl, accessKey);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });

  const zoomBy = (factor: number, pointerX: number, pointerY: number) => {
    setZoom((current) => {
      const scale = Math.min(MAX_FEED_ZOOM, Math.max(MIN_FEED_ZOOM, current.scale * factor));
      if (scale === current.scale) return current;
      if (scale === MIN_FEED_ZOOM) return { scale, x: 0, y: 0 };

      const ratio = scale / current.scale;
      const x = pointerX - (pointerX - current.x) * ratio;
      const y = pointerY - (pointerY - current.y) * ratio;
      return {
        scale,
        x: Math.min(0, Math.max(1 - scale, x)),
        y: Math.min(0, Math.max(1 - scale, y)),
      };
    });
  };

  const handleFeedWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!imageLoaded) return;
    event.preventDefault();

    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    zoomBy(
      Math.exp(-event.deltaY * FEED_ZOOM_SENSITIVITY),
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    );
  };

  const handleFeedKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && desktop) {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      onContextMenu(camera.channel, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
      return;
    }
    if ((event.key === "+" || event.key === "=" || event.key === "-") && imageLoaded) {
      event.preventDefault();
      zoomBy(event.key === "-" ? 1 / 1.2 : 1.2, 0.5, 0.5);
      return;
    }
    if (event.key === "0" && imageLoaded) {
      event.preventDefault();
      setZoom({ scale: MIN_FEED_ZOOM, x: 0, y: 0 });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onExpand();
    }
  };
  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!desktop) return;
    event.preventDefault();
    onContextMenu(camera.channel, { x: event.clientX, y: event.clientY });
  };

  return (
    <article id={`tile-${camera.channel}`} className={`camera-tile ${expanded ? "expanded" : ""}`}>
      <div className="tile-head">
        <div className="tile-controls">
          <div className="stream-menu-wrap">
            <button className="tile-control stream-trigger" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label="Choose stream"><span>{camera.stream === "main" ? "Main" : "Sub"}</span><ChevronDown size={12} /></button>
            {menuOpen && <div className="stream-menu" role="menu"><button role="menuitem" className={camera.stream === "main" ? "active" : ""} onClick={() => { onStreamChange("main"); setMenuOpen(false); }}>Main Stream</button><button role="menuitem" className={camera.stream === "sub" ? "active" : ""} onClick={() => { onStreamChange("sub"); setMenuOpen(false); }}>Sub Stream 1</button></div>}
          </div>
        </div>
      </div>
      <div
        className="tile-video"
        role="button"
        tabIndex={0}
        aria-label={`${expanded ? `Return ${camera.label} to the camera grid` : `Expand ${camera.label}`}. Scroll over the feed to zoom; current zoom ${Math.round(zoom.scale * 100)} percent. Keyboard plus and minus zoom, zero resets.`}
        title="Scroll over the feed to zoom toward the pointer; use + or - to zoom and 0 to reset; double-click to expand or restore"
        onWheel={handleFeedWheel}
        onContextMenu={handleContextMenu}
        onDoubleClick={onExpand}
        onKeyDown={handleFeedKeyDown}
      >
        <img
          ref={imageRef}
          className={`feed-image ${imageLoaded ? "visible" : ""}`}
          alt={`${camera.label} live feed`}
          style={{ transform: `translate3d(${zoom.x * 100}%, ${zoom.y * 100}%, 0) scale(${zoom.scale})` }}
        />
        {!imageLoaded && <div className="tile-offline">
          {status === "connecting" ? <LoaderCircle className="spin" size={18} /> : <SignalZero size={19} />}
          <span>{streamError ?? (status === "connecting" ? "Connecting to camera" : status === "authentication_failed" ? "Login rejected" : status === "error" ? "Stream unavailable" : "No signal")}</span>
        </div>}
      </div>
    </article>
  );
}
