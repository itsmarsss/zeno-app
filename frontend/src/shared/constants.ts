import type { BreathingPatternId, Exercise } from './types'

export const BREATHING_PATTERNS: Record<
  BreathingPatternId,
  { name: string; phases: { label: 'Inhale' | 'Hold' | 'Exhale'; seconds: number }[]; cycles: number }
> = {
  box: {
    name: 'Box breathing',
    phases: [
      { label: 'Inhale', seconds: 4 },
      { label: 'Hold', seconds: 4 },
      { label: 'Exhale', seconds: 4 },
      { label: 'Hold', seconds: 4 },
    ],
    cycles: 4,
  },
  'four-seven-eight': {
    name: '4-7-8 breathing',
    phases: [
      { label: 'Inhale', seconds: 4 },
      { label: 'Hold', seconds: 7 },
      { label: 'Exhale', seconds: 8 },
    ],
    cycles: 4,
  },
}

export const EXERCISE_LIBRARY: Exercise[] = [
  {
    id: 'chin-tuck',
    name: 'Chin tucks',
    target: 'Neck alignment',
    duration_minutes: 2,
    difficulty: 'easy',
    space: 'desk',
    steps: ['Sit tall and look forward.', 'Pull chin straight back (not down).', 'Hold 3 seconds, release, repeat 10 times.'],
  },
  {
    id: 'wall-angels',
    name: 'Wall angels',
    target: 'Upper back mobility',
    duration_minutes: 3,
    difficulty: 'moderate',
    space: 'open',
    steps: ['Stand against a wall with arms bent at 90°.', 'Slide arms up slowly while keeping contact.', 'Return down with control for 8-10 reps.'],
  },
  {
    id: 'scap-squeeze',
    name: 'Scapular squeeze',
    target: 'Shoulder stability',
    duration_minutes: 2,
    difficulty: 'easy',
    space: 'desk',
    steps: ['Relax shoulders down.', 'Squeeze shoulder blades gently together.', 'Hold 4 seconds, repeat 12 times.'],
  },
  {
    id: 'thoracic-extension',
    name: 'Thoracic extension',
    target: 'Spine extension',
    duration_minutes: 3,
    difficulty: 'moderate',
    space: 'desk',
    steps: ['Sit upright with hands behind head.', 'Lift chest and extend upper back slightly.', 'Return neutral and repeat 8-10 reps.'],
  },
  {
    id: 'doorway-pec-stretch',
    name: 'Doorway pec stretch',
    target: 'Chest opening',
    duration_minutes: 2,
    difficulty: 'easy',
    space: 'open',
    steps: ['Place forearm on door frame at shoulder height.', 'Step forward until chest stretch is felt.', 'Hold 20 seconds each side, 3 rounds.'],
  },
  {
    id: 'seated-side-bend',
    name: 'Seated side bend',
    target: 'Lateral chain release',
    duration_minutes: 2,
    difficulty: 'easy',
    space: 'desk',
    steps: ['Sit with both feet grounded.', 'Reach one arm overhead and lean to opposite side.', 'Hold 15 seconds per side for 4 rounds.'],
  },
]

export const FREE_EXERCISE_IDS = new Set(['chin-tuck', 'scap-squeeze'])
