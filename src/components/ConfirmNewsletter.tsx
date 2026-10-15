import { useEffect, useState } from 'react';
import { newsletterPublicRequest } from '../lib/newsletter-client';
import { Button } from './ui/button';

export function ConfirmNewsletter() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    setToken(new URL(window.location.href).searchParams.get('token') ?? '');
    window.history.replaceState(null, '', '/newsletter/confirm');
  }, []);
  async function confirm() {
    setBusy(true);
    try {
      await newsletterPublicRequest('confirm', { token });
      setConfirmed(true);
      setStatus('you’re subscribed. see you in your inbox.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-xl space-y-5 py-10" data-feedback-redact>
      <h1>confirm your email</h1>
      <p>get the japan journal in your inbox.</p>
      {!confirmed && (
        <Button
          disabled={busy || !token}
          onClick={() => {
            void confirm();
          }}
        >
          {busy ? 'CONFIRMING…' : 'CONFIRM SUBSCRIPTION'}
        </Button>
      )}
      <p role="status">
        {status ||
          (!token ? 'open the confirmation link from your email.' : '')}
      </p>
      <a href="/">BACK TO THE JOURNAL →</a>
    </div>
  );
}
