import type { EventSummary } from '$lib/server/domain/events';

export interface PublicEvent {
  event: EventSummary;
  organizationName: string;
  organizationSlug: string;
  confirmedCount: number;
}

export type RegistrationAvailability =
  | {
      state: 'cancelled';
      canRegister: false;
    }
  | {
      state: 'before_open';
      canRegister: false;
      opensAt: Date;
    }
  | {
      state: 'closed';
      canRegister: false;
    }
  | {
      state: 'waitlist';
      canRegister: true;
    }
  | {
      state: 'open';
      canRegister: true;
    };

export interface PublicVenue {
  name: string;
  address: string;
  revealAfterConfirmation: boolean;
}
