import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV_BY_ROLE = {
  APPLICANT: [
    { to: '/applications', label: 'My applications' },
    { to: '/applications/new', label: 'Start an application' },
  ],
  ASSESSOR: [{ to: '/assess', label: 'Allocated to me' }],
  MODERATOR: [{ to: '/moderate', label: 'For moderation' }],
  ADMINISTRATOR: [
    { to: '/admin', label: 'Triage queue' },
    { to: '/admin/all', label: 'All applications' },
    { to: '/admin/users', label: 'People' },
    { to: '/admin/activity', label: 'Account activity' },
  ],
};

const ROLE_CAPTION = {
  APPLICANT: 'Applicant',
  ASSESSOR: 'Assessor',
  MODERATOR: 'Moderator',
  ADMINISTRATOR: 'Registrar',
};

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const links = NAV_BY_ROLE[user.role] ?? [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-leaf">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[19px]">RPL Register</span>
            <span className="hidden text-[13px] text-ink-soft sm:inline">
              Recognition of Prior Learning
            </span>
          </div>

          <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Main">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/applications' || l.to === '/admin'}
                className={({ isActive }) =>
                  `border-b-2 pb-0.5 text-[14px] ${
                    isActive
                      ? 'border-seal text-ink'
                      : 'border-transparent text-ink-soft hover:text-ink'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4 text-[13px]">
            <span className="text-ink-soft">
              {user.first_name} {user.surname}
              <span className="text-[#9aa6b1]"> &middot; {ROLE_CAPTION[user.role]}</span>
            </span>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="text-ink-soft underline underline-offset-4 hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <Outlet />
      </main>
    </div>
  );
}
