'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, useDocumentInfo } from '@payloadcms/ui'

/**
 * The bulk variant generator, on the product edit view.
 *
 * Pick the sizes and colours, see what will be created, then create it. The counting and the
 * SKUs are the server's — this component only collects a selection and renders what came back,
 * because a client that computed the plan itself would be a second implementation to keep in
 * step with `planVariantMatrix`.
 *
 * Always dry-runs first. "This will create 12 and skip 3" before the button commits is the
 * difference between a tool an owner trusts and one they poke nervously.
 */

interface Option {
  id: number | string
  label: string
}

interface PlanResponse {
  willCreate?: number
  skipped?: number
  created?: number
  error?: string
}

export function VariantGenerator(): React.ReactElement {
  const { id: productId } = useDocumentInfo()

  const [sizes, setSizes] = useState<Option[]>([])
  const [colours, setColours] = useState<Option[]>([])
  const [selectedSizes, setSelectedSizes] = useState<Array<number | string>>([])
  const [selectedColours, setSelectedColours] = useState<Array<number | string>>([])
  const [status, setStatus] = useState<{ message: string; kind: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const load = async (): Promise<void> => {
      const [sizeRes, colourRes] = await Promise.all([
        fetch('/api/sizes?limit=100&sort=sortOrder&depth=0', { credentials: 'include' }),
        fetch('/api/colours?limit=100&sort=sortOrder&depth=0', { credentials: 'include' }),
      ])

      const sizeJson = (await sizeRes.json()) as { docs?: Array<{ id: number; label: string }> }
      const colourJson = (await colourRes.json()) as { docs?: Array<{ id: number; name: string }> }

      setSizes((sizeJson.docs ?? []).map((s) => ({ id: s.id, label: s.label })))
      setColours((colourJson.docs ?? []).map((c) => ({ id: c.id, label: c.name })))
    }

    void load()
  }, [])

  const call = useCallback(
    async (dryRun: boolean): Promise<void> => {
      if (!productId) {
        setStatus({ message: 'Save the product before generating variants.', kind: 'error' })
        return
      }

      setBusy(true)
      try {
        const response = await fetch(`/api/products/${productId}/generate-variants`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sizes: selectedSizes, colours: selectedColours, dryRun }),
        })

        const result = (await response.json()) as PlanResponse

        if (!response.ok) {
          setStatus({ message: result.error ?? 'Could not generate variants.', kind: 'error' })
          return
        }

        setStatus(
          dryRun
            ? {
                message: `Will create ${result.willCreate ?? 0} variants, skipping ${result.skipped ?? 0} that already exist.`,
                kind: 'ok',
              }
            : {
                message: `Created ${result.created ?? 0} variants. Reload to see them.`,
                kind: 'ok',
              },
        )
      } catch {
        setStatus({ message: 'The request failed. Check your connection and try again.', kind: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [productId, selectedColours, selectedSizes],
  )

  const toggle = (
    current: Array<number | string>,
    set: (next: Array<number | string>) => void,
    id: number | string,
  ): void => {
    set(current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const selectionCount = selectedSizes.length * selectedColours.length

  return (
    <div className="threadline-action">
      <span className="threadline-action__title">Generate variants</span>
      <p className="threadline-action__hint">
        Pick the sizes and colours this product comes in. SKUs are generated automatically, and
        combinations that already exist are skipped.
      </p>

      <OptionRow legend="Sizes" options={sizes} selected={selectedSizes} onToggle={(id) => toggle(selectedSizes, setSelectedSizes, id)} />
      <OptionRow legend="Colours" options={colours} selected={selectedColours} onToggle={(id) => toggle(selectedColours, setSelectedColours, id)} />

      <div className="threadline-action__row">
        <Button buttonStyle="secondary" disabled={busy || selectionCount === 0} onClick={() => void call(true)}>
          Preview {selectionCount > 0 ? `(${selectionCount})` : ''}
        </Button>
        <Button disabled={busy || selectionCount === 0} onClick={() => void call(false)}>
          Generate
        </Button>
      </div>

      {status ? (
        <p className={`threadline-action__status threadline-action__status--${status.kind}`}>
          {status.message}
        </p>
      ) : null}
    </div>
  )
}

function OptionRow({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string
  options: Option[]
  selected: Array<number | string>
  onToggle: (id: number | string) => void
}): React.ReactElement {
  return (
    <fieldset className="threadline-action__row">
      <legend className="threadline-action__hint">{legend}</legend>
      {options.map((option) => (
        <label className="threadline-action__field" key={option.id}>
          <span>
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={() => onToggle(option.id)}
            />{' '}
            {option.label}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

export default VariantGenerator
