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
    description:
      'Resets forward head posture from screen time. A small, controlled move that strengthens deep neck flexors without straining.',
    steps: [
      'Sit tall and look straight ahead — imagine a string lifting the crown of your head.',
      'Gently pull your chin straight back (like making a double chin), not down toward your chest.',
      'Hold for about 3 seconds, release to neutral, and repeat for 10 controlled reps.',
    ],
  },
  {
    id: 'wall-angels',
    name: 'Wall angels',
    target: 'Upper back mobility',
    duration_minutes: 3,
    difficulty: 'moderate',
    space: 'open',
    description:
      'Opens the chest and mobilizes the upper back. Great after long laptop sessions when shoulders roll forward.',
    steps: [
      'Stand with your back, head, and arms against a wall; elbows bent about 90° (goalpost position).',
      'Slowly slide your arms upward while keeping elbows and wrists in light contact with the wall.',
      'Return down with control for 8–10 smooth reps. Stop if you feel sharp pain.',
    ],
  },
  {
    id: 'scap-squeeze',
    name: 'Scapular squeeze',
    target: 'Shoulder stability',
    duration_minutes: 2,
    difficulty: 'easy',
    space: 'desk',
    description:
      'Wakes up the muscles between your shoulder blades so shoulders sit more neutrally while you work.',
    steps: [
      'Sit or stand tall with arms relaxed at your sides and shoulders dropped away from your ears.',
      'Gently squeeze your shoulder blades together as if pinching a pencil between them.',
      'Hold for about 4 seconds, release fully, and repeat 12 times without shrugging up.',
    ],
  },
  {
    id: 'thoracic-extension',
    name: 'Thoracic extension',
    target: 'Spine extension',
    duration_minutes: 3,
    difficulty: 'moderate',
    space: 'desk',
    description:
      'Counters the rounded upper-back posture common at desks. Emphasize a gentle lift through the chest, not the low back.',
    steps: [
      'Sit upright near the edge of your chair with both feet flat; place hands lightly behind your head.',
      'Lift your chest and gently extend through the upper back while keeping your ribs from flaring hard.',
      'Return to neutral with control and repeat for 8–10 slow reps.',
    ],
  },
  {
    id: 'doorway-pec-stretch',
    name: 'Doorway pec stretch',
    target: 'Chest opening',
    duration_minutes: 2,
    difficulty: 'easy',
    space: 'open',
    description:
      'Lengthens tight chest muscles that pull shoulders forward. Keep the stretch mild and even on both sides.',
    steps: [
      'Stand in a doorway and place one forearm on the frame at about shoulder height, elbow bent ~90°.',
      'Step the same-side foot forward until you feel a gentle stretch across the front of the chest/shoulder.',
      'Hold about 20 seconds, switch sides, and complete 3 rounds each side. Breathe slowly throughout.',
    ],
  },
  {
    id: 'seated-side-bend',
    name: 'Seated side bend',
    target: 'Lateral chain release',
    duration_minutes: 2,
    difficulty: 'easy',
    space: 'desk',
    description:
      'Releases the side body and ribcage after sitting still. Stay long through the spine rather than collapsing forward.',
    steps: [
      'Sit tall with both feet grounded and hips squared to the front of the chair.',
      'Reach one arm overhead and lean gently to the opposite side, lengthening through the ribs.',
      'Hold about 15 seconds, switch sides, and complete 4 rounds total (2 per side).',
    ],
  },
]
