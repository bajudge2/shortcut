import type { Position } from './types.ts';

/**
 * Returns `next.nodeId` when `next` is a manual or Bluetooth position on a node that is a NEW
 * anchor relative to `prev`; otherwise null. PDR and sim updates never count.
 */
export function newAnchorNodeId(prev: Position | null, next: Position | null): string | null {
  if (!next) return null;
  if (next.source !== 'manual' && next.source !== 'ble') return null;
  if (!next.nodeId) return null;
  if (
    prev &&
    prev.timestamp === next.timestamp &&
    prev.source === next.source &&
    prev.nodeId === next.nodeId
  ) {
    return null;
  }
  return next.nodeId;
}
