import { useRef, useState, type ReactNode } from 'react'
import { buildAreaPath, buildLinearPath, buildPath, clamp } from '../../shared/dashboard'
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
  valueLabel = 'Value',
  valueSuffix = '',
  className = '',
  lineClassName = '',
  areaClassName = '',
  areaGradientId,
  areaGradientColor,
  thresholdClassName = '',
  showAxis = true,
  chartHeight = 130,
  tooltipWidth = 188,
  showTooltip = true,
  extraLines = [],
  renderTooltip,
  onHoverChange,
}: {
  points: InteractiveLineChartPoint[]
  yMin: number
  yMax: number
  thresholdValue?: number
  thresholdLabel?: string
  valueLabel?: string
  valueSuffix?: string
  className?: string
  lineClassName?: string
  areaClassName?: string
  areaGradientId?: string
  areaGradientColor?: string
  thresholdClassName?: string
  showAxis?: boolean
  chartHeight?: number
  tooltipWidth?: number
  showTooltip?: boolean
  extraLines?: Array<{
    values: Array<number | null>
    yMin?: number
    yMax?: number
    className?: string
    smooth?: boolean
  }>
  renderTooltip?: (args: { point: InteractiveLineChartPoint; index: number; direction: 1 | -1 }) => ReactNode
  onHoverChange?: (index: number | null, direction: 1 | -1) => void
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

  // Calculate cursor position in SVG viewBox coordinates (0-100)
  const cursorXPx = hoverXPx ?? 0
  const cursorXInViewBox = chartWidthPx > 0 ? (cursorXPx / chartWidthPx) * 100 : 0

  // Tooltip is positioned relative to canvas, so add SVG offset
  const tooltipWidthPx = tooltipWidth
  const tooltipPaddingPx = 4
  const tooltipCursorX = chartLeftPx + cursorXPx
  const tooltipMinLeft = chartLeftPx + tooltipPaddingPx
  const tooltipMaxLeft = chartLeftPx + chartWidthPx - tooltipWidthPx - tooltipPaddingPx
  const tooltipLeftPx = clamp(tooltipCursorX - tooltipWidthPx / 2, tooltipMinLeft, tooltipMaxLeft)

  const thresholdY =
    thresholdValue == null ? null : 100 - clamp((thresholdValue - yMin) / Math.max(yMax - yMin, 1), 0, 1) * 100

  const axisStep = Math.max(1, Math.ceil(points.length / 8))

  return (
    <div
      className={`interactive-chart-canvas ${className}`.trim()}
      onMouseLeave={() => {
        setHoverIndex(null)
        setHoverXPx(null)
        previousHoverIndexRef.current = null
        if (onHoverChange) onHoverChange(null, hoverDirection)
      }}
      onPointerMove={(event) => {
        const canvasRect = event.currentTarget.getBoundingClientRect()
        const svgRect = svgRef.current?.getBoundingClientRect()
        if (!svgRect) return

        const svgLeftOffset = svgRect.left - canvasRect.left
        const svgWidth = Math.max(svgRect.width, 1)
        const xWithinSvg = clamp(event.clientX - svgRect.left, 0, svgWidth)
        const ratio = clamp(xWithinSvg / svgWidth, 0, 1)
        const nextIndex = Math.round(ratio * (points.length - 1))
        const prev = previousHoverIndexRef.current
        let nextDirection = hoverDirection
        if (prev != null && nextIndex !== prev) {
          nextDirection = nextIndex > prev ? 1 : -1
          setHoverDirection(nextDirection)
        }
        previousHoverIndexRef.current = nextIndex
        setChartLeftPx(svgLeftOffset)
        setChartWidthPx(svgWidth)
        setHoverXPx(xWithinSvg)
        setHoverIndex(nextIndex)
        if (onHoverChange) onHoverChange(nextIndex, nextDirection)
      }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        style={{ height: `${chartHeight}px` }}
      >
        {areaGradientId && areaGradientColor ? (
          <defs>
            <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={areaGradientColor} stopOpacity="0.18" />
              <stop offset="100%" stopColor={areaGradientColor} stopOpacity="0" />
            </linearGradient>
          </defs>
        ) : null}
        {thresholdY != null && (
          <line
            x1="0"
            x2="100"
            y1={thresholdY}
            y2={thresholdY}
            className={`interactive-chart-threshold ${thresholdClassName}`.trim()}
          />
        )}
        <path
          d={areaPath}
          className={`interactive-chart-area ${areaClassName}`.trim()}
          style={areaGradientId ? { fill: `url(#${areaGradientId})` } : undefined}
        />
        <path d={linePath} className={`interactive-chart-line ${lineClassName}`.trim()} />
        {extraLines.map((line, index) => {
          const pathBuilder = line.smooth === false ? buildLinearPath : buildPath
          const path = pathBuilder(line.values, line.yMin ?? yMin, line.yMax ?? yMax, 100, 100)
          if (!path) return null
          return (
            <path
              key={`extra-line-${index}`}
              d={path}
              className={`interactive-chart-line ${line.className ?? ''}`.trim()}
            />
          )
        })}
        {hoveredPoint && (
          <line
            x1={cursorXInViewBox}
            x2={cursorXInViewBox}
            y1="0"
            y2="100"
            className="interactive-chart-cursor"
            style={{ opacity: 1 }}
          />
        )}
      </svg>

      {showTooltip && hoveredPoint && hoverIndex !== null && (
        <div className="interactive-chart-tooltip" style={{ left: `${tooltipLeftPx}px`, width: `${tooltipWidthPx}px`, opacity: 1 }}>
          {renderTooltip ? (
            renderTooltip({ point: hoveredPoint, index: hoverIndex as number, direction: hoverDirection })
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {thresholdLabel ? <span className="interactive-chart-threshold-label">{thresholdLabel}</span> : null}
      {showAxis ? (
        <div
          className="interactive-chart-axis"
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
        >
          {points.map((point, index) =>
            index % axisStep === 0 || index === points.length - 1 ? (
              <span key={point.id}>{point.label}</span>
            ) : (
              <span key={point.id} />
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}
