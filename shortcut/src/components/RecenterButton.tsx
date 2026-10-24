interface Props { onRecenter: () => void }

/** On-map button shown while following is paused; resumes following (Req 7.6, 8.6). */
export default function RecenterButton({ onRecenter }: Props) {
  return (
    <button type="button" className="recenter" aria-label="Recenter on my location" onClick={onRecenter}>
      <span aria-hidden="true">◎</span> Recenter
    </button>
  );
}
