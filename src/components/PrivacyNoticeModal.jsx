import { Modal } from './ui.jsx';

export default function PrivacyNoticeModal({ onClose }) {
  return (
    <Modal
      title="Privacy & Academic Integrity Notice"
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close</button>}
    >
      <div className="stack-sm small" style={{ lineHeight: 1.65 }}>
        <p style={{ margin: 0 }}>
          <strong>PSCM E-class</strong> processes institutional course records solely for teaching,
          continuous assessment, attendance verification, and academic governance.
        </p>
        <ul className="stack-sm" style={{ margin: '4px 0', paddingLeft: 18 }}>
          <li><strong>Account &amp; Roster Data:</strong> Student index numbers, names, programmes, streams, and assessment marks are visible only to enrolled students (their own scores) and authorized course staff.</li>
          <li><strong>Quiz Security &amp; Proctoring:</strong> Where enabled on an assessment, tab/focus exit counts and periodic proctoring snapshots are stored strictly for exam integrity review by the course lecturer and external examiner.</li>
          <li><strong>Hall Attendance Checks:</strong> When GPS geofence verification is enabled on an attendance session, your coordinates are checked solely at check-in time to verify hall proximity.</li>
          <li><strong>Corrections &amp; Support:</strong> Contact your course coordinator if your name, index number, or personal record requires correction.</li>
        </ul>
      </div>
    </Modal>
  );
}
