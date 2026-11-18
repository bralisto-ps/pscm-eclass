import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { run, supabase } from '../lib/supabase.js';
import Icon from './Icon.jsx';
import { Field, Modal, useAction, useToast } from './ui.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const CYCLE_LETTERS = ['B', 'A', 'D', 'C', 'B', 'D'];

export function parseMcqText(text) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const results = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const prompt = lines[0].replace(/^(\d+[\.\)]\s*)+/, '').trim();
    const options = [];
    let correct = -1;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const optMatch = line.match(/^([A-Fa-f])[\.\)]\s*(.*)/);
      const ansMatch = line.match(/^Answer:\s*([A-Fa-f])/i);
      if (ansMatch) {
        correct = LETTERS.indexOf(ansMatch[1].toUpperCase());
      } else if (optMatch) {
        let optText = optMatch[2].trim();
        if (optText.endsWith('*')) {
          correct = options.length;
          optText = optText.slice(0, -1).trim();
        }
        options.push(optText);
      }
    }
    if (prompt && options.length >= 2) {
      results.push({ prompt, options, correct: correct >= 0 ? correct : 0 });
    }
  }
  return results;
}

function buildTemplateDraft(cleanTopic, count) {
  const sentences = cleanTopic
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 18);
  const keywords = cleanTopic
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const focus = keywords.slice(0, 4).join(' ') || cleanTopic.slice(0, 45);
  const secondary = keywords[1] || 'operational execution';

  const stems = [
    (i, k) => `${i}. Which statement best captures the primary operational objective of ${k}?`,
    (i, k) => `${i}. When managing ${k}, which risk factor most directly disrupts ${secondary}?`,
    (i, k) => `${i}. Which quantitative KPI is most commonly used to monitor ${k} performance?`,
    (i, k) => `${i}. What is a primary cross-functional challenge when implementing ${k}?`,
    (i, k) => `${i}. Which governance practice strengthens accountability and auditability in ${k}?`,
    (i, k) => `${i}. How should a supply chain team sustain continuous improvement in ${k}?`,
  ];

  const optionSets = [
    [
      'Minimizing overall throughput without service targets',
      'Balancing cost, compliance, reliability, and service value',
      'Eliminating supplier audits and performance reviews',
      'Introducing uncoordinated manual handoffs',
    ],
    [
      'Inaccurate demand/lead-time assumptions and weak visibility',
      'Exceeding agreed on-time delivery targets',
      'Maintained safety-stock buffer alignment',
      'Structured dual-sourcing agreements',
    ],
    [
      'Arbitrary anecdotal estimates',
      'Unverified informal guesses',
      'Total order cycle time, fill rate, and resource utilization',
      'Excluding defect and variance rates',
    ],
    [
      'Instantaneous zero-cost adoption across tiers',
      'Complete elimination of stakeholder touchpoints',
      'Cross-functional alignment, data consistency, and change management',
      'Removing KPI tracking from contracts',
    ],
    [
      'Allowing undocumented ad-hoc exceptions',
      'Documented SLAs, periodic scorecards, and clear escalation rules',
      'Suspending periodic contract compliance checks',
      'Relying on outdated single-period baselines',
    ],
    [
      'Discontinuing variance analysis after launch',
      'Avoiding corrective action plans',
      'Ignoring customer service-level trends',
      'Regular root-cause reviews, benchmarking, and feedback loops',
    ],
  ];

  const correctIndices = [1, 0, 2, 2, 1, 3];
  const out = [];
  for (let i = 1; i <= count; i++) {
    const idx = (i - 1) % stems.length;
    const snippet = sentences[idx] ? ` (${sentences[idx].slice(0, 80)}${sentences[idx].length > 80 ? '…' : ''})` : '';
    const promptText = stems[idx](i, focus) + snippet;
    const opts = optionSets[idx];
    const corrIdx = correctIndices[idx];
    const corrLetter = CYCLE_LETTERS[idx] || LETTERS[corrIdx];
    const lines = [promptText];
    for (let k = 0; k < 4; k++) {
      lines.push(`${LETTERS[k]}) ${opts[k]}${k === corrIdx ? ' *' : ''}`);
    }
    lines.push(`Answer: ${LETTERS[corrIdx] || corrLetter}`);
    out.push(lines.join('\n'));
  }
  return out.join('\n\n');
}

export default function AIGeneratorModal({ courseId, quizId, start = 1, onClose, onDone }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(20);
  const [count, setCount] = useState(5);
  const [antiCheat, setAntiCheat] = useState(true);
  const [timePerQ, setTimePerQ] = useState('60');
  const [noBacktrack, setNoBacktrack] = useState(true);
  const [mode, setMode] = useState('ai'); // 'ai' | 'template'
  const [draftSource, setDraftSource] = useState(null); // { kind: 'ai' | 'template', note?: string }
  const [generatedText, setGeneratedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [act, busy] = useAction();

  const isNewQuiz = Boolean(courseId && !quizId);
  const parsed = useMemo(() => parseMcqText(generatedText), [generatedText]);

  async function handleGenerate() {
    if (!topic.trim()) return;
    setIsGenerating(true);

    const cleanTopic = topic.trim();
    if (isNewQuiz && !title) {
      setTitle(cleanTopic.length > 50 ? `${cleanTopic.slice(0, 47)}...` : cleanTopic);
    }

    if (mode === 'ai') {
      try {
        const { data, error } = await supabase.functions.invoke('ai-draft', {
          body: { topic: cleanTopic, count },
        });
        if (!error && data?.text && !data?.error) {
          setGeneratedText(String(data.text).trim());
          setDraftSource({ kind: 'ai', note: data.model ? `Drafted with ${data.model} (review before publishing)` : 'AI draft ready — review before publishing' });
          setIsGenerating(false);
          return;
        }
        const reason = data?.error || error?.message || 'AI server function unavailable';
        setGeneratedText(buildTemplateDraft(cleanTopic, count));
        setDraftSource({
          kind: 'template',
          note: `Used structured template draft because server AI is not configured (${reason}). Edit stems and options below.`,
        });
        toast('Server AI not configured — loaded editable template draft instead.');
      } catch {
        setGeneratedText(buildTemplateDraft(cleanTopic, count));
        setDraftSource({
          kind: 'template',
          note: 'Used structured template draft (offline or AI Edge Function not deployed). Edit wording before saving.',
        });
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    setGeneratedText(buildTemplateDraft(cleanTopic, count));
    setDraftSource({
      kind: 'template',
      note: 'Structured template draft — customize the question stems, options, and marked answer before saving.',
    });
    setIsGenerating(false);
  }

  async function save() {
    if (!parsed.length) return;

    let targetQuizId = quizId;

    if (isNewQuiz) {
      const quizTitle = title.trim() || topic.trim() || 'Draft Quiz';
      const createdQuiz = await act(
        () =>
          run(
            supabase
              .from('quizzes')
              .insert({
                course_id: courseId,
                title: quizTitle,
                duration_minutes: Number(duration) || 20,
                published: false,
                results_released: false,
                lockdown: antiCheat,
                question_time_limit: timePerQ ? Number(timePerQ) : null,
                no_backtrack: noBacktrack,
                shuffle_questions: true,
                shuffle_options: true,
              })
              .select()
              .single(),
          ),
        'Created new draft quiz.',
      );
      if (!createdQuiz) return;
      targetQuizId = createdQuiz.id;
    }

    const rows = parsed.filter((p) => p.correct >= 0).map((p, i) => ({
      quiz_id: targetQuizId,
      kind: 'mcq',
      position: (quizId ? start : 1) + i,
      prompt: p.prompt,
      marks: 1,
      topic: topic.trim().slice(0, 50),
      options: p.options.map((t, k) => ({ id: LETTERS[k], text: t })),
      answer: { correct: LETTERS[p.correct] },
    }));

    const ok = await act(
      () => run(supabase.from('questions').insert(rows)),
      `${rows.length} questions saved.`,
    );

    if (ok !== undefined) {
      onDone?.();
      onClose();
      if (isNewQuiz && targetQuizId) {
        navigate(`/teach/quiz/${targetQuizId}`);
      }
    }
  }

  return (
    <Modal
      title="Draft Quiz Questions"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {generatedText && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={busy || !parsed.length}
            >
              <Icon name="sparkles" size={16} /> {isNewQuiz ? `Create Quiz with ${parsed.length} Questions` : `Add ${parsed.length} Questions to Quiz`}
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--teal-50)',
            border: '1px solid var(--teal-200)',
            borderRadius: 8,
          }}
        >
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--teal-900)' }}>
            <Icon name="sparkles" size={16} /> Server AI &amp; Quick Template Drafting
          </strong>
          <p className="tiny muted" style={{ margin: '4px 0 0' }}>
            Uses your Supabase <span className="mono">ai-draft</span> Edge Function (when <span className="mono">GEMINI_API_KEY</span> is set) to draft MCQs grounded in your lecture notes, or switches cleanly to an editable structured template draft.
          </p>
          <div className="chips" style={{ marginTop: 10 }}>
            <button type="button" className="chip" aria-pressed={mode === 'ai'} onClick={() => setMode('ai')}>
              Server AI draft
            </button>
            <button type="button" className="chip" aria-pressed={mode === 'template'} onClick={() => setMode('template')}>
              Offline quick template
            </button>
          </div>
        </div>

        {isNewQuiz && (
          <>
            <div className="grid-2">
              <Field label="Quiz title">
                <input
                  className="input"
                  placeholder="e.g. Inventory Management Quiz"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label="Duration (minutes)">
                <input
                  className="input mono"
                  type="number"
                  min="5"
                  max="180"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </Field>
            </div>
            <div
              className="stack-sm"
              style={{
                padding: '12px 16px',
                borderRadius: 8,
                background: 'var(--teal-50)',
                border: '1px solid var(--teal-200)',
              }}
            >
              <div className="between" style={{ alignItems: 'center' }}>
                <strong className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--teal-900)' }}>
                  <Icon name="shield" size={16} /> Exam Anti-Cheating &amp; Security Suite
                </strong>
                <span className="badge badge-teal" style={{ fontSize: 11 }}>Active on this quiz</span>
              </div>
              <div className="grid-2" style={{ gap: 10, marginTop: 4 }}>
                <label className="check small">
                  <input type="checkbox" checked={antiCheat} onChange={(e) => setAntiCheat(e.target.checked)} />
                  <span><strong>Strict Lockdown &amp; Camera Shield</strong> (Watermark, window blur, exit logging)</span>
                </label>
                <label className="check small">
                  <input type="checkbox" checked={noBacktrack} onChange={(e) => setNoBacktrack(e.target.checked)} />
                  <span><strong>No Going Back</strong> (Question locks once student answers)</span>
                </label>
              </div>
              <div style={{ marginTop: 6 }}>
                <span className="small muted" style={{ display: 'block', marginBottom: 4 }}>
                  Time limit per question:
                </span>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {[
                    { label: 'No limit', val: '' },
                    { label: '30s', val: '30' },
                    { label: '45s', val: '45' },
                    { label: '60s (Recommended)', val: '60' },
                    { label: '90s', val: '90' },
                    { label: '120s', val: '120' },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      className="chip"
                      aria-pressed={timePerQ === opt.val}
                      onClick={() => setTimePerQ(opt.val)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        <Field label="Topic, chapter title, or paste lecture notes *">
          <textarea
            className="input"
            rows={4}
            placeholder="Paste lecture excerpts or write key topics: e.g. Economic Order Quantity, Safety Stock calculations, Bullwhip effect, Procurement Contracts..."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            autoFocus
          />
        </Field>

        <div className="between" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="small muted">Number of questions:</span>
            {[3, 5, 8, 10].map((n) => (
              <button
                key={n}
                type="button"
                className="chip"
                aria-pressed={count === n}
                onClick={() => setCount(n)}
              >
                {n} questions
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={!topic.trim() || isGenerating}
          >
            <Icon name="sparkles" size={16} />
            {isGenerating ? 'Drafting Questions…' : mode === 'ai' ? 'Draft with Server AI' : 'Generate Template Draft'}
          </button>
        </div>

        {generatedText && (
          <div className="stack-sm" style={{ marginTop: 12 }}>
            {draftSource?.note && (
              <div className={`notice small ${draftSource.kind === 'template' ? 'notice-warn' : 'notice-ok'}`} style={{ padding: '8px 12px' }}>
                {draftSource.note}
              </div>
            )}
            <span className="eyebrow">
              Review &amp; Edit Draft Questions ({parsed.length} recognized):
            </span>
            <textarea
              className="textarea mono"
              style={{ minHeight: 220, fontSize: 13, background: 'var(--surface)' }}
              value={generatedText}
              onChange={(e) => setGeneratedText(e.target.value)}
            />
            <span className="tiny muted">
              Edit any stem, option, or correct answer before saving. Mark correct options with an asterisk (*) or write Answer: [Letter] at the end.
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
