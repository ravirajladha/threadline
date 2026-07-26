import Image from 'next/image'
import Link from 'next/link'
import type { ProductCardView } from '@/lib/catalog/types'
import { Price } from '../ui/Price'
import { Swatch } from '../ui/Swatch'

/**
 * One grid cell. The hover-to-second-image swap is pure CSS (`group-hover`) rather than a
 * mouse-enter handler, because a state update per hovered card is real work a stylesheet does
 * for free, and it keeps the whole grid a server component.
 */

export interface ProductCardProps {
  product: ProductCardView
}

export function ProductCard({ product }: ProductCardProps): React.ReactElement {
  const { title, slug, image, hoverImage, priceRange, compareAtPricePaise, swatches, isSoldOut, lowStockQty } =
    product
  const isRange = priceRange.minPaise !== priceRange.maxPaise

  return (
    <Link href={`/p/${slug}`} className="group flex flex-col gap-3">
      <div
        className="bg-surface-raised relative overflow-hidden rounded-[--radius-card]"
        style={{ aspectRatio: '4 / 5' }}
      >
        {image ? (
          <Image
            src={image.url}
            alt={image.alt || title}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className={`object-cover transition-opacity duration-base ease-out ${
              hoverImage ? 'group-hover:opacity-0' : ''
            }`}
          />
        ) : null}
        {hoverImage ? (
          <Image
            src={hoverImage.url}
            alt=""
            aria-hidden="true"
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover opacity-0 transition-opacity duration-base ease-out group-hover:opacity-100"
          />
        ) : null}

        {isSoldOut ? (
          <div className="absolute inset-0 flex items-center justify-center bg-fg/10">
            <span className="bg-surface text-fg rounded-[--radius-control] px-3 py-1 text-xs font-medium">
              Sold out
            </span>
          </div>
        ) : null}

        {!isSoldOut && lowStockQty !== null ? (
          <span className="bg-surface text-warning absolute top-2 left-2 rounded-[--radius-control] px-2 py-1 text-xs font-medium">
            Only {lowStockQty} left
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-fg line-clamp-2 text-sm font-medium">{title}</h3>

        {isRange ? (
          <span className="text-fg-muted inline-flex items-baseline gap-2 text-sm">
            From <Price pricePaise={priceRange.minPaise} size="sm" />
          </span>
        ) : (
          <Price pricePaise={priceRange.minPaise} compareAtPricePaise={compareAtPricePaise} size="sm" />
        )}

        {swatches.length > 0 ? (
          <div className="flex items-center gap-2 pt-1">
            {swatches.map((swatch) => (
              <Swatch key={swatch.id} swatch={swatch} size="sm" />
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  )
}
