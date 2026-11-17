import { parseCourseMeta, hasCourseInfo } from '../lib/courseMeta.js';
import Icon from './Icon.jsx';

export default function CourseInfoCard({ course }) {
  const meta = parseCourseMeta(course);
  if (!hasCourseInfo(meta)) return null;
  const info = meta.course_info || {};

  return (
    <div className="card stack-sm" aria-label="Course information and schedule">
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Icon name="calendar" size={16} style={{ color: 'var(--teal-dark)' }} />
        <strong>Course Info &amp; Timetable</strong>
      </div>
      {meta.about && (
        <p className="small pre" style={{ margin: 0, color: 'var(--text-2)' }}>
          {meta.about}
        </p>
      )}
      {info.venue && (
        <div className="row small" style={{ gap: 8, alignItems: 'flex-start', paddingTop: 4, borderTop: '1px solid var(--line-2)' }}>
          <Icon name="map-pin" size={14} style={{ color: 'var(--muted)', marginTop: 2, flexShrink: 0 }} />
          <div>
            <div className="tiny muted">Lecture venue</div>
            <div className="strong">{info.venue}</div>
          </div>
        </div>
      )}
      {info.schedule && (
        <div className="row small" style={{ gap: 8, alignItems: 'flex-start', paddingTop: 4, borderTop: '1px solid var(--line-2)' }}>
          <Icon name="clock" size={14} style={{ color: 'var(--muted)', marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div className="tiny muted">Lecture times</div>
            <div className="pre">{info.schedule}</div>
          </div>
        </div>
      )}
      {info.officeHours && (
        <div className="row small" style={{ gap: 8, alignItems: 'flex-start', paddingTop: 4, borderTop: '1px solid var(--line-2)' }}>
          <Icon name="chat" size={14} style={{ color: 'var(--muted)', marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div className="tiny muted">Office hours</div>
            <div className="pre">{info.officeHours}</div>
          </div>
        </div>
      )}
      {info.syllabusNote && (
        <div className="row small" style={{ gap: 8, alignItems: 'flex-start', paddingTop: 4, borderTop: '1px solid var(--line-2)' }}>
          <Icon name="book" size={14} style={{ color: 'var(--muted)', marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div className="tiny muted">Key note</div>
            <div className="pre">{info.syllabusNote}</div>
          </div>
        </div>
      )}
    </div>
  );
}
