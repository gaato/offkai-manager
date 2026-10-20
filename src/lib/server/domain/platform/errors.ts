export type PlatformErrorCode = 'not_found' | 'self_suspend' | 'validation';

export class PlatformError extends Error {
  constructor(
    public readonly code: PlatformErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PlatformError';
  }
}
