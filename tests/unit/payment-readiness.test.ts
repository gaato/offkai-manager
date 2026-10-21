import { expect, expectTypeOf, it } from 'vitest';
import {
  requireReadyConnectedAccount,
  type ReadyConnectedAccount,
  type PaymentGateway,
  type CreateCheckoutSessionInput
} from '$lib/server/domain/payments/gateway';
it('requires a checked account for Checkout creation', () => {
  expectTypeOf<CreateCheckoutSessionInput['readyAccount']>().toEqualTypeOf<ReadyConnectedAccount>();
  expect(() =>
    requireReadyConnectedAccount({
      stripeAccountId: 'acct',
      chargesEnabled: false,
      onboardingStatus: 'ready'
    })
  ).toThrow();
  // @ts-expect-error An arbitrary account ID has no readiness proof.
  const unchecked: ReadyConnectedAccount = { stripeAccountId: 'acct' };
  expect(unchecked.stripeAccountId).toBe('acct');
});

function cannotStartUnchecked(
  gateway: PaymentGateway,
  input: Omit<CreateCheckoutSessionInput, 'readyAccount'>
) {
  // @ts-expect-error Checkout creation requires proof of card-payments readiness.
  return gateway.createCheckoutSession(input);
}
it('checks the actual Checkout call signature', () => {
  expectTypeOf(cannotStartUnchecked).toBeFunction();
});
