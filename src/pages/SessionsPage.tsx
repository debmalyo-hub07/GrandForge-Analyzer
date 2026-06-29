import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, BookOpen, Calendar, ChevronRight, FilePlus2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Header } from '../components/layout/Header';
import { Footer } from '../components/layout/Footer';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { sessions as sessionsApi, getAuthToken } from '../services/apiClient';

interface SessionItem {
  _id: string;
  title?: string;
  openingName?: string;
  result?: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: { white?: string; black?: string; opening?: string; result?: string };
}

interface SessionsResponse {
  sessions: SessionItem[];
  page?: number;
  total?: number;
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function SessionCard({
  session,
  onOpen,
  onDelete,
}: {
  session: SessionItem;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const title = session.title?.trim() || 'Untitled session';
  const opening = session.openingName || session.metadata?.opening || 'Unknown opening';
  const result = session.result || session.metadata?.result;
  const matchup =
    session.metadata?.white && session.metadata?.black
      ? `${session.metadata.white} vs ${session.metadata.black}`
      : null;

  return (
    <div className="group relative flex flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--gold-dim)] transition-colors overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        className="text-left p-4 flex-1 flex flex-col gap-2"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg font-medium text-[var(--text-primary)] line-clamp-2">
            {title}
          </h3>
          <ChevronRight
            size={16}
            className="text-[var(--text-muted)] group-hover:text-[var(--gold)] transition-colors flex-shrink-0 mt-1"
          />
        </div>

        {matchup && (
          <div className="text-xs text-[var(--text-secondary)] truncate">{matchup}</div>
        )}

        <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <BookOpen size={12} className="flex-shrink-0" />
          <span className="truncate">{opening}</span>
        </div>

        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Calendar size={11} />
            <span>{formatDate(session.createdAt)}</span>
          </div>
          {result && (
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
              {result}
            </span>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete session"
        title="Delete"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--blunder)] text-[var(--text-secondary)] hover:text-white border border-[var(--border)]"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export function SessionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAuthed = Boolean(getAuthToken());
  const [pendingDelete, setPendingDelete] = useState<SessionItem | null>(null);

  const { data, isLoading, isError } = useQuery<SessionsResponse>({
    queryKey: ['sessions'],
    queryFn: () => sessionsApi.list({ page: 1, limit: 50, sort: 'recent' }),
    enabled: isAuthed,
    staleTime: 30 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sessionsApi.delete(id),
    onSuccess: () => {
      toast.success('Session deleted');
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to delete session';
      toast.error(message);
    },
  });

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    deleteMutation.mutate(pendingDelete._id);
    setPendingDelete(null);
  }, [pendingDelete, deleteMutation]);

  if (!isAuthed) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="text-center max-w-md">
            <h1 className="font-display text-2xl font-semibold mb-2">Sign in to view your sessions</h1>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              Sessions are saved to your account so you can revisit your analysis any time.
            </p>
            <Link to="/login">
              <Button variant="primary" size="md">
                Log in
              </Button>
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const sessions = data?.sessions ?? [];

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Header />

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className="font-display text-2xl font-semibold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              My Sessions
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              {sessions.length} saved {sessions.length === 1 ? 'session' : 'sessions'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="md"
            leftIcon={<FilePlus2 size={14} />}
            onClick={() => navigate('/')}
          >
            New analysis
          </Button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
            <span className="inline-block w-5 h-5 rounded-full border-2 border-[var(--gold)] border-t-transparent animate-spin mr-2" />
            Loading sessions…
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-secondary)]">
            Failed to load sessions. Please try again.
          </div>
        )}

        {!isLoading && !isError && sessions.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-12 text-center">
            <div className="text-5xl text-[var(--gold)] mb-3" aria-hidden>♟</div>
            <h2 className="font-display text-xl font-medium mb-2">No saved sessions yet</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-5 max-w-sm mx-auto">
              Analyze a game and save it from the analyzer to see it here.
            </p>
            <Button variant="primary" size="md" onClick={() => navigate('/')}>
              Start analyzing
            </Button>
          </div>
        )}

        {!isLoading && !isError && sessions.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map((session) => (
              <SessionCard
                key={session._id}
                session={session}
                onOpen={() => navigate(`/game/${session._id}`)}
                onDelete={() => setPendingDelete(session)}
              />
            ))}
          </div>
        )}
      </main>

      <Footer />

      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete session?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--text-secondary)]">
            This will permanently delete{' '}
            <span className="text-[var(--text-primary)] font-medium">
              {pendingDelete?.title?.trim() || 'this session'}
            </span>
            . This action cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="md" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={deleteMutation.isPending}
              onClick={handleConfirmDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default SessionsPage;
