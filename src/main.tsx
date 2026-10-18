import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DebugCanvas } from './ui/DebugCanvas';
import { ChainCanvas } from './ui/ChainCanvas';
import './ui/debug.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).get('harness') === 'falling' ? <DebugCanvas /> : <ChainCanvas />}
  </StrictMode>,
);
