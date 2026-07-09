import React from 'react';
import Navigation from './Navigation';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-container">
      <Navigation />
      <div className="app-main">
        {children}
      </div>
    </div>
  );
}
