import PoliteAnnouncer from './PoliteAnnouncer';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

const ANNOUNCEMENT =
  'Bluetooth signal lost. Tap where you are on the map, then choose I’m here.';

// Always mounted inside `.map-alerts` so the live region exists before the
// banner first appears. Returns a fragment: while hidden, only the 1px
// sr-only announcer is rendered, so no pointer-blocking box is created.
// No autoFocus or focus calls (Req 2.10).
export default function RelocateBanner({ visible, onDismiss }: Props) {
  return (
    <>
      <PoliteAnnouncer message={visible ? ANNOUNCEMENT : ''} />
      {visible && (
        <div className="relocate">
          <div className="relocate-text">
            <strong className="relocate-title">Bluetooth signal lost</strong>
            <p>Tap where you are on the map, then choose “I’m here”.</p>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="relocate-dismiss"
            onClick={onDismiss}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
