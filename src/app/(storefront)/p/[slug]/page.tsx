/**
 * `/p/[slug]` — the product page.
 *
 * The by-slug lookup carries the same `status: active` constraint as every listing, so a draft
 * or archived product 404s rather than rendering for anyone who guessed or kept its URL. The
 * `products` collection is publicly readable by design — staff preview unpublished work — which
 * is exactly why the constraint has to be in the query and not left to access control (A05).
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { ProductDetail } from '@/components/product/ProductDetail'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildCrumbs } from '@/lib/catalog/breadcrumbs'
import { getCatalog } from '@/lib/catalog/server'
import { breadcrumbJsonLd, productJsonLd } from '@/lib/seo/jsonLd'
import { productMetadata } from '@/lib/seo/metadata'

type Params = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const product = await (await getCatalog()).getProductBySlug(slug)
  if (!product) return { title: 'Not found', robots: { index: false, follow: false } }

  return productMetadata(product)
}

export default async function ProductPage({ params }: { params: Params }) {
  const { slug } = await params
  const catalog = await getCatalog()

  const product = await catalog.getProductBySlug(slug)
  if (!product) notFound()

  const ancestors =
    product.categoryId === null ? [] : await catalog.getCategoryAncestors(product.categoryId)
  const crumbs = buildCrumbs(ancestors, { title: product.title, href: null })

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-12">
      <JsonLd data={[productJsonLd(product), breadcrumbJsonLd(crumbs)]} />
      <Breadcrumbs crumbs={crumbs} />

      <div className="mt-6">
        <ProductDetail product={product} />
      </div>

      {product.fitNotes ? (
        <p className="text-fg-muted mt-12 max-w-prose text-sm">{product.fitNotes}</p>
      ) : null}
    </div>
  )
}
