'use client'

/**
 * Holds the one piece of state the product page has: which colour is selected.
 *
 * It lives here rather than in `VariantPicker` because two siblings depend on it — the gallery
 * filters to the chosen colour and the size pills change availability with it. Lifting it to
 * their nearest common parent is what keeps the gallery from having to reach into the picker.
 * Everything it renders was computed on the server; this component only chooses between
 * pre-built views.
 */
import { useState } from 'react'

import { Gallery } from './Gallery'
import { VariantPicker } from './VariantPicker'
import { galleryFor } from '@/lib/catalog/gallery'
import { sizePillsFor } from '@/lib/catalog/productView'
import type { ProductDetailView } from '@/lib/catalog/types'

export function ProductDetail({ product }: { product: ProductDetailView }) {
  const [colourId, setColourId] = useState<number | null>(product.defaultColourId)

  const images = galleryFor(product.images, colourId)
  const sizes = sizePillsFor(product.variants, colourId)

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
      <Gallery images={images} productTitle={product.title} />
      <VariantPicker
        product={product}
        selectedColourId={colourId}
        sizes={sizes}
        onColourChange={setColourId}
      />
    </div>
  )
}
