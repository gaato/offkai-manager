export type EventErrorCode =
  | 'disclosure_required'
  | 'forbidden'
  | 'illegal_transition'
  | 'not_found'
  | 'slug_collision'
  | 'validation';

export class EventError extends Error {
  constructor(
    readonly code: EventErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'EventError';
  }
}
