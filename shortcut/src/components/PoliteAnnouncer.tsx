interface Props {
  message: string;
}

// Always-mounted, visually hidden live region. Screen readers announce
// changes to `message` politely (after current speech finishes).
export default function PoliteAnnouncer({ message }: Props) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
