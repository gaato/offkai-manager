import type {
  InvitableOrganizationRole,
  MembershipStatus,
  OrganizationRole
} from '$lib/shared/organization';

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  actorRole: OrganizationRole;
  suspendedAt: Date | null;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  status: MembershipStatus;
  discordUserId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export interface CreateOrganizationInput {
  actorUserId: string;
  name: string;
}

export interface InviteMemberInput {
  actorUserId: string;
  organizationId: string;
  discordUserId: string;
  role: InvitableOrganizationRole;
}

export interface ChangeRoleInput {
  actorUserId: string;
  membershipId: string;
  role: OrganizationRole;
  reason?: string;
}

export interface ChangeMembershipStatusInput {
  actorUserId: string;
  membershipId: string;
  reason?: string;
}
