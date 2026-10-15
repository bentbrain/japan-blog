import { render, toPlainText } from '@react-email/render';
import React, { type ReactNode } from 'react';
import type { DigestPost } from '../lib/newsletter-model';
import { formatDay } from '../lib/model';

function Email({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          backgroundColor: '#ffffff',
          color: '#0647ff',
          fontFamily: 'Courier New, monospace',
          fontSize: 14,
          lineHeight: 1.65,
        }}
      >
        <table role="presentation" width="100%" cellPadding="0" cellSpacing="0">
          <tbody>
            <tr>
              <td style={{ padding: '32px 20px' }}>
                <table
                  role="presentation"
                  width="100%"
                  cellPadding="0"
                  cellSpacing="0"
                  style={{ maxWidth: 560, margin: '0 auto' }}
                >
                  <tbody>
                    <tr>
                      <td>
                        <a
                          href="https://jp.bent.build"
                          style={{ color: '#0647ff', fontWeight: 'bold' }}
                        >
                          jp.bent.build
                        </a>
                        {children}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

export async function confirmationEmail(url: string) {
  const html = await render(
    <Email>
      <h1 style={{ fontSize: 22, fontWeight: 'normal', marginTop: 32 }}>
        a little japan in your inbox
      </h1>
      <p>confirm your email for roundups of the japan journal.</p>
      <p>
        <a
          href={url}
          style={{
            display: 'inline-block',
            color: '#0647ff',
            border: '1px solid #0647ff',
            padding: '10px 16px',
          }}
        >
          CONFIRM EMAIL
        </a>
      </p>
      <p style={{ fontSize: 12 }}>
        this link expires in 24 hours. if you didn’t sign up, you can ignore
        this email.
      </p>
    </Email>,
  );
  return { html, text: toPlainText(html) };
}

export async function digestEmail(
  posts: DigestPost[],
  unsubscribe = '{{{RESEND_UNSUBSCRIBE_URL}}}',
  test = false,
) {
  const html = await render(
    <Email>
      {test && <p>owner test email. this has not been sent to subscribers.</p>}
      <h1 style={{ fontSize: 22, fontWeight: 'normal', marginTop: 32 }}>
        recent days in japan
      </h1>
      {posts.map((post) => (
        <section
          key={post.id}
          style={{
            borderTop: '1px solid #0647ff',
            marginTop: 28,
            paddingTop: 16,
          }}
        >
          <p style={{ fontSize: 12 }}>{formatDay(post.day)}</p>
          <h2 style={{ fontSize: 18, fontWeight: 'normal' }}>
            <a href={post.url} style={{ color: '#0647ff' }}>
              {post.title}
            </a>
          </h2>
          <p style={{ whiteSpace: 'pre-line' }}>{post.excerpt}</p>
          <a href={post.url} style={{ color: '#0647ff' }}>
            READ THE DAY →
          </a>
        </section>
      ))}
      <p
        style={{
          borderTop: '1px solid #0647ff',
          marginTop: 32,
          paddingTop: 16,
          fontSize: 12,
        }}
      >
        {test ? (
          'you are receiving this test as the blog owner.'
        ) : (
          <a href={unsubscribe} style={{ color: '#0647ff' }}>
            unsubscribe
          </a>
        )}
      </p>
    </Email>,
  );
  return { html, text: toPlainText(html) };
}
