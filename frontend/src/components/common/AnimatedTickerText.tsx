import { AnimatePresence, motion } from 'framer-motion'
import './AnimatedTickerText.css'

export function AnimatedTickerText({
  value,
  direction,
  staticSuffix = '',
  className = '',
}: {
  value: string
  direction: 1 | -1
  staticSuffix?: string
  className?: string
}) {
  const chars = value.split('')

  return (
    <span className={`animated-ticker ${className}`.trim()}>
      <span className="animated-ticker-track">
        {chars.map((char, index) => (
          <span key={`${index}-slot`} className="animated-ticker-slot">
            <AnimatePresence initial={false}>
              <motion.span
                key={`${index}-${char}`}
                className="animated-ticker-item"
                initial={{ y: direction > 0 ? 10 : -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: direction > 0 ? -10 : 10, opacity: 0 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1], delay: index * 0.01 }}
              >
                {char}
              </motion.span>
            </AnimatePresence>
          </span>
        ))}
      </span>
      {staticSuffix ? <span className="animated-ticker-suffix">{staticSuffix}</span> : null}
    </span>
  )
}
