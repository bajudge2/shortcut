/**
 * Parses demo/deep-link parameters from a page URL:
 *   https://host/?at=f1_j2&to=f2_r_c   -> start at node f1_j2, route to f2_r_c
 * Used to pre-stage a scene (open the app already positioned and routing).
 */
export interface DeepLink { at?: string; to?: string }

export function parseDeepLink(url: string): DeepLink | null {
  try {
    const u = new URL(url);
    const at = u.searchParams.get('at') ?? undefined;
    const to = u.searchParams.get('to') ?? undefined;
    return at || to ? { at, to } : null;
  } catch {
    return null;
  }
}
