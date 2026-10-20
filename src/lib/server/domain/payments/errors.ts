export type ConnectErrorCode = 'forbidden' | 'not_connected' | 'not_found';

export class ConnectError extends Error {
  constructor(
    readonly code: ConnectErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ConnectError';
  }
}

export type CollectionErrorCode =
  'amount_frozen' | 'conflict' | 'illegal_transition' | 'not_found' | 'validation';

export class CollectionError extends Error {
  constructor(
    readonly code: CollectionErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'CollectionError';
  }
}

export type PaymentErrorCode =
  | 'conflict'
  | 'gateway'
  | 'invalid_method'
  | 'not_found'
  | 'not_payable'
  | 'not_ready'
  | 'validation';

export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PaymentError';
  }
}

export type SettlementErrorCode =
  'account_mismatch' | 'amount_mismatch' | 'resolution_miss' | 'validation';

export class SettlementError extends Error {
  constructor(
    readonly code: SettlementErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SettlementError';
  }
}
