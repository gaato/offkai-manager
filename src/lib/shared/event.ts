import { z } from 'zod';

export const eventVisibilities = ['draft', 'public', 'unlisted'] as const;
export const eventVisibilitySchema = z.enum(eventVisibilities);
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;

export const registrationModes = ['auto_confirm', 'approval'] as const;
export const registrationModeSchema = z.enum(registrationModes);
export type RegistrationMode = z.infer<typeof registrationModeSchema>;

export const venueReveals = ['public', 'confirmed'] as const;
export const venueRevealSchema = z.enum(venueReveals);
export type VenueReveal = z.infer<typeof venueRevealSchema>;

export const discordPolicies = [
  'not_used',
  'optional',
  'login_required',
  'guild_join_required'
] as const;
export const discordPolicySchema = z.enum(discordPolicies);
export type DiscordPolicy = z.infer<typeof discordPolicySchema>;

export function eventVisibilityLabelKey(
  visibility: EventVisibility
): `event.visibility.${EventVisibility}` {
  return `event.visibility.${visibility}`;
}

export function registrationModeLabelKey(
  mode: RegistrationMode
): `event.registration_mode.${RegistrationMode}` {
  return `event.registration_mode.${mode}`;
}

export function venueRevealLabelKey(reveal: VenueReveal): `event.venue_reveal.${VenueReveal}` {
  return `event.venue_reveal.${reveal}`;
}

export function discordPolicyLabelKey(
  policy: DiscordPolicy
): `event.discord_policy.${DiscordPolicy}` {
  return `event.discord_policy.${policy}`;
}
