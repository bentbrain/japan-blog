import { useEffect, useState, type SubmitEvent } from 'react';
import { newsletterPublicRequest } from '../lib/newsletter-client';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel } from './ui/field';

export function NewsletterSignup({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    try {
      await newsletterPublicRequest('subscribe', {
        email: values.get('email'),
        website: values.get('website'),
      });
      setStatus('check your inbox for a confirmation link.');
      form.reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      data-feedback-id="newsletter-signup"
      aria-label={compact ? 'newsletter' : undefined}
      aria-labelledby={compact ? undefined : 'newsletter-title'}
      className={
        compact
          ? 'mt-6 w-full'
          : 'mx-auto max-w-[1400px] border-t px-4 py-8 min-[601px]:px-6'
      }
    >
      <div className={compact ? undefined : 'max-w-xl'}>
        {!compact && (
          <>
            <h2 id="newsletter-title" className="mb-2">
              a little japan in your inbox
            </h2>
            <p className="mb-4 text-xs">
              journal updates, sent together. confirm by email. unsubscribe
              anytime.
            </p>
          </>
        )}
        <form
          data-feedback-redact
          data-feedback-private
          onSubmit={(event) => {
            void submit(event);
          }}
          className={
            compact ? 'flex items-end gap-2' : 'flex flex-wrap items-end gap-2'
          }
        >
          <Field
            className={compact ? 'min-w-0 flex-1' : 'min-w-0 flex-1 basis-52'}
          >
            <FieldLabel
              htmlFor="newsletter-email"
              className={compact ? 'sr-only' : undefined}
            >
              email
            </FieldLabel>
            <Input
              id="newsletter-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              disabled={!ready || busy}
              placeholder="you@example.com"
              className="rounded-none"
            />
          </Field>
          <div hidden aria-hidden="true">
            <label htmlFor="newsletter-website">website</label>
            <input
              id="newsletter-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={!ready || busy}>
            {busy ? 'SENDING…' : 'SUBSCRIBE'}
          </Button>
        </form>
        <p
          role="status"
          className={compact ? 'text-xs [&:not(:empty)]:mt-3' : 'mt-3 text-xs'}
        >
          {status}
        </p>
        {!compact && (
          <a href="/newsletter/privacy" className="text-xs">
            email privacy
          </a>
        )}
      </div>
    </section>
  );
}
