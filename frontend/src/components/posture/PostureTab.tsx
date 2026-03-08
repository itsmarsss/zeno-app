import { PostureFrame } from '../common/PostureFrame'
import type { PostureLandmarks } from '../../shared/types'

export function PostureTab({
  postureStreamState,
  postureScoreLive,
  postureFrame,
  postureLandmarks,
  postureStreamError,
}: {
  postureStreamState: 'stopped' | 'connecting' | 'running' | 'no-pose' | 'error'
  postureScoreLive: number | null
  postureFrame: string | null
  postureLandmarks: PostureLandmarks
  postureStreamError: string | null
}) {
  return (
    <>
      <h1>Posture</h1>
      <div className="main-panel">
        <div className="main-panel-head">
          <h3>Live posture stream</h3>
          <span>
            {postureStreamState === 'connecting' && 'Connecting...'}
            {postureStreamState === 'running' && `Tracking • score ${Math.round((postureScoreLive ?? 0) * 100)}`}
            {postureStreamState === 'no-pose' && 'No pose'}
            {postureStreamState === 'stopped' && 'Stopped'}
            {postureStreamState === 'error' && 'Error'}
          </span>
        </div>
        <PostureFrame frame={postureFrame} landmarks={postureLandmarks} alt="Posture stream" className="posture-preview" />
        {postureStreamError ? <p className="main-empty">{postureStreamError}</p> : <p className="main-empty">Backend Python stream with MediaPipe landmarks (on-device).</p>}
      </div>
    </>
  )
}
