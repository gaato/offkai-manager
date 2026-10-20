export type OrganizationErrorCode =
  'conflict' | 'forbidden' | 'last_owner' | 'not_found' | 'validation';

export class OrganizationError extends Error {
  constructor(
    readonly code: OrganizationErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'OrganizationError';
  }
}
