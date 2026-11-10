import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { authHeaders, getBase, isTauri } from '../../lib/api';
import { useAppStore } from '../../lib/store';

type ConnectionState = 'checking' | 'connected' | 'needs-key' | 'offline';

// Never put the Render API key in a build variable or page URL. The visitor
// pastes it locally; we verify it against the existing protected /v1/info API.
export function ConnectionGate({ children }: { children: ReactNode }) {
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [state, setState] = useState<ConnectionState>('checking');
  const [nonce, setNonce] = useState(0);
  const [candidate, setCandidate] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isTauri()) {
      setState('connected');
      return;
    }
    let active = true;
    setState('checking');
    fetch(`${getBase()}/v1/info`, {
      headers: authHeaders(),
      cache: 'no-store',
    }).then((res) => {
      if (!active) return;
      setState(res.ok ? 'connected' : res.status === 401 ? 'needs-key' : 'offline');
    }).catch(() => {
      if (active) setState('offline');
    });
    return () => { active = false; };
  }, [nonce]);

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = candidate.trim();
    if (!key) {
      setError('Paste OPENJARVIS_API_KEY from Render to continue.');
      return;
    }
    setVerifying(true);
    setError('');
    try {
      const res = await fetch(`${getBase()}/v1/info`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        updateSettings({ apiKey: key });
        setCandidate('');
        setState('connected');
      } else if (res.status === 401) {
        setError('That access key was rejected. Copy the VALUE of OPENJARVIS_API_KEY from Render — not the Gemini key.');
      } else {
        setError(`Server returned HTTP ${res.status}. Try again without changing your Render settings.`);
      }
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  if (state === 'connected') return <>{children}</>;

  return (
    <div className="flex-1 min-w-0 flex items-center justify-center overflow-auto px-4 py-8"
         style={{ background: 'var(--color-bg-primary)' }}>
      <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
           style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <KeyRound size={25} style={{ color: 'var(--color-accent)' }} />
          <h2 className="font-semibold text-lg" style={{ color: 'var(--color-text)' }}>
            {state === 'needs-key' ? 'Connect your JARVIS' : 'Checking JARVIS connection'}
          </h2>
        </div>
        {state === 'checking' && (
          <p style={{ color: 'var(--color-text-secondary)' }}>Checking your existing secure connection…</p>
        )}
        {state === 'offline' && (
          <>
            <p style={{ color: 'var(--color-text-secondary)' }}>The server is temporarily unavailable. Free hosting may need to wake up.</p>
            <button type="button" className="rounded-lg px-4 py-3 font-medium"
                    style={{ background: 'var(--color-accent)', color: 'white' }}
                    onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw size={16} className="inline mr-2" />Retry connection
            </button>
          </>
        )}
        {state === 'needs-key' && (
          <>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Gemini is configured. This iPhone browser needs your OpenJarvis access key once before it can send messages.
              Safari and a Home Screen app can have separate saved settings.
            </p>
            <a href="https://dashboard.render.com/web/srv-dbpdne8n74is73dls2ig"
               target="_blank" rel="noopener noreferrer"
               className="text-sm underline" style={{ color: 'var(--color-accent)' }}>
              Open Render → Environment → OPENJARVIS_API_KEY
            </a>
            <form onSubmit={connect} className="space-y-3">
              <label htmlFor="jarvis-connect-key" className="block text-sm font-medium"
                     style={{ color: 'var(--color-text)' }}>OpenJarvis access key</label>
              <input id="jarvis-connect-key" type="password" autoComplete="off"
                     value={candidate} onChange={(e) => setCandidate(e.target.value)}
                     placeholder="Paste OPENJARVIS_API_KEY"
                     className="w-full rounded-lg px-3 py-3 min-w-0 outline-none"
                     style={{ color: 'var(--color-text)', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }} />
              {error && <p role="alert" className="text-sm" style={{ color: 'var(--color-error)' }}>{error}</p>}
              <button type="submit" disabled={verifying}
                      className="w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-60"
                      style={{ background: 'var(--color-accent)', color: 'white' }}>
                <ShieldCheck size={18} className="inline mr-2" />
                {verifying ? 'Verifying key…' : 'Verify key and open Chat'}
              </button>
            </form>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              The key is only saved in this browser after verification. Never paste it into a public chat.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
