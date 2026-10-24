import type { FollowView, PlanRect } from './follow-view.ts';

export type FollowMode = 'following' | 'paused';
export type FollowEvent = 'userMove' | 'recenter' | 'destChange' | 'floorChange' | 'newAnchor';
export const INITIAL_FOLLOW_MODE: FollowMode = 'following';

/** userMove -> 'paused'; every other event -> 'following' (Req 7.1, 7.6, 7.7, 7.9). */
export function stepFollow(_mode: FollowMode, event: FollowEvent): FollowMode {
  return event === 'userMove' ? 'paused' : 'following';
}

/** True iff mode is 'paused' and a Follow_View exists (Req 7.4, 7.5, 7.10). */
export function showRecenter(mode: FollowMode, follow: FollowView | null): boolean {
  return mode === 'paused' && follow !== null;
}

export type ViewCommand =
  | { kind: 'follow'; rect: PlanRect }
  | { kind: 'plan' }
  | { kind: 'reveal' }
  | { kind: 'none' };

/**
 * Exactly one view change (Req 7.11), in priority order:
 *  follow  when following and a Follow_View exists   (Req 6.1)
 *  plan    else when the floor is first shown/changed (Req 6.4)
 *  reveal  else when a new anchor was set              (Req 6.5)
 *  none    otherwise                                   (Req 6.6, 7.2)
 */
export function viewCommand(
  mode: FollowMode,
  follow: FollowView | null,
  floorChanged: boolean,
  newAnchor: boolean,
): ViewCommand {
  if (mode === 'following' && follow) return { kind: 'follow', rect: follow.rect };
  if (floorChanged) return { kind: 'plan' };
  if (newAnchor) return { kind: 'reveal' };
  return { kind: 'none' };
}
