import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/atkinson-hyperlegible-mono';
import './index.css';
import App from './App';
import { ToastProvider } from './components/Toast';
import { installFieldTooltips } from './fieldTooltips';
import { migrateStoredSettings } from './storageMigration';

migrateStoredSettings();
installFieldTooltips();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
