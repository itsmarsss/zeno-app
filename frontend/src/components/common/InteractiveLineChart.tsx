import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { buildAreaPath, buildPath, clamp } from '../../shared/dashboard'
import { AnimatedTickerText } from './AnimatedTickerText'
import './InteractiveLineChart.css'

export type InteractiveLineChartPoint = {
  id: string
  label: string
  value: number | null
}

export function InteractiveLineChart({
  points,
  yMin,
  yMax,
  thresholdValue,
  thresholdLabel,
  hoverHint = 'Move cursor to inspect',
  valueLabel = 'Value',
  valueSuffix = '',
  className = '',
  lineClassName = '',
  areaClassName = '',
  thresholdClassName = '',
}: {
  points: InteractiveLineChartPoint[]
  yMin: number
  yMax: number
  thresholdValue?: number
  thresholdLabel?: string
  hoverHint?: string
  valueLabel?: string
  valueSuffix?: string
  className?: string
  lineClassName?: string
  areaClassName?: string
  thresholdClassName?: string
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverXPx, setHoverXPx] = useState<number | null>(null)
  const [chartWidthPx, setChartWidthPx] = useState<number>(0)
  const [chartLeftPx, setChartLeftPx] = useState<number>(0)
  const [hoverDirection, setHoverDirection] = useState<1 | -1>(1)
  const previousHoverIndexRef = useRef<number | null>(null)

  const values = points.map((point) => point.value)
  const areaValues = values.map((value) => value ?? yMin)
  const linePath = buildPath(values, yMin, yMax, 100, 100)
  const areaPath = buildAreaPath(areaValues, yMin, yMax, 100, 100)

  const hoveredPoint = hoverIndex != null ? points[hoverIndex] : null
  const hoverRatio = hoverIndex == null ? 0 : hoverIndex / Math.max(points.length - 1, 1)
  const fallbackXPx = chartWidthPx > 0 ? chartLeftPx + hoverRatio * chartWidthPx : 0
  const cursorXPx = hoverXPx ?? fallbackXPx

  const tooltipWidthPx = 188
  const tooltipPaddingPx = 8
  const tooltipMinLeft = chartLeftPx + tooltipPaddingPx
  const tooltipMaxLeft = chartLeftPx + Math.max(tooltipPaddingPx, chartWidthPx - tooltipWidthPx - tooltipPaddingPx)
  const tooltipLeftPx = clamp(cursorXPx - tooltipWidthPx / 2, tooltipMinLeft, tooltipMaxLeft)

  const thresholdY =
    thresholdValue == null
      ? null
      : 100 - clamp((thresholdValue - yMin) / Math.max(yMax - yMin, 1), 0, 1) * 100

  const axisStep = Math.max(1, Math.ceil(points.length / 8))

  return (
    <div
      className={`interactive-chart-canvas ${className}`.trim()}
      onMouseLeave={() => {
        setHoverIndex(null)
        setHoverXPx(null)
        previousHoverIndexRef.current = null
      }}
      onPointerMove={(event) => {
        const canvasRect = event.currentTarget.getBoundingClientRect()
        const svgRect = svgRef.current?.getBoundingClientRect() ?? canvasRect
        const localLeft = Math.max(0, svgRect.left - canvasRect.left)
        const localWidth = Math.max(svgRect.width, 1)
        const xWithinSvg = clamp(event.clientX - svgRect.left, 0, localWidth)
        const ratio = clamp(xWithinSvg / localWidth, 0, 1)
        const nextIndex = Math.round(ratio * (points.length - 1))
        const prev = previousHoverIndexRef.current
        if (prev != null && nextIndex !== prev) {
          setHoverDirection(nextIndex > prev ? 1 : -1)
        }
        previousHoverIndexRef.current = nextIndex
        setChartLeftPx(localLeft)
        setChartWidthPx(localWidth)
        setHoverXPx(localLeft + xWithinSvg)
        setHoverIndex(nextIndex)
      }}
    >
      <svg ref={svgRef} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {thresholdY != null && (
          <line x1="0" x2="100" y1={thresholdY} y2={thresholdY} className={`interactive-chart-threshold ${thresholdClassName}`.trim()} />
        )}
        <path d={areaPath} className={`interactive-chart-area ${areaClassName}`.trim()} />
        <path d={linePath} className={`interactive-chart-line ${lineClassName}`.trim()} />
      </svg>

      <AnimatePresence initial={false}>
        {hoveredPoint && (
          <>
            <motion.div
              className="interactive-chart-cursor"
              initial={{ opacity: 0 }}
              animate={{ left: `${cursorXPx}px`, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'tween', duration: 0.08, ease: 'easeOut' }}
            />
            <motion.div
              className="interactive-chart-tooltip"
              initial={{ opacity: 0, y: 6 }}
              animate={{ left: `${tooltipLeftPx}px`, opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ type: 'tween', duration: 0.12, ease: 'easeOut' }}
            >
              <p>
                <AnimatedTickerText value={hoveredPoint.label} direction={hoverDirection} />
              </p>
              <div className="interactive-chart-tooltip-row">
                <strong>
                  <AnimatedTickerText
                    value={hoveredPoint.value == null ? '--' : `${hoveredPoint.value}${valueSuffix}`}
                    direction={hoverDirection}
                  />
                </strong>
                <span>{valueLabel}</span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {thresholdLabel ? <span className="interactive-chart-threshold-label">{thresholdLabel}</span> : null}
      <div className="interactive-chart-hover-hint">
        <span>{hoverHint}</span>
      </div>
      <div className="interactive-chart-axis" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
        {points.map((point, index) => (
          index % axisStep === 0 || index === points.length - 1 ? <span key={point.id}>{point.label}</span> : <span key={point.id} />
        ))}
      </div>
    </div>
  )
}
