export type RegistrationErrorCode =
  | 'not_found'
  | 'not_registrable'
  | 'not_withdrawable'
  | 'duplicate'
  | 'validation'
  | 'forbidden'
  | 'illegal_transition'
  | 'capacity';

export class RegistrationError extends Error {
  constructor(
    readonly code: RegistrationErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'RegistrationError';
  }
}
