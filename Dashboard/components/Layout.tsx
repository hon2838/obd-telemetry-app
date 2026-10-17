import React from 'react';
import Navigation from './Navigation';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-container">
      <Navigation />
      <main className="app-main">
        {children}
      </main>
    </div>
  );
}
