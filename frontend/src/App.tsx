import './App.css'

function App() {
  return (
    <main className="panel">
      <header className="panel__header">
        <h1>Zeno</h1>
        <span className="status">Idle</span>
      </header>
      <section className="panel__section">
        <p>Menubar app is running.</p>
        <p className="muted">Camera checks run locally on this device.</p>
      </section>
      <section className="panel__section">
        <h2>Next</h2>
        <ul>
          <li>Connect Python sidecar process</li>
          <li>Trigger periodic session runs</li>
          <li>Show contextual nudges</li>
        </ul>
      </section>
      <footer className="panel__footer">
        <small>v0.1.0</small>
      </footer>
    </main>
  )
}

export default App
