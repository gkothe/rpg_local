import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import './theme/journal.css';
import { LanAccessProvider } from './features/connections/LanAccessProvider';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanAccessProvider>
        <App />
      </LanAccessProvider>
    </BrowserRouter>
  </React.StrictMode>
);
