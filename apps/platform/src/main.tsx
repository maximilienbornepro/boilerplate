import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SidebarLoadersProvider } from '@boilerplate/shared/components';
import App from './App';
import { sidebarLoaders } from './shell/sidebarLoaders';
import '@boilerplate/shared/styles/theme.css';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SidebarLoadersProvider loaders={sidebarLoaders}>
        <App />
      </SidebarLoadersProvider>
    </BrowserRouter>
  </StrictMode>,
);
