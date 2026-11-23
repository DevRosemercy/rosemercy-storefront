const BASE =
  process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke'

let cached: { token: string; exp: number } | null = null

async function getToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 30_000) return cached.token
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`,
  ).toString('base64')
  const res = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status}`)
  const json = await res.json()
  cached = { token: json.access_token, exp: Date.now() + Number(json.expires_in) * 1000 }
  return cached.token
}

// YYYYMMDDHHmmss in Nairobi time (UTC+3)
function timestamp() {
  return new Date(Date.now() + 3 * 3600_000).toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

function password(ts: string) {
  return Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${ts}`,
  ).toString('base64')
}

export function normalizeKePhone(input: string): string | null {
  const d = input.replace(/\D/g, '')
  if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1)
  if (/^254[17]\d{8}$/.test(d)) return d
  if (/^[17]\d{8}$/.test(d)) return '254' + d
  return null
}

export async function stkPush(p: { phone: string; amount: number; orderId: string }) {
  const ts = timestamp()
  const body = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password(ts),
    Timestamp: ts,
    TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
    Amount: p.amount,
    PartyA: p.phone,
    PartyB: process.env.MPESA_PARTY_B || process.env.MPESA_SHORTCODE,
    PhoneNumber: p.phone,
    CallBackURL: `${process.env.MPESA_CALLBACK_BASE_URL}/api/mpesa/callback?token=${process.env.MPESA_CALLBACK_SECRET}`,
    AccountReference: p.orderId.replace(/-/g, '').slice(0, 12),
    TransactionDesc: 'Rosemercy order',
  }
  const res = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ResponseCode !== '0') {
    throw new Error(`STK push rejected: ${JSON.stringify(json)}`)
  }
  return {
    merchantRequestId: json.MerchantRequestID as string,
    checkoutRequestId: json.CheckoutRequestID as string,
  }
}

// Returns { pending: true } while the customer has not finished, otherwise the final ResultCode.
export async function stkQuery(checkoutRequestId: string) {
  const ts = timestamp()
  const res = await fetch(`${BASE}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password(ts),
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ResultCode === undefined) return { pending: true as const }
  return { pending: false as const, resultCode: Number(json.ResultCode) }
}