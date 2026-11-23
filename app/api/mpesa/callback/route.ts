import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { paymentEvents } from '@/db/schema'
import { applyPaymentResult } from '@/lib/orders'

const ack = () => NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get('token')
  if (!process.env.MPESA_CALLBACK_SECRET || token !== process.env.MPESA_CALLBACK_SECRET) {
    return NextResponse.json({}, { status: 403 })
  }

  const raw = await req.json().catch(() => null)
  const cb = raw?.Body?.stkCallback
  if (!cb?.CheckoutRequestID) return ack()

  try {
    await db.insert(paymentEvents).values({ checkoutRequestId: cb.CheckoutRequestID, payload: raw })

    const meta: { Name: string; Value?: string | number }[] = cb.CallbackMetadata?.Item ?? []
    const get = (n: string) => meta.find((i) => i.Name === n)?.Value

    const outcome = await applyPaymentResult({
      checkoutRequestId: cb.CheckoutRequestID,
      resultCode: Number(cb.ResultCode),
      receipt: get('MpesaReceiptNumber') as string | undefined,
      amount: get('Amount') !== undefined ? Number(get('Amount')) : undefined,
    })

    if (outcome === 'paid') {
      // TODO: send confirmation email/SMS here
    }
  } catch (e) {
    // Still ack. The reconcile job will settle this order later.
    console.error('Callback processing error', e)
  }
  return ack()
}