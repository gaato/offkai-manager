export { authorizeOrganizationRole, type AuthorizedOrganization } from './authorization';

export { OrganizationError, type OrganizationErrorCode } from './errors';

export {
  createOrganization,
  listOrganizationsForUser,
  getOrganizationForUser,
  listOrganizationMembers,
  inviteMember,
  changeRole,
  disableMembership,
  enableMembership
} from './service';

export { availableOrganizationSlug, organizationSlugBase } from './slug';

export type {
  ChangeMembershipStatusInput,
  ChangeRoleInput,
  CreateOrganizationInput,
  InviteMemberInput,
  OrganizationMember,
  OrganizationSummary
} from './types';

export {
  capabilitiesForRole,
  organizationRoleRank,
  roleAtLeast,
  type OrganizationCapabilities,
  type OrganizationRole
} from '$lib/shared/organization';

export { ensurePersonalOrganization } from './personal';
