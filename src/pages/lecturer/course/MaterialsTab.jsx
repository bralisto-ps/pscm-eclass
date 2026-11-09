import { useState } from 'react';
import { run, supabase, safeFileName } from '../../../lib/supabase.js';
import { openStoredFile, removeFiles, uploadFile, STORAGE_LIMIT_LABEL } from '../../../lib/files.js';
import { fmtBytes, hostOf, relative } from '../../../lib/format.js';
import Icon from '../../../components/Icon.jsx';
import { Confirm, Empty, ErrorNote, Field, KindTag, Loading, Modal, useAction, useLoad } from '../../../components/ui.jsx';

const MAX_MB = 25;

function kindFromName(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (/\.(ppt|pptx|key|odp)$/.test(n)) return 'slides';
  if (/\.(doc|docx|odt|rtf|txt|xls|xlsx|csv)$/.test(n)) return 'doc';
  if (/\.(mp4|mov|webm|m4v)$/.test(n)) return 'video';
  return 'file';
}
function kindFromUrl(url) {
  if (/youtube\.com|youtu\.be|vimeo\.com/i.test(url)) return 'video';
  if (/docs\.google\.com\/presentation/i.test(url)) return 'slides';
  if (/\.pdf($|\?)/i.test(url)) return 'pdf';
  return 'link';
}

export default function MaterialsTab({ course }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [modules, materials] = await Promise.all([
      run(supabase.from('modules').select('*').eq('course_id', course.id).order('week_no', { nullsFirst: false }).order('position')),
      run(supabase.from('materials').select('*').eq('course_id', course.id).order('position').order('created_at')),
    ]);
    return { modules, materials };
  }, [course.id]);
  const [editingWeek, setEditingWeek] = useState(null); // {} for new
  const [adding, setAdding] = useState(null); // module id or 'general'
  const [removing, setRemoving] = useState(null);
  const [act, busy] = useAction();

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  const general = data.materials.filter((m) => !m.module_id);
  const usedBytes = data.totalUsed ?? data.materials.reduce((s, m) => s + (m.size_bytes || 0), 0);
  const nextWeek = Math.max(0, ...data.modules.map((m) => m.week_no || 0)) + 1;

  async function doRemove() {
    const r = removing;
    await act(async () => {
      if (r.type === 'material') {
        if (r.item.storage_path) await removeFiles('materials', [r.item.storage_path]);
        await run(supabase.from('materials').delete().eq('id', r.item.id));
      } else {
        const files = data.materials.filter((m) => m.module_id === r.item.id && m.storage_path).map((m) => m.storage_path);
        if (files.length) await removeFiles('materials', files);
        await run(supabase.from('modules').delete().eq('id', r.item.id));
      }
    }, 'Deleted.');
    setRemoving(null);
    reload();
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 980 }}>
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <p className="small muted" style={{ maxWidth: 560 }}>
          Organise materials by week. Files you upload here use your total {STORAGE_LIMIT_LABEL} storage
          ({fmtBytes(usedBytes) || '0 KB'} used) — for videos, upload to YouTube (unlisted) or Google Drive and add the link instead.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setEditingWeek({ week_no: nextWeek })}>
          <Icon name="plus" /> Add week
        </button>
      </div>

      {data.modules.length === 0 && general.length === 0 && (
        <div className="card">
          <Empty icon="book" title="No materials yet" action={<button type="button" className="btn btn-primary" onClick={() => setEditingWeek({ week_no: 1 })}>Add week 1</button>}>
            Start by adding a week, then upload slides, notes and links into it.
          </Empty>
        </div>
      )}

      {data.modules.map((m) => (
        <WeekCard
          key={m.id}
          title={m.week_no ? `Week ${m.week_no} · ${m.title}` : m.title}
          summary={m.summary}
          items={data.materials.filter((x) => x.module_id === m.id)}
          onAdd={() => setAdding(m.id)}
          onEdit={() => setEditingWeek(m)}
          onDeleteWeek={() => setRemoving({ type: 'module', item: m })}
          onDelete={(item) => setRemoving({ type: 'material', item })}
          act={act}
        />
      ))}

      <WeekCard
        title="General (not tied to a week)"
        summary="Course outline, reading list, past questions and similar."
        items={general}
        onAdd={() => setAdding('general')}
        onDelete={(item) => setRemoving({ type: 'material', item })}
        act={act}
        muted
      />

      {editingWeek && <WeekForm course={course} week={editingWeek} onClose={() => setEditingWeek(null)} onSaved={reload} />}
      {adding && <MaterialForm course={course} moduleId={adding === 'general' ? null : adding} onClose={() => setAdding(null)} onSaved={reload} />}
      {removing && (
        <Confirm
          title={removing.type === 'module' ? 'Delete this week?' : 'Delete this material?'}
          message={removing.type === 'module'
            ? 'The week and every material inside it will be deleted. Students will no longer see them.'
            : `"${removing.item.title}" will be removed for everyone.`}
          danger
          confirmLabel="Delete"
          busy={busy}
          onClose={() => setRemoving(null)}
          onConfirm={doRemove}
        />
      )}
    </div>
  );
}

function WeekCard({ title, summary, items, onAdd, onEdit, onDeleteWeek, onDelete, act, muted }) {
  return (
    <section className="card-flush" style={muted ? { background: 'var(--surface-2)' } : undefined}>
      <div className="card-head">
        <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <h2>{title}</h2>
          {summary && <span className="small muted pre">{summary}</span>}
        </div>
        <div className="row">
          {onEdit && <button type="button" className="icon-btn plain" onClick={onEdit} aria-label="Edit week"><Icon name="edit" /></button>}
          {onDeleteWeek && <button type="button" className="icon-btn plain" onClick={onDeleteWeek} aria-label="Delete week"><Icon name="trash" /></button>}
          <button type="button" className="btn btn-sm" onClick={onAdd}><Icon name="plus" size={16} /> Add</button>
        </div>
      </div>
      {items.length === 0 && <p className="small muted" style={{ padding: '14px 18px' }}>Nothing here yet.</p>}
      {items.map((m) => (
        <div key={m.id} className="list-row">
          <KindTag kind={m.kind} />
          <span className="list-main">
            <span className="title">{m.title}</span>
            <span className="tiny muted">{m.url ? hostOf(m.url) : fmtBytes(m.size_bytes)} · added {relative(m.created_at)}</span>
          </span>
          <button type="button" className="icon-btn plain" aria-label={`Open ${m.title}`}
            onClick={() => (m.url ? window.open(m.url, '_blank', 'noopener') : act(() => openStoredFile('materials', m.storage_path)))}>
            <Icon name={m.url ? 'link' : 'eye'} />
          </button>
          <button type="button" className="icon-btn plain" aria-label={`Delete ${m.title}`} onClick={() => onDelete(m)}>
            <Icon name="trash" />
          </button>
        </div>
      ))}
    </section>
  );
}

function WeekForm({ course, week, onClose, onSaved }) {
  const [act, busy] = useAction();
  const [f, setF] = useState({ week_no: week.week_no ?? '', title: week.title || '', summary: week.summary || '' });
  async function save() {
    const row = { course_id: course.id, week_no: f.week_no === '' ? null : Number(f.week_no), title: f.title.trim(), summary: f.summary };
    const ok = await act(
      () => (week.id ? run(supabase.from('modules').update(row).eq('id', week.id)) : run(supabase.from('modules').insert(row))),
      week.id ? 'Week updated.' : 'Week added.',
    );
    if (ok !== undefined) {
      onClose();
      onSaved();
    }
  }
  return (
    <Modal title={week.id ? 'Edit week' : 'Add week'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !f.title.trim()}>Save</button></>}>
      <div className="grid-2" style={{ gridTemplateColumns: '120px minmax(0,1fr)' }}>
        <Field label="Week"><input className="input" type="number" min="0" value={f.week_no} onChange={(e) => setF({ ...f, week_no: e.target.value })} /></Field>
        <Field label="Topic"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Inventory models: EOQ and reorder points" autoFocus /></Field>
      </div>
      <Field label="What this week covers" hint="optional, shown to students">
        <textarea className="textarea" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
      </Field>
    </Modal>
  );
}

function MaterialForm({ course, moduleId, onClose, onSaved }) {
  const [mode, setMode] = useState('upload');
  const [files, setFiles] = useState([]);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    setBusy(true);
    try {
      if (mode === 'link') {
        if (!/^https?:\/\//i.test(url.trim())) throw new Error('Paste a full link starting with https://');
        await run(supabase.from('materials').insert({
          course_id: course.id, module_id: moduleId, kind: kindFromUrl(url), title: title.trim() || hostOf(url), url: url.trim(),
        }));
      } else {
        if (!files.length) throw new Error('Choose at least one file.');
        const big = files.find((f) => f.size > MAX_MB * 1024 * 1024);
        if (big) throw new Error(`"${big.name}" is larger than ${MAX_MB} MB. Compress it, or put it on Google Drive and add the link instead.`);
        for (const file of files) {
          const path = `${course.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
          let stored;
          try {
            stored = await uploadFile('materials', path, file);
          } catch (upErr) {
            throw new Error(`Upload of "${file.name}" failed: ${upErr.message}`);
          }
          const niceTitle = files.length === 1 && title.trim() ? title.trim() : file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
          await run(supabase.from('materials').insert({
            course_id: course.id, module_id: moduleId, kind: kindFromName(file.name), title: niceTitle, storage_path: stored, size_bytes: file.size,
          }));
        }
      }
      onClose();
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add material" onClose={() => !busy && onClose()}
      footer={<><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Uploading…' : 'Add'}</button></>}>
      <div className="chips" role="group" aria-label="Type">
        <button type="button" className="chip" aria-pressed={mode === 'upload'} onClick={() => setMode('upload')}>Upload files</button>
        <button type="button" className="chip" aria-pressed={mode === 'link'} onClick={() => setMode('link')}>Add a link or video</button>
      </div>
      {error && <div className="notice notice-error">{error}</div>}
      {mode === 'upload' ? (
        <>
          <Field label="Files" hint={`PDF, slides, Word, Excel · up to ${MAX_MB} MB each · you can pick several`}>
            <input type="file" multiple className="input" style={{ paddingTop: 9 }} onChange={(e) => setFiles([...(e.target.files || [])])} />
          </Field>
          {files.length === 1 && (
            <Field label="Title shown to students" hint="optional">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={files[0].name.replace(/\.[^.]+$/, '')} />
            </Field>
          )}
          {files.length > 1 && <p className="small muted">{files.length} files — each will be titled from its file name. You can rename by deleting and re-adding.</p>}
        </>
      ) : (
        <>
          <Field label="Link" hint="YouTube, Google Drive, a website…">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoFocus />
          </Field>
          <Field label="Title shown to students">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recorded lecture — week 6" />
          </Field>
          <p className="small muted">For Google Drive files, set sharing to “Anyone with the link can view”.</p>
        </>
      )}
    </Modal>
  );
}
