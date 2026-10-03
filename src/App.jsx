import { Navigate, Route, Routes } from 'react-router-dom';
import { isConfigured } from './lib/supabase.js';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider, Loading } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Account from './pages/Account.jsx';
import StudentHome from './pages/student/Home.jsx';
import StudentCourse from './pages/student/Course.jsx';
import TakeQuiz from './pages/student/TakeQuiz.jsx';
import ReviewQuiz from './pages/student/ReviewQuiz.jsx';
import Grades from './pages/student/Grades.jsx';
import Dashboard from './pages/lecturer/Dashboard.jsx';
import ManageCourse from './pages/lecturer/ManageCourse.jsx';
import QuizBuilder from './pages/lecturer/QuizBuilder.jsx';
import QuizResults from './pages/lecturer/QuizResults.jsx';
import AssignmentMarking from './pages/lecturer/AssignmentMarking.jsx';

function NotConfigured() {
  return (
    <div className="auth-main" style={{ minHeight: '100vh' }}>
      <div className="card stack" style={{ maxWidth: 560 }}>
        <h1>PSCM E-class is almost ready</h1>
        <p className="muted">
          The site cannot find its connection settings. Add <span className="mono">VITE_SUPABASE_URL</span>,{' '}
          <span className="mono">VITE_SUPABASE_ANON_KEY</span> and <span className="mono">VITE_STUDENT_EMAIL_BASE</span>{' '}
          as environment variables (see SETUP.md, step 5), then redeploy.
        </p>
      </div>
    </div>
  );
}

function Gate() {
  const { session, profile, loading, profileError, isLecturer, isStaff, signOut } = useAuth();
  if (loading) return <Loading label="Opening PSCM E-class…" />;

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login mode="signin" />} />
        <Route path="/activate" element={<Login mode="activate" />} />
        <Route path="/staff" element={<Login mode="staff" />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!profile) {
    return (
      <div className="auth-main" style={{ minHeight: '100vh' }}>
        <div className="card stack" style={{ maxWidth: 480 }}>
          <h1>Account not ready</h1>
          <p className="muted">{profileError || 'Loading your profile…'}</p>
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {!isStaff && <Route path="/quiz/:attemptId" element={<TakeQuiz />} />}
      <Route element={<Layout />}>
        {isStaff ? (
          <>
            <Route index element={<Dashboard />} />
            <Route path="teach/course/:courseId" element={<ManageCourse />} />
            {isLecturer && <Route path="teach/quiz/:quizId" element={<QuizBuilder />} />}
            <Route path="teach/quiz/:quizId/results" element={<QuizResults />} />
            <Route path="teach/assignment/:assignmentId" element={<AssignmentMarking />} />
          </>
        ) : (
          <>
            <Route index element={<StudentHome />} />
            <Route path="course/:courseId" element={<StudentCourse />} />
            <Route path="review/:attemptId" element={<ReviewQuiz />} />
            <Route path="grades" element={<Grades />} />
          </>
        )}
        <Route path="account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  if (!isConfigured) return <NotConfigured />;
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
