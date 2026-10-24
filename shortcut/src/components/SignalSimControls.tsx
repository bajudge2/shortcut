import { SIGNAL_QUIET_THRESHOLD_MS } from '../config';
import type { BeaconDef } from '../lib/types';

interface Props {
  beacons: BeaconDef[];
  simOn: boolean;
  disabled: boolean;
  quietSeconds: number;
  lost: boolean;
  onToggle: (on: boolean) => void;
  onBeacon: (id: string) => void;
}

// Debug-panel controls for simulating Bluetooth beacon sightings.
// Pure UI: reports intent via callbacks and never computes a position.
export default function SignalSimControls({ beacons, simOn, disabled, quietSeconds, lost, onToggle, onBeacon }: Props) {
  const thresholdSeconds = Math.round(SIGNAL_QUIET_THRESHOLD_MS / 1000);

  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={simOn}
          disabled={disabled}
          onChange={(e) => {
            if (disabled) return;
            onToggle(e.target.checked);
          }}
        />{' '}
        Simulate Bluetooth
      </label>
      {simOn && (
        <>
          <div>
            {beacons.map((b) => (
              <button key={b.id} type="button" className="ghost" onClick={() => onBeacon(b.id)}>
                {b.id}
              </button>
            ))}
          </div>
          <div>
            Quiet: {quietSeconds} s · Signal lost: {lost ? 'Yes' : 'No'} · Banner after {thresholdSeconds} s
          </div>
        </>
      )}
    </>
  );
}
