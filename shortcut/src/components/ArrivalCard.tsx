import PoliteAnnouncer from './PoliteAnnouncer';

interface Props {
  visible: boolean;
  destName: string;
  appearance: number;
  onDone: () => void;
}

// Shown in place of the turn-by-turn list once the user reaches the
// destination. The announcer stays mounted so the arrival message is
// announced politely when it appears. Keying the card by `appearance`
// remounts it once per appearance, so the CSS entrance animation plays
// exactly once and never on ordinary re-renders.
export default function ArrivalCard({ visible, destName, appearance, onDone }: Props) {
  return (
    <>
      <PoliteAnnouncer message={visible ? `You’ve arrived at ${destName}` : ''} />
      {visible && (
        <div className="arrival" key={appearance}>
          <div className="arrival-title">You’ve arrived</div>
          <div className="arrival-name">{destName}</div>
          <button type="button" onClick={onDone}>
            Done
          </button>
        </div>
      )}
    </>
  );
}
