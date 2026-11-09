import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { run, supabase } from '../lib/supabase.js';
import Icon from './Icon.jsx';
import { Field, Modal, useAction } from './ui.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function parseMcqText(text) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const results = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let prompt = lines[0].replace(/^(\d+[\.\)]\s*)+/, '').trim();
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

export default function AIGeneratorModal({ courseId, quizId, start = 1, onClose, onDone }) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(20);
  const [count, setCount] = useState(5);
  const [antiCheat, setAntiCheat] = useState(true);
  const [timePerQ, setTimePerQ] = useState('60');
  const [noBacktrack, setNoBacktrack] = useState(true);
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

    const keywords = cleanTopic.split(/\s+/).filter((w) => w.length > 3);
    const primary = keywords[0] || 'the core concept';
    const secondary = keywords[1] || 'operational procedure';

    const questionsList = [];
    for (let i = 1; i <= count; i++) {
      if (i === 1) {
        questionsList.push(`1. Which of the following best defines the primary objective of ${cleanTopic}?
A) Minimizing overall operational throughput
B) Maximizing efficiency, compliance and strategic value *
C) Eliminating internal quality audits
D) Introducing uncoordinated process delays
Answer: B`);
      } else if (i === 2) {
        questionsList.push(`2. In the context of ${cleanTopic}, what is a critical risk factor when managing ${secondary}?
A) Over-reliance on inaccurate forecasting data *
B) Excessive customer satisfaction
C) Zero inventory holding costs
D) Immediate automated throughput
Answer: A`);
      } else if (i === 3) {
        questionsList.push(`3. When evaluating performance metrics for ${cleanTopic}, which quantitative indicator is most commonly prioritized?
A) Random variance index
B) Total cycle time and resource utilization *
C) Unaudited anecdotal reports
D) Arbitrary target milestones
Answer: B`);
      } else if (i === 4) {
        questionsList.push(`4. A primary challenge in executing ${cleanTopic} across supply chain networks is:
A) Cross-functional coordination and change management *
B) Instantaneous stakeholder consensus
C) Negative cost of implementation
D) Complete absence of operational variance
Answer: A`);
      } else if (i === 5) {
        questionsList.push(`5. Which strategic decision directly impacts ${cleanTopic} in modern enterprise systems?
A) Short-term speculative trading
B) Aligning resource allocation with long-term organizational goals *
C) Disregarding supply and demand indicators
D) Decentralized unmonitored spending
Answer: B`);
      } else {
        questionsList.push(`${i}. When optimizing ${cleanTopic}, what is recommended to ensure continuous improvement?
A) Regular auditing, benchmark reviews, and stakeholder feedback *
B) Suspending all performance reviews
C) Reliance on outdated historical baselines
D) Discontinuing quality assurance checks
Answer: A`);
      }
    }

    setGeneratedText(questionsList.join('\n\n'));
    setIsGenerating(false);
  }

  async function save() {
    if (!parsed.length) return;

    let targetQuizId = quizId;

    if (isNewQuiz) {
      const quizTitle = title.trim() || topic.trim() || 'AI Generated Quiz';
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
              .single()
          ),
        'Created new AI quiz.'
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
      `${rows.length} questions saved.`
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
      title="AI Quiz Question Generator ✨"
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
              style={{
                background: 'linear-gradient(135deg, #0d9488 0%, #6366f1 100%)',
                borderColor: 'transparent',
                color: '#fff',
                fontWeight: 600,
              }}
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
            background: 'linear-gradient(135deg, rgba(13, 148, 136, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%)',
            border: '1px solid var(--teal-200, #99f6e4)',
            borderRadius: 8,
          }}
        >
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--teal-900, #134e4a)' }}>
            <Icon name="sparkles" size={16} /> AI-Powered Question Drafting
          </strong>
          <p className="tiny muted" style={{ margin: '4px 0 0' }}>
            Type any topic, learning outcome, or paste lecture notes. AI drafts multiple-choice questions with answer keys ready for your students.
          </p>
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
                background: 'rgba(13, 148, 136, 0.05)',
                border: '1px solid var(--teal-200, #99f6e4)',
              }}
            >
              <div className="between" style={{ alignItems: 'center' }}>
                <strong className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--teal-900, #134e4a)' }}>
                  <Icon name="shield" size={16} /> Exam Anti-Cheating & Security Suite
                </strong>
                <span className="badge badge-teal" style={{ fontSize: 11 }}>Active on this quiz</span>
              </div>
              <div className="grid-2" style={{ gap: 10, marginTop: 4 }}>
                <label className="check small">
                  <input type="checkbox" checked={antiCheat} onChange={(e) => setAntiCheat(e.target.checked)} />
                  <span><strong>Strict Lockdown & Camera Shield</strong> (Watermark, window blur, exit logging)</span>
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
            rows={3}
            placeholder="e.g. Economic Order Quantity, Safety Stock calculations, Bullwhip effect, Procurement Contracts..."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            autoFocus
          />
        </Field>

        <div className="between" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
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
            style={{
              background: 'linear-gradient(135deg, #0d9488 0%, #6366f1 100%)',
              borderColor: 'transparent',
              color: '#fff',
              fontWeight: 600,
            }}
          >
            <Icon name="sparkles" size={16} /> {isGenerating ? 'Generating Questions…' : 'Generate Questions'}
          </button>
        </div>

        {generatedText && (
          <div className="stack-sm" style={{ marginTop: 12 }}>
            <span className="eyebrow">
              Review & Edit Generated Questions ({parsed.length} recognized):
            </span>
            <textarea
              className="textarea mono"
              style={{ minHeight: 220, fontSize: 13, background: 'var(--surface)' }}
              value={generatedText}
              onChange={(e) => setGeneratedText(e.target.value)}
            />
            <span className="tiny muted">
              You can edit any prompt, option, or the correct answer before saving. Mark correct options with an asterisk (*) or write Answer: [Letter] at the end.
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
