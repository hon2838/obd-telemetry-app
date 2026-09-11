import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Activity, Clock, Fuel, Navigation as NavIcon, AlertCircle, Wrench, Car, ChevronDown, Check, Plus, Shield, Radio } from 'lucide-react';
import { useVehicle } from '../context/VehicleContext';
import { useAuth } from '../context/AuthContext';

export default function Navigation() {
  const router = useRouter();
  const { vehicles, activeVehicleId, selectVehicle } = useVehicle();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { profile, logout } = useAuth();
  const mustChangePassword = !!profile?.mustChangePassword;
  const dropdownRef = useRef<HTMLDivElement>(null);

  const navItems = [
    { name: 'Live Telemetry', href: '/', icon: Activity },
    { name: 'Trips', href: '/trips', icon: NavIcon },
    { name: 'Fuel Economy', href: '/fuel', icon: Fuel },
    { name: 'Performance', href: '/performance', icon: Clock },
    { name: 'Diagnostics', href: '/diagnostics', icon: AlertCircle },
    { name: 'Maintenance', href: '/maintenance', icon: Wrench },
    { name: 'Garage & Fleet', href: '/garage', icon: Car },
    { name: 'Pair Car (QR/PIN)', href: '/pair', icon: Radio },
    { name: 'Account & Security', href: '/account', icon: Shield },
  ];

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeVehicleName = activeVehicleId === 'all'
    ? 'All Vehicles'
    : vehicles.find(v => v.id === activeVehicleId)?.name || 'Unknown Vehicle';

  return (
    <nav className="glass-panel-static app-sidebar">
      <div className="brand-block">
        <h2>
          OBD Telemetry
        </h2>
        <p>Vehicle telemetry & fleet hub</p>
      </div>

      {mustChangePassword && (
        <div style={{
          margin: '0 0.5rem 0.75rem 0.5rem',
          padding: '0.65rem 0.75rem',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(255, 149, 0, 0.15)',
          border: '1px solid rgba(255, 149, 0, 0.4)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#FFA500', fontSize: '0.8rem', fontWeight: 600 }}>
            <AlertCircle size={14} />
            <span>Default Password Active</span>
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
            Your account requires changing the temporary password.
          </span>
          <Link
            href="/account"
            style={{
              marginTop: '0.2rem',
              display: 'inline-block',
              textAlign: 'center',
              padding: '0.35rem 0.5rem',
              background: '#FFA500',
              color: '#000',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.725rem',
              fontWeight: 700,
              textDecoration: 'none'
            }}
          >
            Change Password Now →
          </Link>
        </div>
      )}

      {/* Vehicle Switcher Pill */}
      <div className="vehicle-switcher-container" ref={dropdownRef} style={{ position: 'relative', padding: '0 0.5rem 1rem 0.5rem' }}>
        <button
          type="button"
          className="glass-panel"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.65rem 0.85rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-inset)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
            transition: 'all 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
            <Car size={16} color="var(--accent-cyan)" />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {activeVehicleName}
            </span>
          </div>
          <ChevronDown size={14} style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>

        {dropdownOpen && (
          <div
            className="glass-panel"
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: '0.5rem',
              right: '0.5rem',
              zIndex: 100,
              background: 'rgba(18, 24, 32, 0.96)',
              backdropFilter: 'blur(16px)',
              border: '1px solid var(--border-glow)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
              overflow: 'hidden',
              padding: '0.35rem',
            }}
          >
            <div
              onClick={() => { selectVehicle('all'); setDropdownOpen(false); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontSize: '0.825rem',
                color: activeVehicleId === 'all' ? 'var(--accent-cyan)' : 'var(--text-primary)',
                background: activeVehicleId === 'all' ? 'rgba(94, 215, 208, 0.12)' : 'transparent',
              }}
            >
              <span>🌐 All Vehicles (Combined)</span>
              {activeVehicleId === 'all' && <Check size={14} color="var(--accent-cyan)" />}
            </div>

            <div style={{ height: '1px', background: 'var(--border)', margin: '0.25rem 0' }} />

            {vehicles.map((v) => {
              const isSelected = activeVehicleId === v.id;
              return (
                <div
                  key={v.id}
                  onClick={() => { selectVehicle(v.id); setDropdownOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: '0.825rem',
                    color: isSelected ? 'var(--accent-cyan)' : 'var(--text-primary)',
                    background: isSelected ? 'rgba(94, 215, 208, 0.12)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: isSelected ? 600 : 400 }}>{v.name}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {v.tankLitres ? `${v.tankLitres}L Tank` : 'Standard Tank'}
                    </span>
                  </div>
                  {isSelected && <Check size={14} color="var(--accent-cyan)" />}
                </div>
              );
            })}

            <div style={{ height: '1px', background: 'var(--border)', margin: '0.25rem 0' }} />

            <Link
              href="/garage"
              onClick={() => setDropdownOpen(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.775rem',
                color: 'var(--accent-khaki)',
                textDecoration: 'none',
              }}
            >
              <Plus size={13} />
              <span>Manage Garage / Add Vehicle</span>
            </Link>
          </div>
        )}
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
        <button type="button" className="nav-item nav-logout" onClick={() => logout()}>
          <Shield size={18} />
          <span>Sign out</span>
        </button>
      </div>
    </nav>
  );
}
