import { describe, expect, it } from 'vitest';
import { availableOrganizationSlug, organizationSlugBase } from '$lib/server/domain/orgs/slug';
import { capabilitiesForRole, organizationRoleRank, roleAtLeast } from '$lib/shared/organization';

describe('organization slugs', () => {
  it('normalizes names to lowercase URL segments', () => {
    expect(organizationSlugBase('  Café Meetup 2026  ')).toBe('cafe-meetup-2026');
    expect(organizationSlugBase('東京オフ会')).toBe('');
  });
  it('uses the first available numeric collision suffix', () => {
    expect(
      availableOrganizationSlug('Community', new Set(['community', 'community-2', 'community-4']))
    ).toBe('community-3');
  });
  it('uses a short random base36 slug when the name has no ASCII', () => {
    const candidates = ['abc1234', 'tok2026'];
    expect(
      availableOrganizationSlug('東京オフ会', new Set(['abc1234']), () => candidates.shift()!)
    ).toBe('tok2026');
  });
  it('rejects an invalid random fallback', () => {
    expect(() => availableOrganizationSlug('東京オフ会', new Set(), () => 'NOT-A-SLUG')).toThrow(
      /lowercase base36/
    );
  });
});

describe('organization role ranking', () => {
  it('orders viewer below staff below organizer below owner', () => {
    expect((['viewer', 'staff', 'organizer', 'owner'] as const).map(organizationRoleRank)).toEqual([
      1, 2, 3, 4
    ]);
    expect(roleAtLeast('owner', 'organizer')).toBe(true);
    expect(roleAtLeast('staff', 'organizer')).toBe(false);
  });
  it('ports the legacy capability matrix', () => {
    expect(capabilitiesForRole('viewer')).toMatchObject({
      canManageTeam: false,
      canCheckIn: false,
      canManageEvent: false
    });
    expect(capabilitiesForRole('staff')).toMatchObject({
      canManageTeam: false,
      canCheckIn: true,
      canManageEvent: false
    });
    expect(capabilitiesForRole('organizer')).toMatchObject({
      canManageTeam: false,
      canManageStripe: false,
      canCheckIn: true,
      canManageEvent: true
    });
    expect(capabilitiesForRole('owner')).toMatchObject({
      canManageTeam: true,
      canManageStripe: true,
      canCheckIn: true,
      canManageEvent: true
    });
  });
});
