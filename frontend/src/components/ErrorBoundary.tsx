import { Component, type ErrorInfo, type ReactNode } from 'react'
import './ErrorBoundary.css'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui] render failure', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="fatal-ui-fallback">
          <section className="fatal-ui-card">
            <h1>Zeno hit a UI error</h1>
            <p>The app is still running. Reload to recover the window.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}
