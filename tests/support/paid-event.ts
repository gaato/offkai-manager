import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { events, stripeConnectAccounts } from '$lib/server/db/schema';
import { configureEventPayment } from '$lib/server/domain/payments/event-payment';
import { defaultTuning } from '$lib/server/config';
import { write } from '$lib/server/db/client';
import { createRegistration } from '$lib/server/domain/registrations';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import { fixedClock } from '../database';
import { discordEvent } from './discord-registration';
import type { PaymentRequirement } from '$lib/shared/payment';
import type {
  CreateCheckoutSessionInput,
  PaymentGateway
} from '$lib/server/domain/payments/gateway';
export async function paidEvent(
  client: DatabaseClient,
  requirement: PaymentRequirement = 'pay_to_confirm',
  capacity = 1
) {
  const base = await discordEvent(client, { capacity });
  write(client, (tx) => {
    tx.insert(stripeConnectAccounts)
      .values({
        organizationId: base.org.id,
        stripeAccountId: 'acct_paid',
        dashboardType: 'none',
        chargesEnabled: true,
        detailsSubmitted: true,
        payoutsEnabled: true,
        onboardingStatus: 'ready',
        createdAt: fixedClock.now(),
        updatedAt: fixedClock.now()
      })
      .run();
    const event = tx
      .update(events)
      .set({ platformFeeBps: 200 })
      .where(eq(events.id, base.event.id))
      .returning()
      .get()!;
    configureEventPayment(
      tx,
      event,
      {
        paymentRequirement: requirement,
        amountToCollect: '5000',
        roundingUnit: 100,
        holdMinutes: 30,
        manualCash: true,
        manualPayPay: true
      },
      fixedClock,
      defaultTuning
    );
  });
  const join = async (id = '200000000000000002') => {
    const user = await upsertDiscordIdentity(
      client,
      {
        providerUserId: id,
        username: 'paid-participant',
        displayName: 'Participant',
        avatarUrl: ''
      },
      fixedClock
    );
    return createRegistration(
      client,
      {
        organizationSlug: base.org.slug,
        eventSlug: base.event.slug,
        userId: user.userId,
        displayName: 'Participant',
        answers: []
      },
      fixedClock
    );
  };
  return {
    ...base,
    event: client.db.select().from(events).where(eq(events.id, base.event.id)).get()!,
    join
  };
}
export class GatedCheckout implements PaymentGateway {
  input!: CreateCheckoutSessionInput;
  calls = 0;
  private enter!: () => void;
  private release!: () => void;
  readonly entered = new Promise<void>((resolve) => {
    this.enter = resolve;
  });
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  resume() {
    this.release();
  }
  async createCheckoutSession(input: CreateCheckoutSessionInput) {
    this.calls++;
    this.input = input;
    this.enter();
    await this.gate;
    return {
      sessionId: 'cs_gated',
      url: 'https://checkout.stripe.test/cs_gated',
      paymentIntentId: 'pi_gated'
    };
  }
  settlement(id = 'evt_paid') {
    return {
      stripeEventId: id,
      eventType: 'checkout.session.completed',
      sessionId: 'cs_gated',
      referenceId: this.input.referenceId,
      paymentIntentId: 'pi_gated',
      paymentStatus: 'paid',
      amountTotal: this.input.amountMinor,
      currency: this.input.currency,
      stripeAccountId: this.input.readyAccount.stripeAccountId,
      raw: { id }
    };
  }
}
