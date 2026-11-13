import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { supabase } from '../lib/supabase.js';
import { initials } from '../lib/format.js';
import { OfflineIndicator, PWAInstallButton } from './PWABanner.jsx';

export function Topbar({ title, sub, children }) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{title}</h1>
        {sub && <span className="muted small">{sub}</span>}
      </div>
      {children && <div className="row-wrap">{children}</div>}
    </header>
  );
}

export default function Layout() {
  const { profile, isStaff, isTA, signOut } = useAuth();
  const isLecturer = isStaff;
  const [open, setOpen] = useState(false);
  const [courses, setCourses] = useState([]);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

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
          <span className="brand-mark" style={{
            background: 'linear-gradient(135deg, #0d9488, #0f766e)',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            letterSpacing: '0.05em'
          }}>
            PS
          </span>
          <span>
            <div className="brand-name" style={{ letterSpacing: '-0.01em', fontWeight: 700 }}>PSCM E-class</div>
            <div className="brand-sub" style={{ fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {isTA ? 'Teaching Assistant' : isLecturer ? 'Executive Faculty' : 'Student Portal'}
            </div>
          </span>
        </Link>

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
            <span className="nav-course-dot" style={{ background: c.color, boxShadow: '0 0 6px rgba(0,0,0,0.2)' }} />
            <span className="nav-course-code">{c.code}</span>
          </NavLink>
        ))}
        {!courses.length && <div className="tiny" style={{ color: '#8794a0', padding: '4px 12px' }}>No courses yet</div>}

        <NavLink to="/account" className="nav-link" style={{ marginTop: 16 }}>
          <Icon name="settings" /> Account Settings
        </NavLink>
        <div style={{ padding: '4px 4px 0' }}>
          <PWAInstallButton dark />
        </div>

        <div className="sidebar-foot" style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 10px 10px 8px' }}>
          <div className="avatar" style={{ border: '1px solid rgba(255,255,255,0.15)', background: 'var(--ink-2)' }}>
            {initials(profile?.full_name)}
          </div>
          <div className="who">
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{profile?.full_name}</div>
            <div className="mono tiny" style={{ color: '#94a3b8' }}>
              {profile?.index_no || (isTA ? 'TA' : 'Faculty')}
            </div>
          </div>
          <button type="button" className="icon-btn-dark" onClick={signOut} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </nav>

      <div className="main">
        <div className="mobile-bar">
          <button type="button" className="icon-btn-dark" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <span className="brand-mark" style={{ width: 30, height: 30, fontSize: 12 }}>PS</span>
          <strong style={{ letterSpacing: '-0.01em', flex: 1 }}>PSCM E-class</strong>
          <PWAInstallButton compact dark />
        </div>
        <Outlet />
      </div>
      <OfflineIndicator />
    </div>
  );
}
