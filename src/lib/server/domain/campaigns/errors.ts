export type CampaignErrorCode =
  | 'conflict'
  | 'gateway'
  | 'illegal_transition'
  | 'not_payable'
  | 'not_ready'
  | 'not_found'
  | 'settings_frozen'
  | 'validation';

export class CampaignError extends Error {
  constructor(
    readonly code: CampaignErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'CampaignError';
  }
}
