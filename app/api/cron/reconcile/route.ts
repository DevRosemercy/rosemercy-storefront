import { NextResponse } from 'next/server'
import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { orders } from '@/db/schema'
import { stkQuery } from '@/lib/mpesa'
import { applyPaymentResult, expireOrder } from '@/lib/orders'

// Call every 1-2 minutes with: Authorization: Bearer <CRON_SECRET>
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({}, { status: 401 })
  }
  const now = new Date()

  const waiting = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, 'pending_payment'),
        isNotNull(orders.checkoutRequestId),
        lt(orders.createdAt, new Date(now.getTime() - 90_000)),
      ),
    )
  for (const o of waiting) {
    const q = await stkQuery(o.checkoutRequestId!)
    if (q.pending) {
      if (o.expiresAt < now) await expireOrder(o.id)
      continue
    }
    await applyPaymentResult({ checkoutRequestId: o.checkoutRequestId!, resultCode: q.resultCode })
  }

  const orphans = await db
    .select()
    .from(orders)
    .where(and(eq(orders.status, 'pending_payment'), isNull(orders.checkoutRequestId), lt(orders.expiresAt, now)))
  for (const o of orphans) await expireOrder(o.id)

  return NextResponse.json({ checked: waiting.length, expiredOrphans: orphans.length })
}