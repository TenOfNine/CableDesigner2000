import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, Link } from 'react-router-dom';
import { api } from './api.js';
import { t, setLang } from './i18n/index.js';
import { LoginPage, SetupPage } from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Library from './pages/Library.jsx';
import Admin from './pages/Admin.jsx';
import Account from './pages/Account.jsx';
import Editor from './editor/Editor.jsx';
import { Dropdown, MenuButton } from './components/ui.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);
export const APP_NAME = 'CableDesigner2000';

export default function App() {
  const [state, setState] = useState({ loading: true, user: null, needsSetup: false });

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get('/auth/me');
      setState({ loading: false, user, needsSetup: false });
      if (user.language) setLang(user.language);
    } catch {
      let needsSetup = false;
      try {
        needsSetup = (await api.get('/auth/setup')).needsSetup;
      } catch {
        /* ignore */
      }
      setState({ loading: false, user: null, needsSetup });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (state.loading) return <div className="auth-wrap muted">{t('Loading …')}</div>;

  if (!state.user) {
    return (
      <AuthCtx.Provider value={{ ...state, refresh }}>
        {state.needsSetup ? <SetupPage onDone={refresh} /> : <LoginPage onDone={refresh} />}
      </AuthCtx.Provider>
    );
  }

  return (
    <AuthCtx.Provider value={{ ...state, refresh }}>
      <Routes>
        <Route path="/harness/:id" element={<Editor />} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </AuthCtx.Provider>
  );
}

function Shell() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    await refresh();
    navigate('/');
  };
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" />
          {APP_NAME}
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            {t('Projects')}
          </NavLink>
          <NavLink to="/library">{t('Library')}</NavLink>
          {user.isAdmin && <NavLink to="/admin">{t('Administration')}</NavLink>}
        </nav>
        <div className="spacer" />
        <Dropdown label={<>👤 {user.displayName}</>} buttonClass="ghost">
          <MenuButton icon="⚙" onClick={() => navigate('/account')}>
            {t('My account')}
          </MenuButton>
          <MenuButton icon="⎋" onClick={logout}>
            {t('Sign out')}
          </MenuButton>
        </Dropdown>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/:projectId" element={<Dashboard />} />
          <Route path="/library" element={<Library />} />
          <Route path="/account" element={<Account />} />
          {user.isAdmin && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
