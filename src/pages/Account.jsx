import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.js';
import { DEFAULT_BRANDING, resizeCrestFile, useBranding } from '../lib/branding.js';
import { rpc, supabase, friendlyError } from '../lib/supabase.js';
import PrivacyNoticeModal from '../components/PrivacyNoticeModal.jsx';
import Icon, { BrandMark } from '../components/Icon.jsx';
import { Topbar } from '../components/Layout.jsx';
import { Field, useToast } from '../components/ui.jsx';

export default function Account() {
  const { profile, isStaff: isLecturer, isTA, session, signOut } = useAuth();
  const [theme, setTheme] = useTheme();
  const [brand, saveBrand, resetBrand] = useBranding();
  const toast = useToast();
  const crestInput = useRef(null);

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [bannerMsg, setBannerMsg] = useState('');
  const [bannerKind, setBannerKind] = useState('info');
  const [bannerBusy, setBannerBusy] = useState(false);
  useEffect(() => {
    if (isLecturer && !isTA) {
      supabase.rpc('get_app_banner').then(({ data }) => {
        if (data?.message) { setBannerMsg(data.message); setBannerKind(data.kind || 'info'); }
      }, () => {});
    }
  }, [isLecturer, isTA]);
  async function saveBanner(clear = false) {
    setBannerBusy(true);
    try {
      const msg = clear ? '' : bannerMsg.trim();
      await rpc('set_app_banner', { p_message: msg, p_kind: bannerKind });
      if (clear) setBannerMsg('');
      toast(clear ? 'Portal status banner cleared.' : 'Portal status banner updated.');
    } catch (err) {
      toast(err.message || 'Could not update status banner.', 'error');
    } finally {
      setBannerBusy(false);
    }
  }

  const [bForm, setBForm] = useState({
    portalName: brand.portalName,
    department: brand.department,
    coordinator: brand.coordinator,
    logoDataUrl: brand.logoDataUrl,
  });

  async function change(e) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) return setError('Use at least 8 characters.');
    if (pw !== pw2) return setError('The two passwords do not match.');
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    setPw('');
    setPw2('');
    toast('Password changed.');
  }

  async function onCrestPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeCrestFile(file);
      const next = { ...bForm, logoDataUrl: dataUrl };
      setBForm(next);
      saveBrand(next);
      toast('Department crest updated.');
    } catch (err) {
      toast(err.message || 'Could not load image.', 'error');
    }
  }

  function applyBrandText(e) {
    e.preventDefault();
    const saved = saveBrand(bForm);
    setBForm(saved);
    toast('Portal branding updated on this device.');
  }

  function handleResetBrand() {
    const def = resetBrand();
    setBForm(def);
    toast('Reset to default PSCM crest.');
  }

  return (
    <>
      <Topbar title="Account" />
      <div className="page page-narrow stack-lg">
        <section className="card stack">
          <h2>Your details</h2>
          <div className="grid-2">
            <div className="stack-sm">
              <span className="eyebrow">Name</span>
              <span className="strong">{profile.full_name}</span>
            </div>
            <div className="stack-sm">
              <span className="eyebrow">{isLecturer ? 'Email' : 'Index number'}</span>
              <span className="mono">{isLecturer ? session.user.email : profile.index_no}</span>
            </div>
          </div>
          {!isLecturer && (
            <p className="small muted">If your name is spelt wrongly, ask your lecturer to correct it on the class list.</p>
          )}
        </section>

        <section className="card stack">
          <div className="between" style={{ flexWrap: 'wrap' }}>
            <div>
              <h2>Appearance</h2>
              <p className="small muted" style={{ marginTop: 4 }}>
                Switch between bright daylight mode and night study mode for comfortable reading.
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className={`btn btn-sm ${theme === 'light' ? 'btn-primary' : ''}`}
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
              >
                <Icon name="sun" size={15} /> Light
              </button>
              <button
                type="button"
                className={`btn btn-sm ${theme === 'dark' ? 'btn-primary' : ''}`}
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
              >
                <Icon name="moon" size={15} /> Night Study
              </button>
            </div>
          </div>
        </section>

        {isLecturer && !isTA && (
          <form className="card stack" onSubmit={applyBrandText}>
            <div className="between" style={{ flexWrap: 'wrap' }}>
              <div>
                <h2>Institutional crest &amp; branding</h2>
                <p className="small muted" style={{ marginTop: 4 }}>
                  Upload your university or department crest for the sidebar, header, and printed PDF reports.
                </p>
              </div>
              <BrandMark size={44} />
            </div>

            <div className="row-wrap" style={{ gap: 10 }}>
              <input
                ref={crestInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                style={{ display: 'none' }}
                onChange={onCrestPick}
              />
              <button type="button" className="btn btn-sm" onClick={() => crestInput.current?.click()}>
                <Icon name="upload" size={15} /> Upload crest image
              </button>
              {(bForm.logoDataUrl || bForm.portalName !== DEFAULT_BRANDING.portalName || bForm.department !== DEFAULT_BRANDING.department) && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={handleResetBrand}>
                  Reset to default
                </button>
              )}
            </div>

            <div className="grid-2">
              <Field label="Portal name">
                <input
                  className="input"
                  value={bForm.portalName}
                  onChange={(e) => setBForm({ ...bForm, portalName: e.target.value })}
                  placeholder={DEFAULT_BRANDING.portalName}
                />
              </Field>
              <Field label="Coordinator / subtitle">
                <input
                  className="input"
                  value={bForm.coordinator}
                  onChange={(e) => setBForm({ ...bForm, coordinator: e.target.value })}
                  placeholder={DEFAULT_BRANDING.coordinator}
                />
              </Field>
            </div>
            <Field label="Department / Institution">
              <input
                className="input"
                value={bForm.department}
                onChange={(e) => setBForm({ ...bForm, department: e.target.value })}
                placeholder={DEFAULT_BRANDING.department}
              />
            </Field>
            <div>
              <button type="submit" className="btn btn-primary btn-sm">Save branding</button>
            </div>
          </form>
        )}

        {isLecturer && !isTA && (
          <section className="card stack">
            <div>
              <h2>Portal status / maintenance banner</h2>
              <p className="small muted" style={{ marginTop: 4 }}>
                Show a temporary notice across the top of the portal for all staff and students (e.g. scheduled maintenance or exam-day alert).
              </p>
            </div>
            <div className="grid-2">
              <Field label="Banner message">
                <input className="input" value={bannerMsg} onChange={(e) => setBannerMsg(e.target.value)} placeholder="Leave empty to hide banner" />
              </Field>
              <Field label="Tone">
                <select className="select" value={bannerKind} onChange={(e) => setBannerKind(e.target.value)}>
                  <option value="info">Info (blue)</option>
                  <option value="warn">Notice / Maintenance (amber)</option>
                  <option value="error">Urgent Alert (red)</option>
                </select>
              </Field>
            </div>
            <div className="row-wrap" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" disabled={bannerBusy} onClick={() => saveBanner(false)}>
                Save banner
              </button>
              {bannerMsg && (
                <button type="button" className="btn btn-sm" disabled={bannerBusy} onClick={() => saveBanner(true)}>
                  Clear banner
                </button>
              )}
            </div>
          </section>
        )}
        <form className="card stack" onSubmit={change}>
          <h2>Change password</h2>
          {error && <div className="notice notice-error">{error}</div>}
          <div className="grid-2">
            <Field label="New password">
              <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Type it again">
              <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>

        <div className="row-wrap between">
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setPrivacyOpen(true)}>
            <Icon name="shield" size={16} /> Privacy &amp; Academic Integrity Notice
          </button>
        </div>
        {privacyOpen && <PrivacyNoticeModal onClose={() => setPrivacyOpen(false)} />}
      </div>
    </>
  );
}
