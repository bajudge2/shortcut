/**
 * Parses what a QR code (or page URL) can contain:
 *   https://host/?at=f1_j2&to=f2_r_c     (web / Safari camera flow)
 *   cnav:f1_j2                           (compact, for in-app scanner)
 *   f1_j2                                (bare node id)
 */
export interface AnchorPayload { at?: string; to?: string }

export function parseAnchor(text: string): AnchorPayload | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('cnav:')) return { at: t.slice(5) };
  try {
    const u = new URL(t);
    const at = u.searchParams.get('at') ?? undefined;
    const to = u.searchParams.get('to') ?? undefined;
    if (at || to) return { at, to };
    return null;
  } catch {
    return /^[\w-]+$/.test(t) ? { at: t } : null;
  }
}

export function qrPayloadForNode(nodeId: string): string {
  return `cnav:${nodeId}`;
}
