import { orders } from '$lib/server/db/schema';
import { parseOrderStatus, type Order } from './types';

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;

/** Narrows an untyped database status while preserving all order snapshot fields. */
export function parseOrderRow(row: OrderRow): Order {
  return { ...row, status: parseOrderStatus(row.status) };
}
