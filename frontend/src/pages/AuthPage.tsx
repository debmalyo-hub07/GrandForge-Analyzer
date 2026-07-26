import { useState, useCallback, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User as UserIcon, LogIn, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Header } from '../components/layout/Header';
import { Footer } from '../components/layout/Footer';
import Tabs, { type TabItem } from '../components/ui/Tabs';
import Button from '../components/ui/Button';
import { auth as authApi, setAuthToken } from '../services/apiClient';

type Mode = 'login' | 'register';

interface AuthResponse {
  user: { _id: string; email: string; username: string };
  token: string;
}

function FormField({
  label,
  type,
  value,
  onChange,
  icon,
  autoComplete,
  required = true,
  minLength,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  icon: React.ReactNode;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
        {label}
      </span>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
          {icon}
        </span>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          className="w-full h-10 pl-10 pr-3 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold)] transition-colors"
        />
      </div>
    </label>
  );
}

export function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const tabs: TabItem[] = [
    { id: 'login', label: 'Log in', icon: <LogIn size={14} /> },
    { id: 'register', label: 'Create account', icon: <UserPlus size={14} /> },
  ];

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setSubmitting(true);
      try {
        const res: AuthResponse =
          mode === 'login'
            ? await authApi.login({ email, password })
            : await authApi.register({ email, username, password });

        setAuthToken(res.token);
        toast.success(
          mode === 'login' ? `Welcome back, ${res.user.username}` : `Welcome, ${res.user.username}`
        );
        navigate('/');
      } catch (err) {
        const message =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          (mode === 'login' ? 'Login failed' : 'Registration failed');
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
    },
    [mode, email, username, password, submitting, navigate]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Header />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="text-3xl text-[var(--gold)] mb-2" aria-hidden>
              ♟
            </div>
            <h1
              className="font-display text-2xl font-semibold text-[var(--text-primary)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Welcome to <span className="text-[var(--gold)]">GrandForge</span>
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Save sessions, review your games, and forge your craft.
            </p>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
            <Tabs
              tabs={tabs}
              activeId={mode}
              onChange={(id) => setMode(id as Mode)}
              fullWidth
              size="md"
            />

            <form onSubmit={onSubmit} className="p-5 flex flex-col gap-4">
              <FormField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                icon={<Mail size={14} />}
                autoComplete="email"
              />

              {mode === 'register' && (
                <FormField
                  label="Username"
                  type="text"
                  value={username}
                  onChange={setUsername}
                  icon={<UserIcon size={14} />}
                  autoComplete="username"
                  minLength={3}
                />
              )}

              <FormField
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                icon={<Lock size={14} />}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'register' ? 8 : undefined}
              />

              <Button
                type="submit"
                variant="primary"
                size="md"
                fullWidth
                loading={submitting}
                disabled={submitting}
              >
                {mode === 'login' ? 'Log in' : 'Create account'}
              </Button>

              <div className="text-center text-xs text-[var(--text-secondary)]">
                <Link to="/" className="hover:text-[var(--text-primary)] underline-offset-2 hover:underline">
                  Continue without an account
                </Link>
              </div>
            </form>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default AuthPage;
