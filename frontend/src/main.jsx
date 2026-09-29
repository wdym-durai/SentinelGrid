/**
 * SentinelGrid — React Entry Point
 *
 * This is the first file React loads.
 * It mounts the <App /> component into the <div id="root"> in index.html.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Global styles (Tailwind base styles are injected here)
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
