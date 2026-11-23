import { Suspense } from 'react'
import { client } from '@/lib/sanity'

async function getProducts() {
  return client.fetch(`*[_type == "product"]{
    _id, name, price, description, inStock,
    "imageUrl": image.asset->url
  }`)
}

async function ProductList() {
  const products = await getProducts()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {products.map((p: any) => (
        <div key={p._id} className="border rounded-lg overflow-hidden shadow-sm">
          {p.imageUrl && (
            <img
              src={p.imageUrl}
              alt={p.name}
              className="w-full h-48 object-cover"
            />
          )}
          <div className="p-4">
            <h2 className="font-semibold text-lg">{p.name}</h2>
            <p className="text-gray-600 text-sm mb-2">
              {p.description || 'No description'}
            </p>
            <p className="font-bold">${p.price}</p>
            <p className={`text-sm ${p.inStock ? 'text-green-600' : 'text-red-600'}`}>
              {p.inStock ? 'In stock' : 'Out of stock'}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ProductsPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Products</h1>
      <Suspense fallback={<p>Loading products...</p>}>
        <ProductList />
      </Suspense>
    </div>
  )
}