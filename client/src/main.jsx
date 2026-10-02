import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { DialogProvider } from './components/ui.jsx';
import { useLang } from './i18n/index.js';
import './styles.css';

// Re-mounts the app when the language changes so every text is re-rendered
function Root() {
  const lang = useLang();
  return (
    <BrowserRouter>
      <DialogProvider key={lang}>
        <App />
      </DialogProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
