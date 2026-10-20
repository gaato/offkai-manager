import type { EventVisibility } from '$lib/shared/event';

export type EventTransition = 'archive' | 'cancel' | 'publish' | 'toggle_unlisted';

export interface EventLifecycleState {
  visibility: EventVisibility;
  cancelled: boolean;
  archived: boolean;
}

export function canTransitionEvent(
  state: EventLifecycleState,
  transition: EventTransition
): boolean {
  if (state.archived) return false;
  if (transition === 'archive') return true;
  if (transition === 'cancel') return true;
  if (state.cancelled) return false;
  if (transition === 'publish') return state.visibility === 'draft';
  return state.visibility === 'public' || state.visibility === 'unlisted';
}

export function toggledVisibility(visibility: EventVisibility): EventVisibility | null {
  if (visibility === 'public') return 'unlisted';
  if (visibility === 'unlisted') return 'public';
  return null;
}
