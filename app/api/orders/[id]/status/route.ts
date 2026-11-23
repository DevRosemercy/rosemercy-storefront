import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { orders } from '@/db/schema'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [o] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, id))
  if (!o) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ status: o.status }, { headers: { 'Cache-Control': 'no-store' } })
}