import { z } from 'zod';

export const organizationRoles = ['viewer', 'staff', 'organizer', 'owner'] as const;
export const organizationRoleSchema = z.enum(organizationRoles);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
export const invitableOrganizationRoleSchema = z.enum(['viewer', 'staff', 'organizer']);
export type InvitableOrganizationRole = z.infer<typeof invitableOrganizationRoleSchema>;

export const membershipStatuses = ['active', 'disabled'] as const;
export const membershipStatusSchema = z.enum(membershipStatuses);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

const roleRank: Readonly<Record<OrganizationRole, number>> = {
  viewer: 1,
  staff: 2,
  organizer: 3,
  owner: 4
};

export function organizationRoleRank(role: OrganizationRole): number {
  return roleRank[role];
}

export function roleAtLeast(role: OrganizationRole, minimum: OrganizationRole): boolean {
  return organizationRoleRank(role) >= organizationRoleRank(minimum);
}

export interface OrganizationCapabilities {
  canManageTeam: boolean;
  canManageEvent: boolean;
  canManageRegistrationForm: boolean;
  canManageDiscord: boolean;
  canManageCollection: boolean;
  canManageStripe: boolean;
  canOperateParticipants: boolean;
  canCheckIn: boolean;
  canRecordPayments: boolean;
  canWaivePayments: boolean;
  canViewAudit: boolean;
}

export function capabilitiesForRole(role: OrganizationRole): OrganizationCapabilities {
  return {
    canManageTeam: role === 'owner',
    canManageEvent: roleAtLeast(role, 'organizer'),
    canManageRegistrationForm: roleAtLeast(role, 'organizer'),
    canManageDiscord: roleAtLeast(role, 'organizer'),
    canManageCollection: roleAtLeast(role, 'organizer'),
    canManageStripe: role === 'owner',
    canOperateParticipants: roleAtLeast(role, 'organizer'),
    canCheckIn: roleAtLeast(role, 'staff'),
    canRecordPayments: roleAtLeast(role, 'staff'),
    canWaivePayments: roleAtLeast(role, 'organizer'),
    canViewAudit: roleAtLeast(role, 'staff')
  };
}

export function readOnlyOrganizationCapabilities(): OrganizationCapabilities {
  return {
    canManageTeam: false,
    canManageEvent: false,
    canManageRegistrationForm: false,
    canManageDiscord: false,
    canManageCollection: false,
    canManageStripe: false,
    canOperateParticipants: false,
    canCheckIn: false,
    canRecordPayments: false,
    canWaivePayments: false,
    canViewAudit: true
  };
}

export function organizationRoleLabelKey(
  role: OrganizationRole
): `organization.role.${OrganizationRole}` {
  return `organization.role.${role}`;
}

export function membershipStatusLabelKey(
  status: MembershipStatus
): `organization.membership_status.${MembershipStatus}` {
  return `organization.membership_status.${status}`;
}
