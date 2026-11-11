import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { rpc } from '../../lib/supabase.js';
import { fillVars, fmtNumber, pct } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import { ErrorNote, Loading, useLoad } from '../../components/ui.jsx';
import FlashcardDeckModal from '../../components/FlashcardDeck.jsx';

const LETTERS = 'ABCDEFGHIJ';

function shown(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  return String(v);
}

export default function ReviewQuiz() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => rpc('get_attempt_review', { p_attempt: attemptId }), [attemptId]);
  const [showFlashcards, setShowFlashcards] = useState(false);

  return (
    <>
      <Topbar title={data ? data.title : 'Quiz review'} sub="Your answers & revision">
        <div className="row" style={{ gap: 8 }}>
          {data?.questions?.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowFlashcards(true)}
              title="Practice these questions with interactive flip cards"
            >
              <Icon name="layers" size={16} /> Study as Flashcards
            </button>
          )}
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            <Icon name="chevronLeft" /> Back
          </button>
        </div>
      </Topbar>

      <div className="page page-narrow stack">
        {loading && <Loading />}
        <ErrorNote error={error} onRetry={reload} />
        {data && (
          <>
            <div className="card between" style={{ flexWrap: 'wrap' }}>
              <div className="stack-sm">
                <span className="eyebrow">Your score</span>
                <span className="mono" style={{ fontSize: 28 }}>
                  {fmtNumber(data.score)} / {fmtNumber(data.max_score)}
                </span>
              </div>
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                <span className="badge badge-teal" style={{ fontSize: 16, padding: '6px 14px' }}>
                  {pct(data.score, data.max_score)}%
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setShowFlashcards(true)}
                >
                  <Icon name="layers" size={14} /> Flashcard Mode
                </button>
              </div>
              {data.status === 'needs_marking' && (
                <p className="small muted" style={{ width: '100%' }}>
                  Some written answers are still being marked; your score may go up.
                </p>
              )}
            </div>

            {data.questions.map((q, i) => {
              const mine = shown(q.value);
              const correctIds = q.correct !== null && q.correct !== undefined ? q.correct : null;
              return (
                <article key={q.id} className="card stack">
                  <div className="between" style={{ flexWrap: 'wrap' }}>
                    <span className="eyebrow">Question {i + 1}</span>
                    <span
                      className={`badge ${
                        q.marks_awarded === null
                          ? 'badge-amber'
                          : Number(q.marks_awarded) >= Number(q.marks)
                          ? 'badge-teal'
                          : Number(q.marks_awarded) > 0
                          ? 'badge-amber'
                          : 'badge-red'
                      }`}
                    >
                      {q.marks_awarded === null
                        ? 'Being marked'
                        : `${fmtNumber(q.marks_awarded)} / ${fmtNumber(q.marks)}`}
                    </span>
                  </div>
                  <p className="pre" style={{ fontSize: 16 }}>
                    {fillVars(q.prompt, q.vars)}
                  </p>
                  {(q.kind === 'mcq' || q.kind === 'truefalse') && (
                    <div className="stack-sm">
                      {q.options.map((o, k) => {
                        const isMine = mine === o.id;
                        const isRight = correctIds === o.id;
                        return (
                          <div
                            key={o.id}
                            className={`option ${isRight ? 'correct' : isMine ? 'wrong' : ''}`}
                            style={{ cursor: 'default' }}
                          >
                            <span className="letter">
                              {q.kind === 'truefalse' ? (o.id === 'true' ? 'T' : 'F') : LETTERS[k]}
                            </span>
                            <span style={{ flex: 1 }}>{o.text}</span>
                            {isMine && <span className="tiny strong">Your answer</span>}
                            {isRight && !isMine && <span className="tiny strong">Correct answer</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {q.kind !== 'mcq' && q.kind !== 'truefalse' && (
                    <div className="stack-sm">
                      <span className="eyebrow">Your answer</span>
                      <p className={q.kind === 'essay' ? 'pre' : 'mono'}>
                        {mine ?? <span className="muted">No answer</span>} {mine && q.unit}
                      </p>
                      {correctIds !== null && q.kind === 'numeric' && (
                        <p className="small">
                          Correct answer: <span className="mono strong">{fmtNumber(correctIds, 6)} {q.unit}</span>
                        </p>
                      )}
                      {correctIds !== null && q.kind === 'short' && Array.isArray(correctIds) && (
                        <p className="small">
                          Accepted answers: <strong>{correctIds.join(' · ')}</strong>
                        </p>
                      )}
                    </div>
                  )}
                  {q.feedback && (
                    <div className="notice notice-info">
                      <strong>Lecturer:</strong> {q.feedback}
                    </div>
                  )}
                  {q.explanation && (
                    <div className="stack-sm">
                      <span className="eyebrow">Explanation</span>
                      <p className="pre small" style={{ color: 'var(--text-2)' }}>
                        {q.explanation}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </>
        )}
      </div>

      {showFlashcards && data && (
        <FlashcardDeckModal
          quiz={{ title: data.title }}
          questions={data.questions}
          onClose={() => setShowFlashcards(false)}
        />
      )}
    </>
  );
}
