import type { PostureLandmarks } from '../../shared/types'
import './PostureFrame.css'

export function PostureFrame({
  frame,
  landmarks,
  alt,
  className,
  mirrored = true,
}: {
  frame: string | null
  landmarks: PostureLandmarks
  alt: string
  className?: string
  mirrored?: boolean
}) {
  const mediaClass = mirrored ? 'is-mirrored' : ''
  return (
    <div className={className ?? 'posture-preview'}>
      {frame ? <img src={frame} className={`posture-video ${mediaClass}`.trim()} alt={alt} /> : null}
      {landmarks?.nose && landmarks.left_shoulder && landmarks.right_shoulder ? (
        <svg className={`posture-landmark-svg ${mediaClass}`.trim()} viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            x1={landmarks.left_shoulder.x * 100}
            y1={landmarks.left_shoulder.y * 100}
            x2={landmarks.right_shoulder.x * 100}
            y2={landmarks.right_shoulder.y * 100}
          />
          <line
            x1={landmarks.nose.x * 100}
            y1={landmarks.nose.y * 100}
            x2={(landmarks.left_shoulder.x * 100 + landmarks.right_shoulder.x * 100) / 2}
            y2={(landmarks.left_shoulder.y * 100 + landmarks.right_shoulder.y * 100) / 2}
          />
          <circle cx={landmarks.nose.x * 100} cy={landmarks.nose.y * 100} r="1.4" />
          <circle cx={landmarks.left_shoulder.x * 100} cy={landmarks.left_shoulder.y * 100} r="1.4" />
          <circle cx={landmarks.right_shoulder.x * 100} cy={landmarks.right_shoulder.y * 100} r="1.4" />
        </svg>
      ) : null}
      <div className="posture-overlay-guide" />
    </div>
  )
}
