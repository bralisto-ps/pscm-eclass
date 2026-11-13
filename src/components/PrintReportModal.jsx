import { useRef } from 'react';
import Icon from './Icon.jsx';
import { Modal } from './ui.jsx';

export default function PrintReportModal({ title, html, onClose }) {
  const frameRef = useRef(null);

  function printNow() {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={printNow}>
            <Icon name="file" size={16} /> Print / Save as PDF
          </button>
        </>
      }
    >
      <div className="stack-sm">
        <p className="small muted" style={{ margin: 0 }}>
          Preview below. Click <strong>Print / Save as PDF</strong> and choose <strong>Save as PDF</strong> as your destination if exporting a PDF file.
        </p>
        <iframe
          ref={frameRef}
          title={title}
          srcDoc={html}
          style={{
            width: '100%',
            height: '62vh',
            border: '1px solid var(--line)',
            borderRadius: 10,
            background: '#fff',
          }}
        />
      </div>
    </Modal>
  );
}
