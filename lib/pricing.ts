import { createClient } from 'next-sanity'

// Separate client with useCdn:false so checkout never uses a stale cached price.
const fresh = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2024-01-01',
  useCdn: false,
})

export type PricedProduct = { sku: string; name: string; price: number }

export function getPrices(skus: string[]) {
  return fresh.fetch<PricedProduct[]>(
    `*[_type == "product" && sku in $skus]{ sku, name, price }`,
    { skus },
  )
}

// Placeholder values. Set your real zones and fees.
export const DELIVERY_FEES: Record<string, number> = {
  pickup: 0,
  nairobi: 300,
  upcountry: 600,
}