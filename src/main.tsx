import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DebugCanvas } from './ui/DebugCanvas';
import './ui/debug.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DebugCanvas />
  </StrictMode>,
);
