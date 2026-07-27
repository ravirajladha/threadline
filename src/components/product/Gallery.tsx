'use client'
// Interactive: thumbnail selection and arrow-key navigation change which image is the main one.

import { useState } from 'react'
import Image from 'next/image'
import type { ImageView } from '@/lib/catalog/types'

/**
 * The product page's gallery. `images` arrives already filtered to the selected colour — see
 * `lib/catalog/gallery.ts` — so this component only ever has to decide which of them is main.
 *
 * Sticky on desktop so the picture stays in view while the buy box scrolls independently; a
 * plain scroll on mobile, where there is no spare vertical space to hold it in place.
 */

export interface GalleryProps {
  images: ImageView[]
  /** Used only for the region's accessible name — every image already carries its own alt text. */
  productTitle: string
}

export function Gallery({ images, productTitle }: GalleryProps): React.ReactElement {
  // The chosen *image*, not its position. A colour change replaces the whole list, and an index
  // survives that change while meaning something entirely different — an id simply stops
  // matching, which is the reset, derived during render rather than chased in an effect.
  const [activeImageId, setActiveImageId] = useState<number | null>(null)

  if (images.length === 0) {
    return (
      <div
        role="img"
        aria-label={`${productTitle} — no image available`}
        className="bg-surface-raised flex items-center justify-center rounded-[--radius-card]"
        style={{ aspectRatio: '4 / 5' }}
      >
        <span className="text-fg-subtle text-sm">No image available</span>
      </div>
    )
  }

  // `findIndex` returns -1 for an id that belongs to a colour the customer has since switched
  // away from, so the floor at zero is what lands them on the new colour's first image.
  const activeIndex = Math.max(0, images.findIndex((image) => image.id === activeImageId))
  const active = images[activeIndex]

  const step = (delta: number): void => {
    const target = images[activeIndex + delta]
    if (target) setActiveImageId(target.id)
  }

  return (
    <div className="flex flex-col-reverse gap-3 md:sticky md:top-20 md:flex-row md:self-start">
      <div
        role="listbox"
        aria-label={`${productTitle} images`}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault()
            step(1)
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault()
            step(-1)
          }
        }}
        className="flex gap-2 overflow-x-auto md:w-20 md:flex-col md:overflow-y-auto"
      >
        {images.map((image, index) => (
          <button
            key={image.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            aria-label={`Image ${index + 1} of ${images.length}`}
            onClick={() => setActiveImageId(image.id)}
            className={`border-border-strong relative size-16 shrink-0 overflow-hidden rounded-[--radius-control] border transition-colors duration-fast ease-out md:size-20 ${
              index === activeIndex ? 'ring-accent ring-2' : ''
            }`}
          >
            <Image src={image.url} alt="" fill sizes="80px" className="object-cover" />
          </button>
        ))}
      </div>

      <div
        className="bg-surface-raised relative flex-1 overflow-hidden rounded-[--radius-card]"
        style={{ aspectRatio: '4 / 5' }}
      >
        {active ? (
          <Image
            key={active.id}
            src={active.url}
            alt={active.alt}
            fill
            priority
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        ) : null}
      </div>
    </div>
  )
}
