import { destinationName, locationPickerValue, type DestinationGroup } from '../lib/guidance.ts';
import type { Position } from '../lib/types.ts';

interface Props {
  /** from destinationGroups(building), shared with the destination picker */
  groups: DestinationGroup[];
  /** read only, used to show which place is selected */
  position: Position | null;
  /** called only for a non-empty node id */
  onSelect: (nodeId: string) => void;
}

/** "I’m at" picker: sets the user's location without Bluetooth (Req 4). */
export default function LocationPicker({ groups, position, onSelect }: Props) {
  const value = locationPickerValue(groups, position);
  return (
    <select
      className="loc-picker"
      aria-label="Current location"
      value={value}
      onChange={(e) => { if (e.target.value) onSelect(e.target.value); }}
    >
      <option value="">I’m at…</option>
      {groups.map((g) => (
        <optgroup key={g.floor.id} label={g.floor.label}>
          {g.nodes.map((n) => <option key={n.id} value={n.id}>{destinationName(n)}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
