import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { Layout } from './components/Layout.jsx';
import { SignIn } from './pages/SignIn.jsx';
import { MyApplications, NewApplication } from './pages/ApplicantPages.jsx';
import { ApplicationDetail } from './pages/ApplicationDetail.jsx';
import { AssessorWorkspace, TriageQueue, AllApplications, ModeratorWorkspace } from './pages/StaffPages.jsx';
import { People, ActivityLog } from './pages/AdminPeople.jsx';
import './index.css';

const LANDING = {
  APPLICANT: '/applications',
  ASSESSOR: '/assess',
  MODERATOR: '/moderate',
  ADMINISTRATOR: '/admin',
};

/**
 * Route guarding is a usability affordance. It decides which workspace to
 * render; it is not the mechanism by which access is restricted. Every
 * decision that matters is enforced server-side in middleware.
 */
function Protected({ roles, children }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={LANDING[user.role] ?? '/applications'} replace />;
  }
  return children;
}

function Root() {
  const { user } = useAuth();
  return <Navigate to={user ? LANDING[user.role] ?? '/applications' : '/login'} replace />;
}

function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Root /> : <SignIn />} />

      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/applications" element={
          <Protected roles={['APPLICANT']}><MyApplications /></Protected>
        } />
        <Route path="/applications/new" element={
          <Protected roles={['APPLICANT']}><NewApplication /></Protected>
        } />
        <Route path="/applications/:id" element={<ApplicationDetail />} />

        <Route path="/assess" element={
          <Protected roles={['ASSESSOR']}><AssessorWorkspace /></Protected>
        } />

        <Route path="/admin" element={
          <Protected roles={['ADMINISTRATOR']}><TriageQueue /></Protected>
        } />
        <Route path="/admin/all" element={
          <Protected roles={['ADMINISTRATOR']}><AllApplications /></Protected>
        } />
        <Route path="/moderate" element={
          <Protected roles={['MODERATOR']}><ModeratorWorkspace /></Protected>
        } />

        <Route path="/admin/users" element={
          <Protected roles={['ADMINISTRATOR']}><People /></Protected>
        } />
        <Route path="/admin/activity" element={
          <Protected roles={['ADMINISTRATOR']}><ActivityLog /></Protected>
        } />
      </Route>

      <Route path="*" element={<Root />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
