import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Activity,
  LayoutDashboard,
  Route,
  Fuel,
  Wrench,
  AlertCircle,
  Clock,
  Car,
  Radio,
  Shield,
  ChevronDown,
  Check,
  Plus,
  Menu,
  X,
  LogOut
} from 'lucide-react';
import { useVehicle } from '../context/VehicleContext';
import { useAuth } from '../context/AuthContext';

export default function Navigation() {
  const router = useRouter();
  const { vehicles, activeVehicleId, selectVehicle } = useVehicle();
  const { profile, logout } = useAuth();
  const mustChangePassword = !!profile?.mustChangePassword;

  const [vehicleMenuOpen, setVehicleMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const vehicleMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const vehicleBtnRef = useRef<HTMLButtonElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const mobileBtnRef = useRef<HTMLButtonElement>(null);

  // Close menus on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (vehicleMenuRef.current && !vehicleMenuRef.current.contains(event.target as Node)) {
        setVehicleMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menus on Escape key and return focus to appropriate toggle
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (vehicleMenuOpen) {
          event.stopPropagation();
          setVehicleMenuOpen(false);
          vehicleBtnRef.current?.focus();
        }
        if (moreMenuOpen) {
          event.stopPropagation();
          setMoreMenuOpen(false);
          moreBtnRef.current?.focus();
        }
        if (mobileMenuOpen) {
          event.stopPropagation();
          setMobileMenuOpen(false);
          mobileBtnRef.current?.focus();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [vehicleMenuOpen, moreMenuOpen, mobileMenuOpen]);

  // Close menus when route changes
  useEffect(() => {
    setVehicleMenuOpen(false);
    setMoreMenuOpen(false);
    setMobileMenuOpen(false);
  }, [router.asPath]);

  const handleDropdownKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    closeMenu: () => void,
    triggerRef: React.RefObject<HTMLButtonElement | null>
  ) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      closeMenu();
      triggerRef.current?.focus();
      return;
    }

    const container = e.currentTarget;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>('button, a'));
    if (focusables.length === 0) return;
    const currentIndex = focusables.indexOf(document.activeElement as HTMLElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex < focusables.length - 1 ? currentIndex + 1 : 0;
      focusables[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : focusables.length - 1;
      focusables[prevIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusables[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      focusables[focusables.length - 1]?.focus();
    }
  };

  const handleSelectVehicle = (id: string) => {
    selectVehicle(id);
    setVehicleMenuOpen(false);
    setTimeout(() => {
      vehicleBtnRef.current?.focus();
    }, 0);
  };

  const activeVehicleName = activeVehicleId === 'all'
    ? 'All Vehicles'
    : vehicles.find(v => v.id === activeVehicleId)?.name || (vehicles.length > 0 ? vehicles[0].name : 'Unknown Vehicle');

  const isCurrentPage = (path: string) => {
    if (path === '/') return router.pathname === '/';
    return router.pathname === path || router.pathname.startsWith(`${path}/`);
  };

  const isMoreActive = ['/fuel', '/maintenance', '/diagnostics', '/performance', '/garage', '/pair', '/account'].some(p => isCurrentPage(p));

  return (
    <header className="app-header" role="banner">
      <div className="header-inner">
        {/* Left: Brand & Vehicle Selector */}
        <div className="header-brand-section">
          <Link href="/" className="header-brand" aria-label="OBD Telemetry home">
            <span className="brand-icon-wrapper" aria-hidden="true">
              <Activity size={18} />
            </span>
            <span className="brand-name">OBD Telemetry</span>
          </Link>

          {/* Vehicle Switcher */}
          <div className="vehicle-picker" ref={vehicleMenuRef}>
            <button
              ref={vehicleBtnRef}
              type="button"
              className="vehicle-picker-btn"
              onClick={() => setVehicleMenuOpen(prev => !prev)}
              aria-expanded={vehicleMenuOpen}
              aria-controls="vehicle-picker-dropdown"
              aria-label={`Current vehicle: ${activeVehicleName}. Click to switch vehicle.`}
            >
              <Car size={15} className="vehicle-picker-icon" aria-hidden="true" />
              <span className="vehicle-picker-name">{activeVehicleName}</span>
              <ChevronDown
                size={14}
                className="vehicle-picker-chevron"
                style={{ transform: vehicleMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                aria-hidden="true"
              />
            </button>

            {vehicleMenuOpen && (
              <div
                id="vehicle-picker-dropdown"
                className="vehicle-dropdown-menu"
                aria-label="Select vehicle"
                onKeyDown={e => handleDropdownKeyDown(e, () => setVehicleMenuOpen(false), vehicleBtnRef)}
              >
                <button
                  type="button"
                  className={`vehicle-menu-item ${activeVehicleId === 'all' ? 'active' : ''}`}
                  onClick={() => handleSelectVehicle('all')}
                >
                  <span className="vehicle-menu-item-name">All Vehicles (Summary)</span>
                  {activeVehicleId === 'all' && <Check size={14} className="check-icon" aria-hidden="true" />}
                </button>

                <div className="dropdown-divider" />

                {vehicles.map((v) => {
                  const isSelected = activeVehicleId === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      className={`vehicle-menu-item ${isSelected ? 'active' : ''}`}
                      onClick={() => handleSelectVehicle(v.id)}
                    >
                      <div className="vehicle-menu-item-info">
                        <span className="vehicle-menu-item-name">{v.name}</span>
                        <span className="vehicle-menu-item-sub">
                          {v.tankLitres ? `${v.tankLitres}L Tank` : 'Standard Tank'}
                        </span>
                      </div>
                      {isSelected && <Check size={14} className="check-icon" aria-hidden="true" />}
                    </button>
                  );
                })}

                <div className="dropdown-divider" />

                <Link
                  href="/garage"
                  className="vehicle-menu-manage-link"
                  onClick={() => setVehicleMenuOpen(false)}
                >
                  <Plus size={13} aria-hidden="true" />
                  <span>Manage Garage / Add Vehicle</span>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Center / Right: Desktop Horizontal Nav */}
        <nav className="desktop-nav" aria-label="Main navigation">
          <Link
            href="/"
            className={`nav-link ${isCurrentPage('/') ? 'active' : ''}`}
            aria-current={isCurrentPage('/') ? 'page' : undefined}
          >
            <Activity size={15} aria-hidden="true" />
            <span>Readings</span>
          </Link>

          <Link
            href="/overview"
            className={`nav-link ${isCurrentPage('/overview') ? 'active' : ''}`}
            aria-current={isCurrentPage('/overview') ? 'page' : undefined}
          >
            <LayoutDashboard size={15} aria-hidden="true" />
            <span>Overview</span>
          </Link>

          <Link
            href="/trips"
            className={`nav-link ${isCurrentPage('/trips') ? 'active' : ''}`}
            aria-current={isCurrentPage('/trips') ? 'page' : undefined}
          >
            <Route size={15} aria-hidden="true" />
            <span>Trips</span>
          </Link>

          {/* More menu for grouped secondary destinations */}
          <div className="more-menu-container" ref={moreMenuRef}>
            <button
              ref={moreBtnRef}
              type="button"
              className={`nav-link more-btn ${isMoreActive ? 'active' : ''}`}
              onClick={() => setMoreMenuOpen(prev => !prev)}
              aria-expanded={moreMenuOpen}
              aria-controls="more-nav-dropdown"
              aria-label="More navigation options"
            >
              <span>More</span>
              <ChevronDown
                size={13}
                style={{ transform: moreMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                aria-hidden="true"
              />
            </button>

            {moreMenuOpen && (
              <div
                id="more-nav-dropdown"
                className="more-dropdown-menu"
                aria-label="Vehicle & management options"
                onKeyDown={e => handleDropdownKeyDown(e, () => setMoreMenuOpen(false), moreBtnRef)}
              >
                <div className="dropdown-section-title">Vehicle Care</div>
                <Link
                  href="/fuel"
                  className={`more-dropdown-item ${isCurrentPage('/fuel') ? 'active' : ''}`}
                  onClick={() => setMoreMenuOpen(false)}
                >
                  <Fuel size={15} aria-hidden="true" />
                  <span>Fuel & Economy</span>
                </Link>
                <Link
                  href="/maintenance"
                  className={`more-dropdown-item ${isCurrentPage('/maintenance') ? 'active' : ''}`}
                  onClick={() => setMoreMenuOpen(false)}
                >
                  <Wrench size={15} aria-hidden="true" />
                  <span>Maintenance</span>
                </Link>
                <Link
                  href="/diagnostics"
                  className={`more-dropdown-item ${isCurrentPage('/diagnostics') ? 'active' : ''}`}
                  onClick={() => setMoreMenuOpen(false)}
                >
                  <AlertCircle size={15} aria-hidden="true" />
                  <span>Diagnostics & Codes</span>
                </Link>
                <Link
                  href="/performance"
                  className={`more-dropdown-item ${isCurrentPage('/performance') ? 'active' : ''}`}
                  onClick={() => setMoreMenuOpen(false)}
                >
                  <Clock size={15} aria-hidden="true" />
                  <span>Performance</span>
                </Link>

                <div className="dropdown-divider" />
                <div className="dropdown-section-title">Manage</div>

                <Link
                  href="/garage"
                  className={`more-dropdown-item ${isCurrentPage('/garage') ? 'active' : ''}`}
                  onClick={() => setMoreMenuOpen(false)}
                >
                  <Car size={15} aria-hidden="true" />
                  <span>Garage & Fleet</span>
                </Link>
                <Link
                  href="/pair"
                  className={`more-dropdown-item ${isCurrentPage('/pair') ? 'active' : ''}`}
                  onClick={() => setMoreMenuOpen(false)}
                >
                  <Radio size={15} aria-hidden="true" />
                  <span>Pair Car (QR/PIN)</span>
                </Link>
                <Link
                  href="/account"
                  className={`more-dropdown-item ${isCurrentPage('/account') ? 'active' : ''}`}
                  onClick={() => setMoreMenuOpen(false)}
                >
                  <Shield size={15} aria-hidden="true" />
                  <span>Account & Security</span>
                </Link>

                <div className="dropdown-divider" />

                <button
                  type="button"
                  className="more-dropdown-item logout-btn"
                  onClick={() => { setMoreMenuOpen(false); logout(); }}
                >
                  <LogOut size={15} aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </div>
            )}
          </div>

          {mustChangePassword && (
            <Link href="/account" className="password-alert-pill" title="Default password active - change now">
              <AlertCircle size={13} aria-hidden="true" />
              <span>Change Password</span>
            </Link>
          )}
        </nav>

        {/* Mobile Menu Toggle Button */}
        <div className="mobile-header-actions">
          {mustChangePassword && (
            <Link href="/account" className="password-alert-pill-compact" aria-label="Password change required">
              <AlertCircle size={14} aria-hidden="true" />
            </Link>
          )}
          <button
            ref={mobileBtnRef}
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(prev => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            {mobileMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Accessible Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <nav className="mobile-nav-drawer" aria-label="Mobile navigation">
          <div className="mobile-nav-group">
            <div className="mobile-nav-caption">Primary</div>
            <Link
              href="/"
              className={`mobile-nav-link ${isCurrentPage('/') ? 'active' : ''}`}
              aria-current={isCurrentPage('/') ? 'page' : undefined}
            >
              <Activity size={17} aria-hidden="true" />
              <span>Readings</span>
            </Link>
            <Link
              href="/overview"
              className={`mobile-nav-link ${isCurrentPage('/overview') ? 'active' : ''}`}
              aria-current={isCurrentPage('/overview') ? 'page' : undefined}
            >
              <LayoutDashboard size={17} aria-hidden="true" />
              <span>Overview</span>
            </Link>
            <Link
              href="/trips"
              className={`mobile-nav-link ${isCurrentPage('/trips') ? 'active' : ''}`}
              aria-current={isCurrentPage('/trips') ? 'page' : undefined}
            >
              <Route size={17} aria-hidden="true" />
              <span>Trips</span>
            </Link>
          </div>

          <div className="mobile-nav-group">
            <div className="mobile-nav-caption">Vehicle</div>
            <Link
              href="/fuel"
              className={`mobile-nav-link ${isCurrentPage('/fuel') ? 'active' : ''}`}
              aria-current={isCurrentPage('/fuel') ? 'page' : undefined}
            >
              <Fuel size={17} aria-hidden="true" />
              <span>Fuel Economy</span>
            </Link>
            <Link
              href="/maintenance"
              className={`mobile-nav-link ${isCurrentPage('/maintenance') ? 'active' : ''}`}
              aria-current={isCurrentPage('/maintenance') ? 'page' : undefined}
            >
              <Wrench size={17} aria-hidden="true" />
              <span>Maintenance</span>
            </Link>
            <Link
              href="/diagnostics"
              className={`mobile-nav-link ${isCurrentPage('/diagnostics') ? 'active' : ''}`}
              aria-current={isCurrentPage('/diagnostics') ? 'page' : undefined}
            >
              <AlertCircle size={17} aria-hidden="true" />
              <span>Diagnostics</span>
            </Link>
            <Link
              href="/performance"
              className={`mobile-nav-link ${isCurrentPage('/performance') ? 'active' : ''}`}
              aria-current={isCurrentPage('/performance') ? 'page' : undefined}
            >
              <Clock size={17} aria-hidden="true" />
              <span>Performance</span>
            </Link>
          </div>

          <div className="mobile-nav-group">
            <div className="mobile-nav-caption">Manage</div>
            <Link
              href="/garage"
              className={`mobile-nav-link ${isCurrentPage('/garage') ? 'active' : ''}`}
              aria-current={isCurrentPage('/garage') ? 'page' : undefined}
            >
              <Car size={17} aria-hidden="true" />
              <span>Garage & Fleet</span>
            </Link>
            <Link
              href="/pair"
              className={`mobile-nav-link ${isCurrentPage('/pair') ? 'active' : ''}`}
              aria-current={isCurrentPage('/pair') ? 'page' : undefined}
            >
              <Radio size={17} aria-hidden="true" />
              <span>Pair Car (QR/PIN)</span>
            </Link>
            <Link
              href="/account"
              className={`mobile-nav-link ${isCurrentPage('/account') ? 'active' : ''}`}
              aria-current={isCurrentPage('/account') ? 'page' : undefined}
            >
              <Shield size={17} aria-hidden="true" />
              <span>Account & Security</span>
            </Link>
          </div>

          <div className="mobile-nav-footer">
            <button
              type="button"
              className="mobile-nav-logout-btn"
              onClick={() => logout()}
            >
              <LogOut size={16} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
