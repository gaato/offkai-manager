import { describe, expect, it } from 'vitest';
import { buildCampaignPledgesCSV } from '$lib/server/exports/campaign-pledges';
import type { CampaignForOrganization } from '$lib/server/domain/campaigns';

describe('campaign pledge export', () => {
  it('adds a UTF-8 BOM, localizes status, and neutralizes supporter formulas', () => {
    const createdAt = new Date('2026-07-19T01:02:00Z');
    const data: CampaignForOrganization = {
      campaign: {
        id: '10000000-0000-4000-8000-000000000001',
        organizationId: '20000000-0000-4000-8000-000000000001',
        title: 'Export campaign',
        slug: 'export-campaign',
        description: '',
        unitPriceMinor: 1_000n,
        currency: 'JPY',
        goalMinor: 10_000n,
        maxUnitsPerPledge: 10,
        fulfillmentDate: null,
        fulfillmentNote: '',
        contact: 'contact@example.test',
        completionReportText: null,
        completionReportedAt: null,
        status: 'open',
        createdAt,
        updatedAt: createdAt
      },
      organizationName: 'Export organization',
      organizationSlug: 'export-organization',
      actorRole: 'staff',
      organizationSuspendedAt: null,
      canManageCampaign: false,
      canViewCampaignLedger: true,
      raisedMinor: 1_000n,
      paidOrderCount: 1,
      priceFrozen: true,
      currencyFrozen: true,
      pledges: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          displayName: '=FORMULA()',
          listPublicly: false,
          unitCount: 1,
          unitPriceMinor: 1_000n,
          amountMinor: 1_000n,
          currency: 'JPY',
          status: 'paid',
          paidAt: createdAt,
          linkedUser: false,
          createdAt
        }
      ]
    };

    const csv = buildCampaignPledgesCSV(data, 'en', 'Asia/Tokyo');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=FORMULA()");
    expect(csv).toContain('Payment complete');
    expect(csv).toContain('Guest checkout');

    const ja = buildCampaignPledgesCSV(data, 'ja', 'Asia/Tokyo');
    expect(ja).toContain('応援者の表示名,口数');
    expect(ja).toContain('支払い完了');
  });
});
