import { useMemo, useState } from "react";
import { DEFAULT_CAMERAS } from "../../connection/defaults";
import type { AppSettings } from "../../connection/types";

export function useCameraLayout(settings: AppSettings, persistOrder: (order: number[]) => Promise<void>) {
  const [expandedChannel, setExpandedChannel] = useState<number | null>(null);
  const [draggedChannel, setDraggedChannel] = useState<number | null>(null);
  const cameras = useMemo(() => {
    const byChannel = new Map(settings.cameras.map((camera) => [camera.channel, camera]));
    return (settings.cameraOrder.length ? settings.cameraOrder : [1, 2, 3, 4]).map((channel, position) => ({ ...(byChannel.get(channel) ?? DEFAULT_CAMERAS[channel - 1]), position }));
  }, [settings]);
  const move = async (channel: number, direction: -1 | 1) => {
    const order = [...settings.cameraOrder]; const index = order.indexOf(channel); const next = index + direction;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]]; await persistOrder(order);
  };
  const drop = async (target: number) => {
    if (draggedChannel === null || draggedChannel === target) return;
    const order = [...settings.cameraOrder]; const from = order.indexOf(draggedChannel); const to = order.indexOf(target);
    if (from < 0 || to < 0) return;
    order.splice(from, 1); order.splice(to, 0, draggedChannel); await persistOrder(order); setDraggedChannel(null);
  };
  return { cameras, expandedChannel, setExpandedChannel, draggedChannel, setDraggedChannel, move, drop };
}
