import { useState } from 'react';
import { questionImageUrl } from '../lib/questionMedia.js';
import { Modal } from './ui.jsx';

export default function QuestionDiagram({ imagePath, maxHeight = 280, compact = false }) {
  const [zoomed, setZoomed] = useState(false);
  const url = questionImageUrl(imagePath);
  if (!url) return null;

  return (
    <>
      <div
        style={{
          marginTop: compact ? 6 : 10,
          marginBottom: compact ? 6 : 10,
          display: 'inline-block',
          maxWidth: '100%',
        }}
        onClick={(e) => {
          e.stopPropagation();
          setZoomed(true);
        }}
      >
        <img
          src={url}
          alt="Question diagram"
          loading="lazy"
          style={{
            display: 'block',
            maxWidth: '100%',
            maxHeight,
            objectFit: 'contain',
            borderRadius: 8,
            border: '1px solid var(--line-2)',
            background: '#fff',
            cursor: 'zoom-in',
          }}
        />
        <span className="tiny muted" style={{ display: 'block', marginTop: 3 }}>
          Click diagram to enlarge
        </span>
      </div>
      {zoomed && (
        <Modal title="Question diagram" onClose={() => setZoomed(false)} wide>
          <div style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <img
              src={url}
              alt="Question diagram enlarged"
              style={{
                maxWidth: '100%',
                maxHeight: '75vh',
                objectFit: 'contain',
                borderRadius: 8,
                background: '#fff',
              }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
