import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// The mouse wheel never changes a number box's value (the page scrolls instead)
document.addEventListener('wheel', (e) => {
  if (e.target === document.activeElement && e.target.type === 'number') e.target.blur();
}, { passive: true });

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
