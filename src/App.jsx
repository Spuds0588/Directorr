import { HashRouter, Routes, Route } from 'react-router-dom';
import Nav from './components/Nav.jsx';
import Home from './pages/Home.jsx';
import Create from './pages/Create.jsx';
import Record from './pages/Record.jsx';

// HashRouter is used deliberately: GitHub Pages serves static files only, so
// hash routes avoid needing a 404.html rewrite shim. This keeps the deploy to
// a single static layer (no server, no CDN function).
export default function App() {
  return (
    <HashRouter>
      <Nav />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<Create />} />
          <Route path="/record/:id" element={<Record />} />
          <Route
            path="*"
            element={
              <section className="card">
                <h2>Not found</h2>
                <p>That route does not exist.</p>
              </section>
            }
          />
        </Routes>
      </main>
    </HashRouter>
  );
}
