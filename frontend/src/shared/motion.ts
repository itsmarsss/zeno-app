import type { Transition, Variants } from 'framer-motion'

export const springToggle: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 28,
}

const easeCurve = [0.16, 1, 0.3, 1] as [number, number, number, number]

export const easeOut: Transition = {
  duration: 0.28,
  ease: easeCurve,
}

export const fadeSlide: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: easeOut },
  exit: { opacity: 0, y: 6, transition: { duration: 0.18 } },
}

export function staggerItem(delay = 0): Variants {
  return {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.28, ease: easeCurve, delay },
    },
  }
}
