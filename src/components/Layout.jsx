import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { supabase } from '../lib/supabase.js';
import { initials } from '../lib/format.js';

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
          <span className="brand-mark">PS</span>
          <span>
            <div className="brand-name">PSCM E-class</div>
            <div className="brand-sub">{isTA ? 'Teaching assistant' : isLecturer ? 'Lecturer' : 'Student'}</div>
          </span>
        </Link>

        <NavLink to="/" end className="nav-link">
          <Icon name="home" /> {isLecturer ? 'Dashboard' : 'Home'}
        </NavLink>
        {!isLecturer && (
          <NavLink to="/grades" className="nav-link">
            <Icon name="chart" /> My grades
          </NavLink>
        )}

        <div className="nav-section">Courses</div>
        {courses.map((c) => (
          <NavLink key={c.id} to={coursePath(c)} className="nav-link" title={c.title}>
            <span className="nav-course-dot" style={{ background: c.color }} />
            <span className="nav-course-code">{c.code}</span>
          </NavLink>
        ))}
        {!courses.length && <div className="tiny" style={{ color: '#8794a0', padding: '4px 12px' }}>No courses yet</div>}

        <NavLink to="/account" className="nav-link" style={{ marginTop: 16 }}>
          <Icon name="settings" /> Account
        </NavLink>

        <div className="sidebar-foot">
          <div className="avatar">{initials(profile?.full_name)}</div>
          <div className="who">
            <div style={{ fontSize: 14, color: '#fff' }}>{profile?.full_name}</div>
            <div className="mono tiny" style={{ color: '#9faab4' }}>
              {profile?.index_no || (isTA ? 'Teaching assistant' : 'Lecturer')}
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
          <strong>PSCM E-class</strong>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
