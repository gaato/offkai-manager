export const e2eUsers = {
  sweepOwner: '110000000000000001',
  organizer: '110000000000000002',
  inviteTarget: '110000000000000003',
  paymentOrganizer: '110000000000000004',
  paymentParticipant: '110000000000000005',
  suspended: '110000000000000007'
} as const;

export const suspendedUserFixture = {
  userId: '20000000-0000-4000-8000-000000000007',
  discordUserId: e2eUsers.suspended,
  displayName: 'Suspended User'
} as const;

export const opsJourney = {
  organizationName: 'Ops Suspension Journey',
  eventTitle: 'Ops Suspension Event',
  eventSlug: 'ops-suspension'
} as const;

export const paymentJourney = {
  organizationName: 'Payment Journey',
  eventTitle: 'Checkout Journey',
  eventSlug: 'checkout-journey'
} as const;

export const stripeSweepFixtures = [
  {
    organizationName: 'Stripe State One',
    status: 'not_connected',
    label: { en: 'Not connected', ja: '未接続' }
  },
  {
    organizationName: 'Stripe State Two',
    status: 'onboarding_required',
    label: { en: 'Setup required', ja: '設定が必要' }
  },
  {
    organizationName: 'Stripe State Three',
    status: 'pending_verification',
    label: { en: 'Pending verification', ja: '審査中' }
  },
  {
    organizationName: 'Stripe State Four',
    status: 'ready',
    label: { en: 'Ready', ja: '利用可能' }
  },
  {
    organizationName: 'Stripe State Five',
    status: 'disabled',
    label: { en: 'Unavailable', ja: '利用停止中' }
  }
] as const;

export const devStripeOrganizations = {
  sweep: 'Stripe Development Page',
  journey: 'Stripe Onboarding Journey'
} as const;

export const paymentEventFixtures = {
  draft: 'Payments Draft Event',
  frozen: 'Payments Frozen Event'
} as const;

export const participantFixtures = {
  applied: {
    discordUserId: '110000000000000011',
    registrationId: '10000000-0000-4000-8000-000000000011',
    displayName: 'Pending Participant'
  },
  confirmed: {
    discordUserId: '110000000000000012',
    registrationId: '10000000-0000-4000-8000-000000000012',
    displayName: 'Secured Participant'
  },
  waitlisted: {
    discordUserId: '110000000000000013',
    registrationId: '10000000-0000-4000-8000-000000000013',
    displayName: 'Waiting Participant'
  },
  cancelled: {
    discordUserId: '110000000000000014',
    registrationId: '10000000-0000-4000-8000-000000000014',
    displayName: 'Withdrawn Participant'
  },
  paid: {
    discordUserId: '110000000000000016',
    registrationId: '10000000-0000-4000-8000-000000000016',
    displayName: 'Paid Participant'
  },
  conflict: {
    discordUserId: '110000000000000017',
    registrationId: '10000000-0000-4000-8000-000000000017',
    displayName: 'Conflict Participant'
  },
  refunded: {
    discordUserId: '110000000000000018',
    registrationId: '10000000-0000-4000-8000-000000000018',
    displayName: 'Refunded Participant'
  }
} as const;

export const discordSetupFixture = {
  eventId: 'ee000000-0000-4000-8000-000000000001',
  organizationName: 'Discord Setup Fixtures',
  title: 'Previous Discord Event',
  guildId: '400000000000000001',
  highRoleId: '400000000000000004',
  channelId: '400000000000000005'
} as const;

export const paidJourney = {
  organizationName: 'Paid Organizer Journey',
  eventTitle: 'Pay later meetup',
  payoutOrganizationName: 'Embedded Payouts Journey'
} as const;
