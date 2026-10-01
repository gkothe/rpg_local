import { Routes, Route, NavLink, useParams } from 'react-router-dom';
import { BookOpen, Library, Settings as SettingsIcon } from 'lucide-react';
import LibraryPage from './pages/Library';
import Setup from './pages/Setup';
import PlayPage from './pages/Play';
import SettingsPage from './pages/Settings';
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
          <BookOpen size={25} />
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
        </nav>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/new" element={<Setup />} />
          <Route path="/campaigns/:id" element={<CampaignRoute />} />
          <Route path="/settings" element={<SettingsPage />} />
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
