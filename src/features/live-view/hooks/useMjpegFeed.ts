import { useEffect, useRef, useState } from "react";

export function useMjpegFeed(imageUrl: string | null, accessKey: string | null) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || !imageUrl || !accessKey) {
      setImageLoaded(false);
      setStreamError(!imageUrl ? "Local video server is unavailable" : !accessKey ? "Waiting for video session" : null);
      image?.removeAttribute("src");
      return;
    }
    let active = true;
    let retryTimer = 0;
    let retryDelay = 1000;
    let currentUrl: string | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const controller = new AbortController();
    const clearImage = () => {
      image.removeAttribute("src");
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = null;
      setImageLoaded(false);
    };
    const pump = async () => {
      try {
        const response = await fetch(imageUrl, { headers: { Authorization: `Bearer ${accessKey}` }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`stream_http_${response.status}`);
        reader = response.body.getReader();
        let pending = new Uint8Array(0);
        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          const merged = new Uint8Array(pending.length + value.length);
          merged.set(pending); merged.set(value, pending.length); pending = merged;
          let latest: Uint8Array | null = null;
          while (active) {
            const end = findHeaderEnd(pending);
            if (end < 0) break;
            const headers = new TextDecoder().decode(pending.subarray(0, end));
            const length = Number(headers.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i)?.[1]);
            if (!Number.isSafeInteger(length) || length < 0 || length > 8 * 1024 * 1024) throw new Error("invalid_frame_length");
            const start = end + 4;
            if (pending.length < start + length + 2) break;
            latest = pending.slice(start, start + length);
            if (pending[start + length] !== 13 || pending[start + length + 1] !== 10) throw new Error("invalid_frame_boundary");
            pending = pending.slice(start + length + 2);
          }
          if (latest) {
            const url = URL.createObjectURL(new Blob([latest.buffer as ArrayBuffer], { type: "image/jpeg" }));
            const previous = currentUrl; currentUrl = url;
            image.onload = () => { if (active) { retryDelay = 1000; setImageLoaded(true); setStreamError(null); } if (previous) URL.revokeObjectURL(previous); };
            image.onerror = () => { if (active) setStreamError("Camera sent an unreadable video frame"); };
            image.src = url;
          }
          if (pending.length > 8 * 1024 * 1024 + 4096) throw new Error("frame_too_large");
        }
        if (active) throw new Error("stream_ended");
      } catch (error) {
        if (!active) return;
        clearImage();
        setStreamError("Camera stream ended; reconnecting");
        retryTimer = window.setTimeout(() => { if (active) void pump(); }, retryDelay);
        retryDelay = Math.min(5000, retryDelay * 2);
      }
    };
    setImageLoaded(false); setStreamError("Connecting to camera");
    void pump();
    return () => {
      active = false; controller.abort(); window.clearTimeout(retryTimer);
      void reader?.cancel().catch(() => undefined);
      image.onload = null; image.onerror = null; clearImage();
    };
  }, [accessKey, imageUrl]);

  return { imageRef, imageLoaded, streamError };
}

function findHeaderEnd(buffer: Uint8Array) {
  for (let index = 0; index <= buffer.length - 4; index += 1) {
    if (buffer[index] === 13 && buffer[index + 1] === 10 && buffer[index + 2] === 13 && buffer[index + 3] === 10) return index;
  }
  return -1;
}
