import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import Icon, { BrandMark } from './Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.js';
import { useBranding } from '../lib/branding.js';
import { supabase } from '../lib/supabase.js';
import { initials } from '../lib/format.js';
import { OfflineIndicator, PWAInstallButton } from './PWABanner.jsx';
import QuickJumpModal from './QuickJumpModal.jsx';

export function Topbar({ title, sub, children }) {
  const [theme, , toggleTheme] = useTheme();
  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{title}</h1>
        {sub && <span className="muted small">{sub}</span>}
      </div>
      <div className="row-wrap">
        {children}
        <button
          type="button"
          className="icon-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to night study mode'}
          title={theme === 'dark' ? 'Light mode' : 'Night study mode'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
      </div>
    </header>
  );
}

export default function Layout() {
  const { profile, isStaff, isTA, signOut } = useAuth();
  const [theme, , toggleTheme] = useTheme();
  const [brand] = useBranding();
  const isLecturer = isStaff;
  const [open, setOpen] = useState(false);
  const [jump, setJump] = useState(false);
  const [courses, setCourses] = useState([]);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setJump((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase
      .from('courses')
      .select('id, code, title, color, archived')
      .eq('archived', false)
      .order('code')
      .then(({ data }) => alive && setCourses(data || []));
    return () => {
      alive = false;
    };
  }, [location.pathname]);

  const coursePath = (c) => (isLecturer ? `/teach/course/${c.id}` : `/course/${c.id}`);

  return (
    <div className="app">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Main">
        <Link to="/" className="brand">
          <BrandMark size={36} />
          <span>
            <div className="brand-name">{brand.portalName}</div>
            <div className="brand-sub">
              {isTA ? 'Teaching Assistant' : isLecturer ? 'Faculty Portal' : 'Student Portal'}
            </div>
          </span>
        </Link>

        <button
          type="button"
          className="sidebar-search-btn"
          onClick={() => setJump(true)}
          title="Quick search (Ctrl+K)"
        >
          <Icon name="search" size={15} />
          <span style={{ flex: 1, textAlign: 'left' }}>Quick search…</span>
          <span className="sidebar-kbd">⌘K</span>
        </button>

        <NavLink to="/" end className="nav-link">
          <Icon name="home" /> {isLecturer ? 'Faculty Dashboard' : 'Home'}
        </NavLink>
        {!isLecturer && (
          <NavLink to="/grades" className="nav-link">
            <Icon name="chart" /> My Grades
          </NavLink>
        )}

        <div className="nav-section">Courses</div>
        {courses.map((c) => (
          <NavLink key={c.id} to={coursePath(c)} className="nav-link" title={c.title}>
            <span className="nav-course-dot" style={{ background: c.color }} />
            <span className="nav-course-code">{c.code}</span>
          </NavLink>
        ))}
        {!courses.length && <div className="tiny" style={{ color: '#64748b', padding: '4px 12px' }}>No courses yet</div>}

        <NavLink to="/account" className="nav-link" style={{ marginTop: 14 }}>
          <Icon name="settings" /> Account Settings
        </NavLink>

        <div style={{ padding: '6px 4px 0' }}>
          <PWAInstallButton dark />
        </div>

        <div className="sidebar-foot">
          <div className="sidebar-foot-card">
            <div className="avatar">{initials(profile?.full_name)}</div>
            <div className="who">
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{profile?.full_name}</div>
              <div className="mono tiny" style={{ color: '#94a3b8' }}>
                {profile?.index_no || (isTA ? 'TA' : 'Faculty')}
              </div>
            </div>
            <button
              type="button"
              className="icon-btn-dark"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to night study mode'}
              title={theme === 'dark' ? 'Light mode' : 'Night study mode'}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
            <button type="button" className="icon-btn-dark" onClick={signOut} aria-label="Sign out" title="Sign out">
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </nav>

      <div className="main">
        <div className="mobile-bar">
          <button type="button" className="icon-btn-dark" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <BrandMark size={28} />
          <strong style={{ letterSpacing: '-0.02em', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {brand.portalName}
          </strong>
          <button
            type="button"
            className="icon-btn-dark"
            onClick={() => setJump(true)}
            aria-label="Quick search"
          >
            <Icon name="search" size={17} />
          </button>
          <button
            type="button"
            className="icon-btn-dark"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to night study mode'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
          <PWAInstallButton compact dark />
        </div>

        <Outlet />

        <nav className="mobile-bottom-nav" aria-label="Mobile quick navigation">
          <NavLink to="/" end className="mobile-bottom-link">
            <Icon name="home" size={18} />
            <span>{isLecturer ? 'Dashboard' : 'Home'}</span>
          </NavLink>
          {!isLecturer ? (
            <NavLink to="/grades" className="mobile-bottom-link">
              <Icon name="chart" size={18} />
              <span>Grades</span>
            </NavLink>
          ) : (
            <button type="button" className="mobile-bottom-link" onClick={() => setOpen(true)}>
              <Icon name="book" size={18} />
              <span>Courses</span>
            </button>
          )}
          <button type="button" className="mobile-bottom-link" onClick={() => setJump(true)}>
            <Icon name="search" size={18} />
            <span>Search</span>
          </button>
          <NavLink to="/account" className="mobile-bottom-link">
            <Icon name="settings" size={18} />
            <span>Account</span>
          </NavLink>
        </nav>
      </div>

      {jump && <QuickJumpModal courses={courses} isStaff={isStaff} onClose={() => setJump(false)} />}
      <OfflineIndicator />
    </div>
  );
}
