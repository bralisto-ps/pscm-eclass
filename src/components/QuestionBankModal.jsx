import { useMemo, useState } from 'react';
import { rpc, run, supabase } from '../lib/supabase.js';
import { fmtNumber } from '../lib/format.js';
import Icon from './Icon.jsx';
import { Empty, ErrorNote, Loading, Modal, useAction, useLoad, useToast } from './ui.jsx';

const KIND_LABELS = {
  mcq: 'Multiple choice',
  multiselect: 'Multi-select',
  truefalse: 'True / False',
  numeric: 'Calculation',
  short: 'Short answer',
  essay: 'Essay',
};

export default function QuestionBankModal({ quizId, courseId, existingPrompts = [], onImported, onClose }) {
  const toast = useToast();
  const [act, busy] = useAction();
  const { data, error, loading, reload } = useLoad(
    () => rpc('list_reusable_questions', { p_course: courseId }),
    [courseId],
  );

  const [sourceFilter, setSourceFilter] = useState('all'); // all | bank | past | weak
  const [courseFilter, setCourseFilter] = useState('all');
  const [topicFilter, setTopicFilter] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  const existingSet = useMemo(
    () => new Set(existingPrompts.map((p) => String(p || '').trim().toLowerCase())),
    [existingPrompts],
  );

  const allItems = useMemo(() => {
    const bank = Array.isArray(data?.bank) ? data.bank : [];
    const past = Array.isArray(data?.past) ? data.past : [];
    // Exclude questions already in the target quiz itself
    return [...bank, ...past.filter((x) => x.quiz_id !== quizId)].map((item, idx) => ({
      ...item,
      _uid: `${item.source}:${item.id}:${idx}`,
      _alreadyInQuiz: existingSet.has(String(item.prompt || '').trim().toLowerCase()),
    }));
  }, [data, quizId, existingSet]);

  const courses = useMemo(
    () => [...new Set(allItems.map((x) => x.course_code).filter(Boolean))].sort(),
    [allItems],
  );
  const topics = useMemo(
    () => [...new Set(allItems.map((x) => x.topic).filter(Boolean))].sort(),
    [allItems],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return allItems.filter((item) => {
      if (sourceFilter === 'bank' && item.source !== 'bank') return false;
      if (sourceFilter === 'past' && item.source !== 'past') return false;
      if (sourceFilter === 'weak' && !(item.source === 'past' && item.attempts_count > 0 && Number(item.avg_pct) < 65)) return false;
      if (courseFilter !== 'all' && item.course_code !== courseFilter) return false;
      if (topicFilter !== 'all' && item.topic !== topicFilter) return false;
      if (term) {
        const hay = [item.prompt, item.topic, item.quiz_title, item.course_code].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [allItems, sourceFilter, courseFilter, topicFilter, q]);

  function toggle(uid) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function selectShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((it) => { if (!it._alreadyInQuiz) next.add(it._uid); });
      return next;
    });
  }

  async function importSelected() {
    const picked = allItems.filter((it) => selected.has(it._uid));
    if (!picked.length) return;
    const payload = picked.map((it) => ({
      kind: it.kind,
      prompt: it.prompt,
      options: it.options || [],
      answer: it.answer || {},
      params: it.params || {},
      formula: it.formula || null,
      unit: it.unit || '',
      decimals: it.decimals ?? 2,
      tolerance: it.tolerance ?? 0,
      tolerance_type: it.tolerance_type || 'abs',
      marks: it.marks ?? 1,
      explanation: it.explanation || '',
      topic: it.topic || '',
      image_path: it.image_path || null,
    }));
    const count = await act(
      () => rpc('import_questions_to_quiz', { p_quiz: quizId, p_items: payload }),
      `Imported ${picked.length} question${picked.length === 1 ? '' : 's'} into this quiz.`,
    );
    if (count !== undefined) {
      onImported?.();
      onClose();
    }
  }

  async function deleteBankItem(bankId) {
    const ok = await act(
      () => run(supabase.from('question_bank').delete().eq('id', bankId)),
      'Removed from Saved Question Bank.',
    );
    if (ok !== undefined) reload();
  }

  return (
    <Modal
      wide
      title="Question Bank & Past Quizzes"
      onClose={onClose}
      footer={
        <div className="between" style={{ width: '100%', flexWrap: 'wrap', gap: 8 }}>
          <span className="small muted">{selected.size} question{selected.size === 1 ? '' : 's'} selected</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || selected.size === 0} onClick={importSelected}>
              {busy ? 'Importing…' : `Import ${selected.size || ''} into Quiz`}
            </button>
          </div>
        </div>
      }
    >
      {loading && <Loading label="Loading question bank and past quizzes…" />}
      {error && (
        <div className="stack">
          <ErrorNote error={error} onRetry={reload} />
          <p className="tiny muted">If this RPC is not found, run the latest SQL migration (Section 17) in Supabase first.</p>
        </div>
      )}

      {!loading && !error && (
        <div className="stack">
          <div className="row-wrap" style={{ gap: 8 }}>
            <div className="chips" role="group" aria-label="Source filter">
              {[
                ['all', `All (${allItems.length})`],
                ['bank', `Saved Bank (${data?.bank?.length || 0})`],
                ['past', 'Past Quizzes'],
                ['weak', 'Weak Topics (<65%)'],
              ].map(([id, label]) => (
                <button key={id} type="button" className="chip" aria-pressed={sourceFilter === id} onClick={() => setSourceFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            <label className="search" style={{ flex: 1, minWidth: 180 }}>
              <span className="sr-only">Search questions</span>
              <Icon name="search" size={16} />
              <input className="input" style={{ minHeight: 38 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompt, topic, quiz…" />
            </label>
          </div>

          <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
            {courses.length > 0 && (
              <select className="select" style={{ width: 'auto', minHeight: 36, fontSize: 13 }} value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
                <option value="all">All courses</option>
                {courses.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {topics.length > 0 && (
              <select className="select" style={{ width: 'auto', minHeight: 36, fontSize: 13 }} value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)}>
                <option value="all">All topics</option>
                {topics.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <span className="spacer" />
            {filtered.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={selectShown}>
                Select shown ({filtered.filter((x) => !x._alreadyInQuiz).length})
              </button>
            )}
            {selected.size > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
            )}
          </div>

          <div className="stack-sm" style={{ maxHeight: '52vh', overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <Empty icon="bookmark" title="No matching questions">
                Save questions to your Bank from any quiz card, or adjust filters above.
              </Empty>
            ) : filtered.map((item) => {
              const checked = selected.has(item._uid);
              return (
                <div
                  key={item._uid}
                  className="card-soft"
                  style={{
                    padding: '10px 14px',
                    border: checked ? '1.5px solid var(--teal)' : '1px solid var(--line)',
                    background: checked ? 'var(--teal-50)' : 'var(--surface)',
                    opacity: item._alreadyInQuiz ? 0.65 : 1,
                  }}
                >
                  <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(item._uid)}
                      style={{ marginTop: 4, width: 17, height: 17, accentColor: 'var(--teal)' }}
                    />
                    <div className="stack-sm" style={{ flex: 1, gap: 4, minWidth: 0 }}>
                      <div className="row-wrap" style={{ gap: 6 }}>
                        <span className={`badge ${item.source === 'bank' ? 'badge-teal' : 'badge-blue'}`}>
                          {item.source === 'bank' ? 'Saved Bank' : item.quiz_title || 'Past Quiz'}
                        </span>
                        {item.course_code && <span className="badge mono">{item.course_code}</span>}
                        <span className="badge">{KIND_LABELS[item.kind] || item.kind}</span>
                        {item.topic && <span className="badge badge-plum">{item.topic}</span>}
                        {item.difficulty && <span className="badge">{item.difficulty}</span>}
                        {item.source === 'past' && item.attempts_count > 0 && item.avg_pct !== null && (
                          <span className={`badge ${Number(item.avg_pct) < 60 ? 'badge-red' : 'badge-teal'}`}>
                            Pass rate: {item.avg_pct}% ({item.attempts_count})
                          </span>
                        )}
                        {item._alreadyInQuiz && <span className="badge badge-amber">Already in quiz</span>}
                        <span className="spacer" />
                        <span className="tiny muted mono">{fmtNumber(item.marks)} mk</span>
                        {item.source === 'bank' && (
                          <button
                            type="button"
                            className="icon-btn plain"
                            title="Delete from Saved Bank"
                            onClick={() => deleteBankItem(item.id)}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        )}
                      </div>
                      <p className="small pre" style={{ margin: 0, lineHeight: 1.45 }}>{item.prompt}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
