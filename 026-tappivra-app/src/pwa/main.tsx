import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../viewer/viewer.css';
import './pwa.css';
import { ViewerApp } from './ViewerApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ViewerApp />
  </StrictMode>,
);
