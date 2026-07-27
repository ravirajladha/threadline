'use client'
// Interactive: toggles the measurement unit between inches and centimetres.

import { useState } from 'react'
import type { SizeChartView } from '@/lib/catalog/types'
import { Modal } from '../ui/Modal'

/**
 * "Will this fit me" is the question a size chart exists to answer, and it only does that if
 * the customer can read it in the unit they think in. Conversion is trivial presentational
 * maths — 1 inch is always 2.54cm — not a business rule, so it stays here rather than in `lib/`.
 */

type Unit = 'in' | 'cm'

type MeasurementKey = 'chestIn' | 'waistIn' | 'lengthIn' | 'shoulderIn'

const COLUMNS: Array<{ key: MeasurementKey; label: string }> = [
  { key: 'chestIn', label: 'Chest' },
  { key: 'waistIn', label: 'Waist' },
  { key: 'lengthIn', label: 'Length' },
  { key: 'shoulderIn', label: 'Shoulder' },
]

function formatMeasurement(valueIn: number | null, unit: Unit): string {
  if (valueIn === null) return '—'
  if (unit === 'in') return valueIn.toString()
  return (Math.round(valueIn * 2.54 * 10) / 10).toString()
}

export interface SizeChartModalProps {
  chart: SizeChartView | null
  open: boolean
  onClose: () => void
}

export function SizeChartModal({ chart, open, onClose }: SizeChartModalProps): React.ReactElement {
  const [unit, setUnit] = useState<Unit>('in')

  return (
    <Modal open={open} onClose={onClose} title={chart?.title ?? 'Size guide'}>
      {chart ? (
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Measurement unit" className="border-border-strong inline-flex self-start rounded-control border p-0.5">
            {(['in', 'cm'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={unit === option}
                onClick={() => setUnit(option)}
                className={`rounded-control px-3 py-1.5 text-sm transition-colors duration-fast ease-out ${
                  unit === option ? 'bg-accent text-accent-fg' : 'text-fg-muted'
                }`}
              >
                {option === 'in' ? 'Inches' : 'Centimetres'}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th scope="col" className="text-fg-muted py-2 pr-4 font-medium">
                    Size
                  </th>
                  {COLUMNS.map((column) => (
                    <th key={column.key} scope="col" className="text-fg-muted py-2 pr-4 font-medium">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chart.rows.map((row) => (
                  <tr key={row.sizeLabel} className="border-border border-b last:border-b-0">
                    <th scope="row" className="text-fg py-2 pr-4 font-medium">
                      {row.sizeLabel}
                    </th>
                    {COLUMNS.map((column) => (
                      <td key={column.key} className="text-fg-muted py-2 pr-4">
                        {formatMeasurement(row[column.key], unit)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {chart.notes ? <p className="text-fg-muted text-sm">{chart.notes}</p> : null}
        </div>
      ) : (
        <p className="text-fg-muted text-sm">No size chart is available for this product.</p>
      )}
    </Modal>
  )
}
