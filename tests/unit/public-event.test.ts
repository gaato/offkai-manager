import { describe, expect, it } from 'vitest';
import type { EventSummary } from '$lib/server/domain/events';
import { publicVenue, registrationAvailability } from '$lib/server/domain/registrations';

const event = {
  paymentRequirement: 'none',
  platformFeeBps: 0,
  amountToCollectMinor: 0n,
  roundingUnit: 1,
  holdMinutes: 30,
  id: 'event-id',
  organizationId: 'organization-id',
  title: 'Test event',
  slug: 'test-event',
  description: '',
  startsAt: new Date('2027-08-14T04:00:00Z'),
  endsAt: new Date('2027-08-14T07:00:00Z'),
  capacity: 1,
  visibility: 'public',
  discordPolicy: 'not_used',
  registrationOpensAt: new Date('2027-01-01T00:00:00Z'),
  registrationClosesAt: new Date('2027-08-13T15:00:00Z'),
  venueName: 'Hall',
  venueAddress: 'Secret address',
  venueReveal: 'confirmed',
  contact: '',
  panelTemplateJa: '',
  panelTemplateEn: '',
  panelTemplateReviewedAt: null,
  cancellationPolicy: '',
  registrationMode: 'auto_confirm',
  cancelledAt: null,
  archivedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z')
} satisfies EventSummary;

describe('public event presentation rules', () => {
  it('keeps a full auto-confirm event open for its waitlist', () => {
    expect(registrationAvailability(event, 1, new Date('2027-06-01T00:00:00Z'))).toEqual({
      state: 'waitlist',
      canRegister: true
    });
  });
  it('reports the opening instant before the registration window', () => {
    expect(registrationAvailability(event, 0, new Date('2026-12-01T00:00:00Z'))).toEqual({
      state: 'before_open',
      canRegister: false,
      opensAt: event.registrationOpensAt
    });
  });
  it('reveals a restricted address only to confirmed viewers', () => {
    expect(publicVenue(event, false)).toEqual({
      name: 'Hall',
      address: '',
      revealAfterConfirmation: true
    });
    expect(publicVenue(event, true)).toEqual({
      name: 'Hall',
      address: 'Secret address',
      revealAfterConfirmation: false
    });
  });
});
