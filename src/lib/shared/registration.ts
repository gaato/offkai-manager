import { z } from 'zod';

export const registrationStatuses = ['applied', 'confirmed', 'waitlisted', 'cancelled'] as const;
export const registrationStatusSchema = z.enum(registrationStatuses);
export type RegistrationStatus = z.infer<typeof registrationStatusSchema>;

export function registrationStatusLabelKey(
  status: RegistrationStatus
): `registration.status.${RegistrationStatus}` {
  return `registration.status.${status}`;
}
