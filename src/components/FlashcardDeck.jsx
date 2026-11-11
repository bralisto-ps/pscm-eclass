import { useEffect, useState } from 'react';
import { fillVars, fmtNumber } from '../lib/format.js';
import { rpc } from '../lib/supabase.js';
import Icon from './Icon.jsx';
import { Modal, Loading, ErrorNote, useLoad } from './ui.jsx';

const LETTERS = 'ABCDEFGHIJ';

export default function FlashcardDeckModal({ quiz, attemptId, questions: initialQuestions, onClose }) {
  const { data: loadedData, error, loading } = useLoad(async () => {
    if (initialQuestions && initialQuestions.length > 0) {
      return { title: quiz?.title || 'Quiz Revision', questions: initialQuestions };
    }
    if (attemptId) {
      const rev = await rpc('get_attempt_review', { p_attempt: attemptId });
      return { title: rev.title || quiz?.title || 'Quiz Revision', questions: rev.questions || [] };
    }
    if (quiz?.id) {
      if (quiz.best?.attempt_id) {
        const rev = await rpc('get_attempt_review', { p_attempt: quiz.best.attempt_id });
        return { title: rev.title || quiz.title, questions: rev.questions || [] };
      }
      if (quiz.is_practice) {
        try {
          const aid = await rpc('start_attempt', { p_quiz: quiz.id });
          await rpc('submit_attempt', { p_attempt: aid });
          const rev = await rpc('get_attempt_review', { p_attempt: aid });
          return { title: rev.title || quiz.title, questions: rev.questions || [] };
        } catch (e) {
          console.warn('Practice attempt review init failed:', e);
        }
      }
    }
    return { title: quiz?.title || 'Quiz Revision', questions: [] };
  }, [quiz?.id, attemptId]);

  if (loading) {
    return (
      <Modal title="Loading Flashcards…" onClose={onClose} wide>
        <Loading label="Preparing active-recall revision deck…" />
      </Modal>
    );
  }

  if (error) {
    return (
      <Modal title="Revision Flashcards" onClose={onClose}>
        <ErrorNote error={error} />
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }

  const questions = loadedData?.questions || [];
  if (questions.length === 0) {
    return (
      <Modal title="Flashcard Revision" onClose={onClose}>
        <div className="card-soft stack-sm" style={{ padding: 24, textAlign: 'center' }}>
          <Icon name="layers" size={32} style={{ color: 'var(--teal)', margin: '0 auto' }} />
          <h3>No questions available for this deck yet</h3>
          <p className="small muted">
            Flashcards become available once the quiz results are released by your lecturer or on practice quizzes.
          </p>
        </div>
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }

  return <DeckCore title={loadedData.title} initialList={questions} onClose={onClose} />;
}

function DeckCore({ title, initialList, onClose }) {
  const [deck, setDeck] = useState(() => initialList.map((q, idx) => ({ ...q, originalIndex: idx })));
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [masteredIds, setMasteredIds] = useState(() => new Set());
  const [reviewIds, setReviewIds] = useState(() => new Set());
  const [selectedGuess, setSelectedGuess] = useState(null);
  const [isCompleted, setIsCompleted] = useState(false);

  const card = deck[currentIdx];

  useEffect(() => {
    setIsFlipped(false);
    setSelectedGuess(null);
  }, [currentIdx, deck]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setIsFlipped((f) => !f);
      } else if (e.key === 'ArrowLeft' || e.key === '1') {
        e.preventDefault();
        markCard(false);
      } else if (e.key === 'ArrowRight' || e.key === '2') {
        e.preventDefault();
        markCard(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [card, isCompleted, currentIdx, deck.length]);

  function markCard(mastered) {
    if (!card) return;
    const cid = card.id || card.originalIndex;
    if (mastered) {
      setMasteredIds((prev) => {
        const next = new Set(prev);
        next.add(cid);
        return next;
      });
      setReviewIds((prev) => {
        const next = new Set(prev);
        next.delete(cid);
        return next;
      });
    } else {
      setReviewIds((prev) => {
        const next = new Set(prev);
        next.add(cid);
        return next;
      });
      setMasteredIds((prev) => {
        const next = new Set(prev);
        next.delete(cid);
        return next;
      });
    }

    if (currentIdx + 1 < deck.length) {
      setCurrentIdx((c) => c + 1);
    } else {
      setIsCompleted(true);
    }
  }

  function shuffleDeck() {
    const shuffled = [...deck].sort(() => Math.random() - 0.5);
    setDeck(shuffled);
    setCurrentIdx(0);
    setIsCompleted(false);
  }

  function restartAll() {
    setDeck(initialList.map((q, idx) => ({ ...q, originalIndex: idx })));
    setCurrentIdx(0);
    setMasteredIds(new Set());
    setReviewIds(new Set());
    setIsCompleted(false);
  }

  function restartMissedOnly() {
    const missed = initialList.filter((q, idx) => reviewIds.has(q.id || idx));
    if (missed.length === 0) return restartAll();
    setDeck(missed.map((q, idx) => ({ ...q, originalIndex: idx })));
    setCurrentIdx(0);
    setIsCompleted(false);
  }

  const promptText = card ? fillVars(card.prompt, card.vars) : '';
  const totalCards = deck.length;

  if (isCompleted) {
    const masteredCount = initialList.filter((q, idx) => masteredIds.has(q.id || idx)).length;
    const reviewCount = initialList.length - masteredCount;
    const finalPct = Math.round((masteredCount / initialList.length) * 100);

    return (
      <Modal title={`Revision Complete · ${title}`} onClose={onClose} wide>
        <div className="stack" style={{ textAlign: 'center', padding: '24px 16px' }}>
          <div style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: finalPct >= 70 ? 'var(--teal-50)' : 'var(--amber-50)',
            color: finalPct >= 70 ? 'var(--teal)' : 'var(--amber-ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto',
            border: `2px solid ${finalPct >= 70 ? 'var(--teal)' : 'var(--amber)'}`
          }}>
            <Icon name={finalPct >= 70 ? 'award' : 'refresh'} size={36} />
          </div>

          <h2 style={{ fontSize: 24, marginTop: 8 }}>
            {finalPct === 100 ? 'Exceptional! 100% Mastered' : finalPct >= 75 ? 'Great Job! Strong Mastery' : 'Good Session! Keep Practicing'}
          </h2>
          <p className="muted" style={{ maxWidth: 480, margin: '0 auto' }}>
            Active recall and spaced repetition strengthen long-term memory retention for exams.
          </p>

          <div className="grid-3" style={{ maxWidth: 560, margin: '20px auto 10px', width: '100%' }}>
            <div className="kpi">
              <span className="l">Mastered</span>
              <span className="v" style={{ color: 'var(--teal)' }}>{masteredCount}</span>
            </div>
            <div className="kpi">
              <span className="l">Need Review</span>
              <span className="v" style={{ color: reviewCount ? 'var(--amber-ink)' : 'inherit' }}>{reviewCount}</span>
            </div>
            <div className="kpi">
              <span className="l">Mastery Rate</span>
              <span className="v">{finalPct}%</span>
            </div>
          </div>

          <div className="row" style={{ justifyContent: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            {reviewCount > 0 && (
              <button type="button" className="btn btn-primary" onClick={restartMissedOnly}>
                <Icon name="refresh" size={16} /> Review Missed Cards ({reviewCount})
              </button>
            )}
            <button type="button" className="btn" onClick={restartAll}>
              <Icon name="refresh" size={16} /> Restart Full Deck
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <Icon name="layers" size={18} style={{ color: 'var(--teal)' }} />
          <span>{title} · Active Recall Flashcards</span>
        </div>
      }
      onClose={onClose}
      wide
      footer={
        <div className="between" style={{ width: '100%', flexWrap: 'wrap', gap: 10 }}>
          <div className="row small muted hide-sm" style={{ gap: 14 }}>
            <span><kbd className="kbd">Space</kbd> Flip</span>
            <span><kbd className="kbd">1</kbd> or <kbd className="kbd">←</kbd> Need Review</span>
            <span><kbd className="kbd">2</kbd> or <kbd className="kbd">→</kbd> Mastered</span>
          </div>
          <div className="row" style={{ gap: 10, marginLeft: 'auto' }}>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => markCard(false)}
              title="Still learning this concept"
            >
              <Icon name="close" size={14} /> Need Review [1]
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setIsFlipped((f) => !f)}
            >
              <Icon name="refresh" size={14} /> {isFlipped ? 'Show Question' : 'Flip to Answer'}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => markCard(true)}
              title="I know this topic well"
            >
              <Icon name="check" size={14} /> Mastered! [2]
            </button>
          </div>
        </div>
      }
    >
      <div className="stack-sm" style={{ marginBottom: 4 }}>
        <div className="between small">
          <span className="mono strong">
            Card {currentIdx + 1} of {totalCards}
          </span>
          <div className="row" style={{ gap: 12 }}>
            <span className="tiny muted">
              <strong style={{ color: 'var(--teal)' }}>{masteredIds.size}</strong> mastered ·{' '}
              <strong style={{ color: 'var(--amber-ink)' }}>{reviewIds.size}</strong> review
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ minHeight: 28, padding: '0 8px', fontSize: 12 }}
              onClick={shuffleDeck}
              title="Shuffle remaining questions"
            >
              <Icon name="refresh" size={12} /> Shuffle
            </button>
          </div>
        </div>
        <div className="bar-track" style={{ height: 6 }}>
          <div
            className="bar-fill"
            style={{
              width: `${Math.max(4, Math.round(((currentIdx + 1) / totalCards) * 100))}%`,
              background: 'linear-gradient(90deg, var(--teal), #14b8a6)',
            }}
          />
        </div>
      </div>

      <div
        className={`flashcard-scene ${isFlipped ? 'is-flipped' : ''}`}
        onClick={() => setIsFlipped((f) => !f)}
        role="button"
        tabIndex={0}
        aria-label="Flashcard. Click or press space to flip between question and answer."
      >
        <div className="flashcard-inner">
          <div className="flashcard-face flashcard-front">
            <div className="between" style={{ width: '100%', marginBottom: 12 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge-teal">Question {currentIdx + 1}</span>
                <span className="badge" style={{ textTransform: 'capitalize' }}>
                  {card.kind === 'mcq' ? 'Multiple Choice' : card.kind === 'truefalse' ? 'True / False' : card.kind === 'numeric' ? 'Numerical' : card.kind}
                </span>
              </div>
              {card.marks && <span className="small muted mono">{fmtNumber(card.marks)} mark{card.marks > 1 ? 's' : ''}</span>}
            </div>

            <div className="flashcard-prompt">
              {promptText}
            </div>

            {(card.kind === 'mcq' || card.kind === 'truefalse') && Array.isArray(card.options) && (
              <div className="stack-sm" style={{ width: '100%', marginTop: 16 }} onClick={(e) => e.stopPropagation()}>
                <span className="tiny muted uppercase" style={{ letterSpacing: '0.05em' }}>Options (Pick your answer, then flip):</span>
                {card.options.map((opt, k) => {
                  const isGuessed = selectedGuess === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`option ${isGuessed ? 'selected' : ''}`}
                      style={{ padding: '8px 12px', minHeight: 40, fontSize: 14 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedGuess(opt.id);
                      }}
                    >
                      <span className="letter" style={{ width: 24, height: 24, fontSize: 12 }}>
                        {card.kind === 'truefalse' ? (opt.id === 'true' ? 'T' : 'F') : LETTERS[k]}
                      </span>
                      <span style={{ flex: 1, textAlign: 'left' }}>{opt.text}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flashcard-flip-hint">
              <Icon name="refresh" size={14} /> Click card or press [Space] to reveal answer & explanation
            </div>
          </div>

          <div className="flashcard-face flashcard-back">
            <div className="between" style={{ width: '100%', marginBottom: 12 }}>
              <span className="badge badge-teal" style={{ background: 'var(--teal-50)', color: 'var(--teal-dark)', fontWeight: 700 }}>
                ✓ Solution & Explanation
              </span>
              <span className="small muted">Question {currentIdx + 1}</span>
            </div>

            <div className="card-soft stack-sm" style={{ padding: '14px 18px', background: 'var(--teal-50)', border: '1px solid #bbf7d0' }}>
              <span className="eyebrow" style={{ color: 'var(--teal-dark)' }}>Correct Answer</span>
              {(card.kind === 'mcq' || card.kind === 'truefalse') && (
                <div className="strong" style={{ fontSize: 16, color: 'var(--text)' }}>
                  {(() => {
                    const corr = card.options?.find((o) => o.id === card.correct);
                    if (!corr) return String(card.correct ?? 'See explanation');
                    return `${corr.text}`;
                  })()}
                </div>
              )}
              {card.kind === 'numeric' && (
                <div className="mono strong" style={{ fontSize: 18, color: 'var(--teal-dark)' }}>
                  {fmtNumber(card.correct, 6)} {card.unit || ''}
                </div>
              )}
              {card.kind === 'short' && (
                <div className="strong" style={{ fontSize: 16, color: 'var(--teal-dark)' }}>
                  {Array.isArray(card.correct) ? card.correct.join(' · ') : String(card.correct)}
                </div>
              )}
              {card.kind === 'essay' && (
                <div className="small muted">
                  Essay / Descriptive question. Review marking guide and model criteria below.
                </div>
              )}
            </div>

            {card.explanation ? (
              <div className="stack-sm" style={{ marginTop: 14 }}>
                <span className="eyebrow">Explanation & Working</span>
                <p className="pre small" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
                  {card.explanation}
                </p>
              </div>
            ) : (
              <p className="tiny muted" style={{ marginTop: 12 }}>
                (No additional explanation notes attached by instructor for this item)
              </p>
            )}

            {card.feedback && (
              <div className="notice notice-info small" style={{ marginTop: 12 }}>
                <strong>Instructor Feedback:</strong> {card.feedback}
              </div>
            )}

            <div className="flashcard-flip-hint">
              <Icon name="refresh" size={14} /> Click card to flip back to question
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
