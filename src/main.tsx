import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DebugCanvas } from './ui/DebugCanvas';
import { ChainCanvas } from './ui/ChainCanvas';
import { MachineComposer } from './ui/MachineComposer';
import './ui/debug.css';

const harness = new URLSearchParams(location.search).get('harness');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {harness === 'falling' ? <DebugCanvas /> : harness === 'machine' || harness === 'published' ? <MachineComposer publishedMode={harness === 'published'} /> : <ChainCanvas />}
  </StrictMode>,
);
