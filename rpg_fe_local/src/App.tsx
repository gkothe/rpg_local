import { lazy, Suspense } from 'react';
import { Routes, Route, NavLink, useParams } from 'react-router-dom';
import { BookOpen, Library, Workflow, Settings as SettingsIcon } from 'lucide-react';
import LibraryPage from './pages/Library';
import Setup from './pages/Setup';
import PlayPage from './pages/Play';
import SettingsPage from './pages/Settings';
import Rules from './pages/Rules';
import RuleSystemEditor from './features/rules/RuleSystemEditor';
const Flow = lazy(() => import('./pages/Flow'));
function RuleSystemRoute() {
  const { id } = useParams();
  return <RuleSystemEditor key={id} id={id!} />;
}
function CampaignRoute() {
  const { id } = useParams();
  return <PlayPage key={id} />;
}
export default function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <NavLink className="brand" to="/">
          <svg className="brand-sigil" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path d="M24 3 L42 13.5 V34.5 L24 45 L6 34.5 V13.5 Z" />
            <path d="M24 3 L33 24 L24 45 M24 3 L15 24 L24 45 M6 13.5 L33 24 M42 13.5 L15 24" />
          </svg>
          <span>
            Local RPG<small>Campaign journal</small>
          </span>
        </NavLink>
        <nav aria-label="Main">
          <NavLink to="/" end>
            <Library size={17} />
            Library
          </NavLink>
          <NavLink to="/settings">
            <SettingsIcon size={17} />
            Settings
          </NavLink>
          <NavLink to="/rules">
            <BookOpen size={17} />
            Rules
          </NavLink>
          <NavLink to="/flow">
            <Workflow size={17} />
            Flow
          </NavLink>
        </nav>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/new" element={<Setup />} />
          <Route path="/campaigns/:id" element={<CampaignRoute />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/rules/:id" element={<RuleSystemRoute />} />
          <Route
            path="/flow"
            element={
              <Suspense fallback={<p role="status">Loading architecture guide…</p>}>
                <Flow />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <p>
                Page not found. <NavLink to="/">Return to library</NavLink>
              </p>
            }
          />
        </Routes>
      </main>
    </>
  );
}
