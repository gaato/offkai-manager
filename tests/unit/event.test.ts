import { describe, expect, it } from 'vitest';
import { generateEventSlug } from '$lib/server/domain/events/slug';
import {
  canTransitionEvent,
  toggledVisibility,
  type EventLifecycleState,
  type EventTransition
} from '$lib/server/domain/events/transitions';

describe('event slug', () => {
  it('uses the configured local date and a four-character unambiguous code', () => {
    const instant = new Date('2026-07-19T15:30:00.000Z');
    expect(generateEventSlug(instant, 'Asia/Tokyo', Uint8Array.from([0, 1, 2, 31]))).toBe(
      '20260720-abca'
    );
    expect(
      generateEventSlug(instant, 'America/Los_Angeles', Uint8Array.from([3, 4, 5, 6]))
    ).toMatch(/^20260719-[a-z2-9]{4}$/);
  });
});

describe('event lifecycle transition table', () => {
  const states = {
    draft: { visibility: 'draft', cancelled: false, archived: false },
    public: { visibility: 'public', cancelled: false, archived: false },
    unlisted: { visibility: 'unlisted', cancelled: false, archived: false },
    cancelled: { visibility: 'public', cancelled: true, archived: false },
    archived: { visibility: 'draft', cancelled: false, archived: true }
  } as const satisfies Record<string, EventLifecycleState>;
  const transitions: EventTransition[] = ['publish', 'toggle_unlisted', 'cancel', 'archive'];
  const expected = {
    draft: [true, false, true, true],
    public: [false, true, true, true],
    unlisted: [false, true, true, true],
    cancelled: [false, false, true, true],
    archived: [false, false, false, false]
  } as const;

  for (const [name, state] of Object.entries(states)) {
    it(`enforces transitions from ${name}`, () => {
      expect(transitions.map((transition) => canTransitionEvent(state, transition))).toEqual(
        expected[name as keyof typeof expected]
      );
    });
  }

  it('toggles only listed visibility values', () => {
    expect(toggledVisibility('public')).toBe('unlisted');
    expect(toggledVisibility('unlisted')).toBe('public');
    expect(toggledVisibility('draft')).toBeNull();
  });
});
