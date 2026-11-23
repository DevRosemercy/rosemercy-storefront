import { sql } from 'drizzle-orm'
import {
  pgTable, pgEnum, uuid, text, integer, serial, timestamp, jsonb, check,
} from 'drizzle-orm/pg-core'

export const orderStatus = pgEnum('order_status', [
  'pending_payment',
  'paid',
  'failed',
  'expired',
  'needs_review',
])

export const stock = pgTable(
  'stock',
  {
    sku: text('sku').primaryKey(),
    qty: integer('qty').notNull().default(0),
  },
  (t) => [check('stock_qty_non_negative', sql`${t.qty} >= 0`)],
)

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: orderStatus('status').notNull().default('pending_payment'),
  customerName: text('customer_name').notNull(),
  email: text('email'),
  phone: text('phone').notNull(),
  deliveryZone: text('delivery_zone').notNull(),
  subtotal: integer('subtotal').notNull(),
  deliveryFee: integer('delivery_fee').notNull(),
  total: integer('total').notNull(),
  merchantRequestId: text('merchant_request_id'),
  checkoutRequestId: text('checkout_request_id').unique(),
  mpesaReceipt: text('mpesa_receipt').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  unitPrice: integer('unit_price').notNull(),
  qty: integer('qty').notNull(),
})

export const paymentEvents = pgTable('payment_events', {
  id: serial('id').primaryKey(),
  checkoutRequestId: text('checkout_request_id'),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})