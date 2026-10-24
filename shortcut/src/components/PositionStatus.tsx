import { useMemo } from 'react';
import { positionStatusText } from '../lib/guidance.ts';
import type { Building, Position } from '../lib/types.ts';

interface Props {
  building: Building;
  position: Position | null;
  viewFloor: string;
  onShowFloor: (floorId: string) => void;
}

/**
 * "You are near …" status line (Req 5). Display only: never computes or mutates the position (Req 8.3).
 * The live region text depends only on landmark label + source, so PDR steps that keep the same
 * nearest landmark leave the DOM unchanged and nothing is re-announced (Req 5.8).
 */
export default function PositionStatus({ building, position, viewFloor, onShowFloor }: Props) {
  const status = useMemo(() => positionStatusText(building, position), [building, position]);

  // Label of the position's floor when it differs from the floor being viewed (Req 5.4).
  const otherFloorLabel =
    position && position.floor !== viewFloor
      ? (building.floors.find((f) => f.id === position.floor)?.label ?? position.floor)
      : null;

  return (
    <>
      <div className="pos-status" role="status" aria-live="polite" aria-atomic="true">
        {status && (
          <>
            <span>{status.near}</span>
            <span className="pos-source">{status.source}</span>
          </>
        )}
      </div>
      {position && otherFloorLabel !== null && (
        <button type="button" className="pos-floor-btn" onClick={() => onShowFloor(position.floor)}>
          {otherFloorLabel}
        </button>
      )}
    </>
  );
}
