import type { ProductCardView } from '@/lib/catalog/types'
import { ProductCard } from '../product/ProductCard'
import { Skeleton } from '../ui/Skeleton'

/**
 * The listing grid. Two columns on a phone, three from tablet width, four from desktop —
 * DESIGN.md is specific about this because a clothing grid with too few columns on a wide
 * screen wastes the one thing a listing page has to sell: how much there is to see at once.
 */

export interface ProductGridProps {
  products: ProductCardView[]
}

export function ProductGrid({ products }: ProductGridProps): React.ReactElement {
  return (
    <ul role="list" className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  )
}

export interface ProductGridSkeletonProps {
  count?: number
}

export function ProductGridSkeleton({ count = 8 }: ProductGridSkeletonProps): React.ReactElement {
  return (
    <ul role="list" aria-hidden="true" className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="flex flex-col gap-3">
          <Skeleton className="w-full" style={{ aspectRatio: '4 / 5' }} />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
        </li>
      ))}
    </ul>
  )
}
