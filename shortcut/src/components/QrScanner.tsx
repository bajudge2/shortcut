import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface Props {
  onResult: (text: string) => void;
  onClose: () => void;
}

/** In-app QR scanner (the iOS Camera app would open Safari instead of this app). */
export default function QrScanner({ onResult, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const cb = useRef(onResult);
  cb.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let last = 0;

    const tick = (t: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      const v = video.current;
      const c = canvas.current;
      if (!v || !c || v.readyState < 2 || t - last < 120) return; // ~8 scans/sec
      last = t;
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (!w || !h) return;
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (code?.data) { stopped = true; cb.current(code.data); }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Camera unavailable');
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner">
      <video ref={video} playsInline muted />
      <canvas ref={canvas} hidden />
      <div className="scanner-frame" />
      <div className="scanner-bar">
        <span>{error ?? 'Point at a Shortcut QR code'}</span>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
