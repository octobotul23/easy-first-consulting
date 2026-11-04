import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = document.getElementById('root')!;
// index.html carries a plain-HTML copy of all texts for crawlers; the app replaces it.
root.replaceChildren();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
