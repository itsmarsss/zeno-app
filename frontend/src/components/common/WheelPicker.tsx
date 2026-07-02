import { useEffect, useMemo, useRef } from 'react'
import './WheelPicker.css'

export type WheelItem = {
  value: string | number
  label: string
}

type WheelColumnProps = {
  items: WheelItem[]
  value: string | number
  onChange: (value: string | number) => void
  ariaLabel?: string
  /** Fixed width hint, e.g. 72 */
  width?: number
}

const ITEM_H = 36
const VISIBLE = 5
const PAD = Math.floor(VISIBLE / 2) * ITEM_H

function nearestIndex(scrollTop: number, count: number): number {
  const raw = Math.round(scrollTop / ITEM_H)
  return Math.max(0, Math.min(count - 1, raw))
}

/** Single snap-scrolling column - Apple-style wheel. */
export function WheelColumn({ items, value, onChange, ariaLabel, width }: WheelColumnProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const lockRef = useRef(false)
  const index = Math.max(
    0,
    items.findIndex((item) => String(item.value) === String(value)),
  )

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || lockRef.current) return
    const top = index * ITEM_H
    if (Math.abs(el.scrollTop - top) > 1) {
      el.scrollTop = top
    }
  }, [index, items.length])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    let frame = 0
    let settleTimer = 0

    const emit = () => {
      const i = nearestIndex(el.scrollTop, items.length)
      const next = items[i]
      if (next != null && String(next.value) !== String(value)) {
        onChange(next.value)
      }
      // Snap cleanly after inertia.
      const target = i * ITEM_H
      if (Math.abs(el.scrollTop - target) > 0.5) {
        el.scrollTo({ top: target, behavior: 'smooth' })
      }
    }

    const onScroll = () => {
      lockRef.current = true
      window.clearTimeout(settleTimer)
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        // Live-update selection while scrolling for responsive feel.
        const i = nearestIndex(el.scrollTop, items.length)
        const next = items[i]
        if (next != null && String(next.value) !== String(value)) {
          onChange(next.value)
        }
      })
      settleTimer = window.setTimeout(() => {
        emit()
        lockRef.current = false
      }, 80)
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      window.clearTimeout(settleTimer)
      window.cancelAnimationFrame(frame)
    }
  }, [items, onChange, value])

  return (
    <div className="wheel-col" style={width ? { width } : undefined} aria-label={ariaLabel}>
      <div className="wheel-col-scroller" ref={scrollerRef}>
        <div className="wheel-col-pad" style={{ height: PAD }} />
        {items.map((item) => {
          const selected = String(item.value) === String(value)
          return (
            <button
              key={String(item.value)}
              type="button"
              className={`wheel-col-item ${selected ? 'is-selected' : ''}`}
              style={{ height: ITEM_H }}
              onClick={() => {
                onChange(item.value)
                scrollerRef.current?.scrollTo({ top: items.findIndex((i) => String(i.value) === String(item.value)) * ITEM_H, behavior: 'smooth' })
              }}
            >
              {item.label}
            </button>
          )
        })}
        <div className="wheel-col-pad" style={{ height: PAD }} />
      </div>
    </div>
  )
}

type WheelPickerProps = {
  columns: Array<{
    items: WheelItem[]
    value: string | number
    onChange: (value: string | number) => void
    ariaLabel?: string
    width?: number
    unit?: string
  }>
}

/** Multi-column wheel group with shared selection band (iOS-like). */
export function WheelPicker({ columns }: WheelPickerProps) {
  return (
    <div className="wheel-picker" style={{ height: ITEM_H * VISIBLE }}>
      <div className="wheel-picker-band" style={{ height: ITEM_H, top: PAD }} />
      <div className="wheel-picker-fade wheel-picker-fade--top" />
      <div className="wheel-picker-fade wheel-picker-fade--bottom" />
      <div className="wheel-picker-cols">
        {columns.map((col, i) => (
          <div key={i} className="wheel-picker-col-wrap">
            <WheelColumn
              items={col.items}
              value={col.value}
              onChange={col.onChange}
              ariaLabel={col.ariaLabel}
              width={col.width}
            />
            {col.unit ? <span className="wheel-picker-unit">{col.unit}</span> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export function rangeItems(start: number, end: number, step = 1, pad = 0): WheelItem[] {
  const items: WheelItem[] = []
  for (let n = start; n <= end; n += step) {
    const label = pad > 0 ? String(n).padStart(pad, '0') : String(n)
    items.push({ value: n, label })
  }
  return items
}

export function formatMinutesLabel(totalMinutes: number): string {
  if (totalMinutes <= 0) return 'Never'
  if (totalMinutes < 60) return `Every ${totalMinutes} min`
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (m === 0) return h === 1 ? 'Every 1 hour' : `Every ${h} hours`
  return `Every ${h}h ${m}m`
}

export function formatDurationLabel(totalMinutes: number): string {
  if (totalMinutes <= 0) return 'Never'
  if (totalMinutes < 60) return `After ${totalMinutes} min`
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (m === 0) return h === 1 ? 'After 1 hour' : `After ${h} hours`
  return `After ${h}h ${m}m`
}

export function formatClockLabel(hour24: number, minute: number): string {
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`
}

export function useMinuteOptions(min: number, max: number, step = 1) {
  return useMemo(() => rangeItems(min, max, step), [min, max, step])
}
