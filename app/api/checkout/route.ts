import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPrices, DELIVERY_FEES } from '@/lib/pricing'
import { normalizeKePhone, stkPush } from '@/lib/mpesa'
import { createOrderAndReserve, attachStkRequest, failOrder, OutOfStockError } from '@/lib/orders'

const Body = z.object({
  items: z
    .array(z.object({ sku: z.string().min(1), qty: z.number().int().min(1).max(20) }))
    .min(1)
    .max(50),
  name: z.string().trim().min(2).max(100),
  email: z.string().email().optional(),
  phone: z.string(),
  zone: z.enum(['pickup', 'nairobi', 'upcountry']),
})

export async function POST(req: Request) {
  // TODO: rate-limit per IP and per phone to stop STK prompt spam.
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { items, name, email, phone: rawPhone, zone } = parsed.data

  const phone = normalizeKePhone(rawPhone)
  if (!phone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })

  const qtyBySku = new Map<string, number>()
  for (const i of items) qtyBySku.set(i.sku, (qtyBySku.get(i.sku) ?? 0) + i.qty)

  const products = await getPrices([...qtyBySku.keys()])
  if (products.length !== qtyBySku.size) {
    return NextResponse.json({ error: 'Some items are no longer available' }, { status: 409 })
  }
  const lines = products.map((p) => ({
    sku: p.sku,
    name: p.name,
    unitPrice: Math.round(p.price),
    qty: qtyBySku.get(p.sku)!,
  }))

  let order
  try {
    order = await createOrderAndReserve({
      lines,
      customer: { name, email, phone },
      zone,
      deliveryFee: DELIVERY_FEES[zone],
    })
  } catch (e) {
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ error: `Not enough stock for ${e.sku}` }, { status: 409 })
    }
    throw e
  }

  try {
    const stk = await stkPush({ phone, amount: order.total, orderId: order.id })
    await attachStkRequest(order.id, stk.merchantRequestId, stk.checkoutRequestId)
  } catch (e) {
    console.error('STK push failed', e)
    await failOrder(order.id)
    return NextResponse.json({ error: 'Could not start M-Pesa payment' }, { status: 502 })
  }

  return NextResponse.json({ orderId: order.id })
}