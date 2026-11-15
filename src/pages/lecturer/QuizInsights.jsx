import { useMemo, useState } from 'react';
import { rpc, rpcAll, run, supabase } from '../../lib/supabase.js';
import { fmtNumber } from '../../lib/format.js';
import { downloadWorkbook } from '../../lib/sheets.js';
import Icon from '../../components/Icon.jsx';
import { Empty, ErrorNote, Loading, Modal, useLoad } from '../../components/ui.jsx';

const KIND = { mcq: 'Multiple choice', multiselect: 'Multi-select', truefalse: 'True / false', numeric: 'Calculation', short: 'Short answer', essay: 'Written' };

function verdict(r) {
  if (r.answered < 5) return { label: 'Too few answers', cls: '' };
  if (r.discrimination !== null && Number(r.discrimination) < 0) return { label: 'Check this question', cls: 'badge-red', tip: 'Weaker students did better than stronger ones — the key may be wrong or the wording confusing.' };
  if (Number(r.avg_pct) < 30) return { label: 'Very hard', cls: 'badge-amber', tip: 'Most students got this wrong — consider re-teaching this point.' };
  if (Number(r.avg_pct) > 90) return { label: 'Very easy', cls: 'badge-blue' };
  if (r.discrimination !== null && Number(r.discrimination) < 0.15) return { label: 'Weak question', cls: 'badge-amber', tip: 'Strong and weak students scored about the same — it does not tell them apart.' };
  return { label: 'Working well', cls: 'badge-teal' };
}

export function ItemAnalysis({ quiz }) {
  const { data, error, loading, reload } = useLoad(() => rpc('quiz_item_analysis', { p_quiz: quiz.id }), [quiz.id]);
  if (loading) return <Loading label="Analysing answers…" />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data.length) return <div className="card"><Empty icon="chart" title="No questions" /></div>;
  const anyAnswers = data.some((r) => r.answered > 0);
  const streams = [...new Set(data.flatMap((r) => Object.keys(r.by_stream || {})))].sort();

  function exportXlsx() {
    downloadWorkbook(`${quiz.courses.code} - ${quiz.title} - question analysis.xlsx`, [{
      name: 'Questions',
      rows: [['#', 'Question', 'Type', 'Topic', 'Answered', 'Average %', 'Discrimination', 'Verdict', ...streams.map((s) => `${s} %`)],
        ...data.map((r, i) => [i + 1, r.prompt, KIND[r.kind], r.topic || '', r.answered, r.avg_pct === null ? '' : Number(r.avg_pct),
          r.discrimination === null ? '' : Number(r.discrimination), verdict(r).label, ...streams.map((s) => r.by_stream?.[s] ?? '')])],
      widths: [5, 60, 16, 18, 10, 10, 13, 18, ...streams.map(() => 10)],
    }]);
  }

  return (
    <div className="stack">
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <p className="small muted" style={{ maxWidth: 760 }}>
          Based on each student's first attempt. <strong>Average</strong> is the share of marks students got on the question.
          <strong> Discrimination</strong> compares the top and bottom quarter of the class: above 0.3 is good; near zero or negative
          means the question does not separate strong from weak students — often a wrong key or confusing wording.
        </p>
        <button type="button" className="btn btn-sm" onClick={exportXlsx} disabled={!anyAnswers}><Icon name="download" size={16} /> Export</button>
      </div>
      {!anyAnswers && <div className="card"><Empty icon="chart" title="No submissions yet">Analysis appears once students submit.</Empty></div>}
      {anyAnswers && data.map((r, i) => {
        const v = verdict(r);
        const opts = r.options && (r.kind === 'mcq' || r.kind === 'truefalse') ? r.options : null;
        const optTotal = opts ? Object.values(opts).reduce((s, n) => s + Number(n), 0) : 0;
        return (
          <article key={r.question_id} className="card stack-sm">
            <div className="between" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div className="row-wrap">
                <span className="mono strong">{i + 1}</span>
                <span className="badge">{KIND[r.kind]}</span>
                {r.topic && <span className="badge badge-plum">{r.topic}</span>}
                <span className={`badge ${v.cls}`} title={v.tip}>{v.label}</span>
              </div>
              <div className="row-wrap small">
                <span>Average <strong className="mono">{r.avg_pct === null ? '—' : `${fmtNumber(r.avg_pct, 0)}%`}</strong></span>
                <span>Discrimination <strong className="mono">{r.discrimination === null ? '—' : fmtNumber(r.discrimination, 2)}</strong></span>
                <span className="muted">{r.answered} answered</span>
              </div>
            </div>
            <p className="pre small" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.prompt}</p>
            {v.tip && <p className="tiny" style={{ color: v.cls === 'badge-red' ? 'var(--red-ink)' : 'var(--amber-ink)' }}>{v.tip}</p>}
            {opts && (
              <div className="stack-sm" style={{ gap: 4 }}>
                {Object.entries(opts).sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => {
                  const p = optTotal ? Math.round((Number(n) / optTotal) * 100) : 0;
                  const right = r.kind === 'multiselect' ? String(r.correct || '').split(',').includes(k) : k === r.correct;
                  return (
                    <div key={k} className="row small" style={{ gap: 10 }}>
                      <span className="mono" style={{ width: 54 }}>{k === '' ? 'blank' : k === 'true' ? 'True' : k === 'false' ? 'False' : k.toUpperCase()}</span>
                      <div className="bar-track" style={{ flex: 1, height: 10 }}><div className="bar-fill" style={{ height: 10, width: `${p}%`, background: right ? 'var(--teal)' : 'var(--field)' }} /></div>
                      <span className="mono" style={{ width: 70, textAlign: 'right' }}>{p}% {right ? '✓' : ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {Object.keys(r.by_stream || {}).length > 1 && (
              <div className="row-wrap tiny muted">By stream: {Object.entries(r.by_stream).map(([s, p]) => <span key={s} className="badge">{s} {p}%</span>)}</div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function Integrity({ quiz, rows, photos = new Map(), onShowSql }) {
  const [threshold, setThreshold] = useState(0.6);
  const [viewingPhoto, setViewingPhoto] = useState(null);
  const sim = useLoad(() => rpc('quiz_similar_answers', { p_quiz: quiz.id, p_threshold: threshold }), [quiz.id, threshold]);
  const figs = useLoad(() => rpc('quiz_figure_matches', { p_quiz: quiz.id }), [quiz.id]);
  const typing = useLoad(async () => {
    const [signals, qs] = await Promise.all([
      rpcAll('quiz_typing_signals', { p_quiz: quiz.id }),
      run(supabase.from('questions').select('id, prompt, kind, position').eq('quiz_id', quiz.id)),
    ]);
    return { signals, qMap: new Map((qs || []).map((q) => [q.id, q])) };
  }, [quiz.id]);

  const typingRows = useMemo(() => {
    if (!typing.data) return [];
    const out = [];
    for (const st of typing.data.signals || []) {
      const tel = st.typing_telemetry || {};
      for (const [qid, m] of Object.entries(tel)) {
        if (!m || (!m.words && !m.chars)) continue;
        const qObj = typing.data.qMap.get(qid);
        const isBurst = Number(m.maxBurstChars || 0) >= 60 || Number(m.burstEvents || 0) >= 2;
        const isFast = Number(m.wpm || 0) >= 95 && Number(m.words || 0) >= 25;
        const severity = isBurst ? 2 : isFast ? 1 : 0;
        out.push({
          key: `${st.attempt_id}:${qid}`,
          full_name: st.full_name,
          index_no: st.index_no,
          prompt: qObj?.prompt || 'Written / Short answer',
          words: Number(m.words || 0),
          chars: Number(m.chars || 0),
          activeSec: Number(m.activeSec || 0),
          wpm: m.wpm ? Number(m.wpm) : null,
          maxBurstChars: Number(m.maxBurstChars || 0),
          burstEvents: Number(m.burstEvents || 0),
          severity,
        });
      }
    }
    out.sort((a, b) => b.severity - a.severity || b.maxBurstChars - a.maxBurstChars || (b.wpm || 0) - (a.wpm || 0));
    return out;
  }, [typing.data]);

  const flagged = rows.filter((r) => r.exits > 0 || r.devices > 1);

  return (
    <div className="stack-lg">
      <p className="small muted" style={{ maxWidth: 760 }}>
        These are signs worth a closer look, not proof. Talk to the students involved before deciding anything.
      </p>

      <section className="card-flush">
        <div className="card-head"><h2>Same wrong answer as a classmate's own figures</h2><span className="small muted">calculation questions with unique figures</span></div>
        <p className="small muted" style={{ padding: '12px 18px 0' }}>
          The student's answer is wrong for their own figures, but exactly right for another student's — a strong sign they copied the working.
        </p>
        {figs.loading ? <Loading /> : figs.error ? <div style={{ padding: 18 }}><ErrorNote error={figs.error} /></div> : figs.data.length === 0 ? <Empty icon="check">No matches found.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Student</th><th>Their answer</th><th>Matches the figures of</th><th>Question</th></tr></thead>
              <tbody>
                {figs.data.map((r, i) => (
                  <tr key={i}>
                    <td>{r.full_name} <span className="mono tiny muted">{r.index_no}</span></td>
                    <td className="mono">{fmtNumber(r.answer, 4)}</td>
                    <td>{r.match_name} <span className="mono tiny muted">{r.match_index}</span></td>
                    <td className="small muted" style={{ maxWidth: 320 }}>{r.prompt.slice(0, 90)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-flush">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <h2>Very similar written answers</h2>
          <label className="row small" style={{ gap: 6 }}>Similarity at least
            <select className="select" style={{ width: 'auto', minHeight: 38 }} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
              <option value={0.8}>80% (near copies)</option><option value={0.6}>60%</option><option value={0.45}>45% (broad)</option>
            </select>
          </label>
        </div>
        {sim.loading ? <Loading label="Comparing answers…" /> : sim.error ? <div style={{ padding: 18 }}><ErrorNote error={sim.error} /></div> : sim.data.length === 0 ? <Empty icon="check">No similar pairs found.</Empty> : (
          <div className="stack" style={{ padding: 18 }}>
            {sim.data.map((r, i) => (
              <div key={i} className="card stack-sm" style={{ padding: 14 }}>
                <div className="between" style={{ flexWrap: 'wrap' }}>
                  <strong className="small">{r.a_name} <span className="mono muted">{r.a_index}</span> &nbsp;↔&nbsp; {r.b_name} <span className="mono muted">{r.b_index}</span></strong>
                  <span className={`badge ${Number(r.similarity) >= 0.8 ? 'badge-red' : 'badge-amber'}`}>{Math.round(Number(r.similarity) * 100)}% similar</span>
                </div>
                <span className="tiny muted">{r.prompt.slice(0, 120)}</span>
                <div className="grid-2" style={{ gap: 10 }}>
                  <p className="pre small" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8 }}>{r.a_text}</p>
                  <p className="pre small" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8 }}>{r.b_text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      
      <section className="card-flush">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2>Written &amp; short-answer typing &amp; burst signals</h2>
            <span className="small muted">tracks active composition pace vs. sudden large text insertions</span>
          </div>
          {typingRows.some((r) => r.severity > 0) && (
            <span className="badge badge-amber">{typingRows.filter((r) => r.severity > 0).length} unusual pace / burst</span>
          )}
        </div>
        {typing.loading ? <Loading /> : typing.error ? (
          <div style={{ padding: 18 }}>
            {/quiz_typing_signals|Could not find|does not exist|schema cache/i.test(typing.error) ? (
              <div className="row-wrap between">
                <span className="small muted">Run the updated SQL script in Supabase to collect typing-speed and burst signals on written quiz questions.</span>
                {onShowSql && <button type="button" className="btn btn-sm btn-primary" onClick={onShowSql}>View Setup SQL</button>}
              </div>
            ) : (
              <ErrorNote error={typing.error} />
            )}
          </div>
        ) : typingRows.length === 0 ? (
          <Empty icon="edit">No short-answer or written typing telemetry recorded on this quiz yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Question</th>
                  <th className="num">Words</th>
                  <th className="num">Active time</th>
                  <th className="num">Pace</th>
                  <th className="num">Max burst</th>
                  <th>Signal</th>
                </tr>
              </thead>
              <tbody>
                {typingRows.slice(0, 120).map((r) => (
                  <tr key={r.key} style={r.severity >= 2 ? { background: 'var(--red-50)' } : r.severity === 1 ? { background: 'var(--amber-50)' } : undefined}>
                    <td>
                      {r.full_name} <span className="mono tiny muted">{r.index_no}</span>
                    </td>
                    <td className="small muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.prompt}
                    </td>
                    <td className="num mono">{r.words}</td>
                    <td className="num mono">{r.activeSec}s</td>
                    <td className="num mono">{r.wpm ? `${r.wpm} wpm` : '—'}</td>
                    <td className="num mono">{r.maxBurstChars > 0 ? `+${r.maxBurstChars} ch` : '—'}</td>
                    <td>
                      {r.severity >= 2 ? (
                        <span className="badge badge-red">Rapid burst (+{r.maxBurstChars} ch)</span>
                      ) : r.severity === 1 ? (
                        <span className="badge badge-amber">High pace ({r.wpm} wpm)</span>
                      ) : (
                        <span className="badge badge-teal">Normal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-flush">
        <div className="card-head"><h2>Left the quiz or used two devices</h2><span className="small muted">strict-mode quizzes</span></div>
        {flagged.length === 0 ? <Empty icon="check">Nobody flagged.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Student</th><th>Photo</th><th className="num">Times left</th><th className="num">Devices</th><th className="num">Score</th></tr></thead>
              <tbody>
                {flagged.map((r) => {
                  const p = photos?.get(r.attempt_id) || photos?.get(r.student_id);
                  return (
                    <tr key={r.index_no}>
                      <td>{r.full_name} <span className="mono tiny muted">{r.index_no}</span></td>
                      <td>
                        {p ? (
                          <button
                            type="button"
                            className="badge badge-teal"
                            style={{ border: 0, cursor: 'pointer', padding: '2px 7px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            onClick={() => setViewingPhoto({ student: r, photo: p })}
                            title="Inspect mid-quiz verification photo"
                          >
                            <Icon name="camera" size={12} /> View
                          </button>
                        ) : (
                          <span className="small muted">—</span>
                        )}
                      </td>
                      <td className="num">{r.exits}</td>
                      <td className="num">{r.devices}</td>
                      <td className="num">{r.score !== null ? `${fmtNumber(r.score)} / ${fmtNumber(r.max_score)}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {viewingPhoto && (
        <Modal title={`Verification Photo · ${viewingPhoto.student.full_name}`} onClose={() => setViewingPhoto(null)}>
          <div className="stack" style={{ textAlign: 'center', alignItems: 'center', gap: 14 }}>
            <div style={{ maxWidth: 320, width: '100%', borderRadius: 10, overflow: 'hidden', border: '2px solid var(--teal)', boxShadow: '0 4px 14px rgba(0,0,0,0.1)' }}>
              <img
                src={viewingPhoto.photo}
                alt={`Identity snapshot of ${viewingPhoto.student.full_name}`}
                style={{ width: '100%', height: 'auto', display: 'block', background: '#000' }}
              />
            </div>
            <div className="stack-sm" style={{ gap: 4 }}>
              <strong style={{ fontSize: 16 }}>{viewingPhoto.student.full_name}</strong>
              <span className="mono muted">{viewingPhoto.student.index_no} {viewingPhoto.student.programme ? `· ${viewingPhoto.student.programme}` : ''}</span>
              <span className="small muted">
                Captured mid-exam from the candidate webcam during the test session.
              </span>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setViewingPhoto(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
