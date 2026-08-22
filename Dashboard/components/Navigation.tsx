import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Activity, Clock, Fuel, Navigation as NavIcon, AlertCircle, Wrench } from 'lucide-react';

export default function Navigation() {
  const router = useRouter();

  const navItems = [
    { name: 'Live Telemetry', href: '/', icon: Activity },
    { name: 'Trips', href: '/trips', icon: NavIcon },
    { name: 'Fuel Economy', href: '/fuel', icon: Fuel },
    { name: 'Performance', href: '/performance', icon: Clock },
    { name: 'Diagnostics', href: '/diagnostics', icon: AlertCircle },
    { name: 'Maintenance', href: '/maintenance', icon: Wrench },
  ];

  return (
    <nav className="glass-panel-static app-sidebar">
      <div className="brand-block">
        <h2>
          Axia OS
        </h2>
        <p>Vehicle telemetry system</p>
      </div>

      <div className="nav-items-container">
        {navItems.map((item) => {
          const isActive = router.pathname === item.href;
          const Icon = item.icon;
          
          return (
            <Link key={item.name} href={item.href} className={`nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={18} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
