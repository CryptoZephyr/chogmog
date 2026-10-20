import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DebugCanvas } from './ui/DebugCanvas';
import { ChainCanvas } from './ui/ChainCanvas';
import { MachineComposer } from './ui/MachineComposer';
import { DiscoveryPageView } from './ui/WorkDiscovery';
import './ui/debug.css';
import './ui/theme.css';

const harness = new URLSearchParams(location.search).get('harness');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {harness === 'gallery' || harness === 'library' ? <DiscoveryPageView initialKind={harness === 'library' ? 'part' : 'machine'} /> : harness === 'falling' ? <DebugCanvas /> : harness === 'machine' || harness === 'published' ? <MachineComposer publishedMode={harness === 'published'} /> : <ChainCanvas />}
  </StrictMode>,
);
