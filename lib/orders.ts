import { and, eq, sql } from 'drizzle-orm'
import { db } from './db'
import { orders, orderItems, stock } from '@/db/schema'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class OutOfStockError extends Error {
  constructor(public sku: string) {
    super(`Out of stock: ${sku}`)
  }
}

export type Line = { sku: string; name: string; unitPrice: number; qty: number }

async function restoreStock(tx: Tx, orderId: string) {
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  for (const it of items) {
    await tx
      .update(stock)
      .set({ qty: sql`${stock.qty} + ${it.qty}` })
      .where(eq(stock.sku, it.sku))
  }
}

export async function createOrderAndReserve(input: {
  lines: Line[]
  customer: { name: string; email?: string; phone: string }
  zone: string
  deliveryFee: number
}) {
  const lines = [...input.lines].sort((a, b) => a.sku.localeCompare(b.sku))
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const total = subtotal + input.deliveryFee

  return db.transaction(async (tx) => {
    for (const l of lines) {
      const res = await tx
        .update(stock)
        .set({ qty: sql`${stock.qty} - ${l.qty}` })
        .where(and(eq(stock.sku, l.sku), sql`${stock.qty} >= ${l.qty}`))
        .returning({ sku: stock.sku })
      if (res.length === 0) throw new OutOfStockError(l.sku)
    }
    const [order] = await tx
      .insert(orders)
      .values({
        customerName: input.customer.name,
        email: input.customer.email,
        phone: input.customer.phone,
        deliveryZone: input.zone,
        subtotal,
        deliveryFee: input.deliveryFee,
        total,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      })
      .returning()
    await tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId: order.id,
        sku: l.sku,
        name: l.name,
        unitPrice: l.unitPrice,
        qty: l.qty,
      })),
    )
    return order
  })
}

export async function attachStkRequest(orderId: string, merchantRequestId: string, checkoutRequestId: string) {
  await db.update(orders).set({ merchantRequestId, checkoutRequestId }).where(eq(orders.id, orderId))
}

async function closeOrder(orderId: string, to: 'failed' | 'expired') {
  await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
    if (!o || o.status !== 'pending_payment') return
    await restoreStock(tx, orderId)
    await tx.update(orders).set({ status: to }).where(eq(orders.id, orderId))
  })
}
export const failOrder = (id: string) => closeOrder(id, 'failed')
export const expireOrder = (id: string) => closeOrder(id, 'expired')

export type PaymentOutcome = 'unknown' | 'duplicate' | 'paid' | 'failed' | 'needs_review'

// The single place payment results are applied. Safe to call repeatedly for the same payment.
export async function applyPaymentResult(p: {
  checkoutRequestId: string
  resultCode: number
  receipt?: string
  amount?: number
}): Promise<PaymentOutcome> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.checkoutRequestId, p.checkoutRequestId))
      .for('update')
    if (!order) return 'unknown'
    if (['paid', 'failed', 'needs_review'].includes(order.status)) return 'duplicate'

    if (p.resultCode === 0) {
      const amountOk = p.amount === undefined || p.amount === order.total
      if (order.status === 'pending_payment' && amountOk) {
        await tx
          .update(orders)
          .set({ status: 'paid', paidAt: new Date(), mpesaReceipt: p.receipt ?? null })
          .where(eq(orders.id, order.id))
        return 'paid'
      }
      await tx
        .update(orders)
        .set({ status: 'needs_review', mpesaReceipt: p.receipt ?? null })
        .where(eq(orders.id, order.id))
      return 'needs_review'
    }

    if (order.status === 'pending_payment') {
      await restoreStock(tx, order.id)
      await tx.update(orders).set({ status: 'failed' }).where(eq(orders.id, order.id))
      return 'failed'
    }
    return 'duplicate'
  })
}