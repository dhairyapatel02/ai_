'use client';

/**
 * Last-resort boundary for errors in the root layout (SCREENS S25 500). It replaces the root
 * layout, so it brings its own document, theme detection and minimal styles (no app CSS).
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong · DevImpact</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          :root { color-scheme: light dark; --bg: #f6f7f9; --fg: #12141a; --muted: #575e6b; --primary: #4351c8; --on-primary: #fff; --ring: #4f5bd5; }
          @media (prefers-color-scheme: dark) { :root { --bg: #0e1014; --fg: #e8eaef; --muted: #a3a9b6; --primary: #8d97f2; --on-primary: #0e1014; --ring: #8d97f2; } }
          body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/20px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
          main { max-width: 34rem; margin: 0 auto; padding: 96px 16px; display: flex; flex-direction: column; gap: 12px; align-items: center; text-align: center; }
          h1 { font-size: 22px; line-height: 28px; margin: 0; }
          p { margin: 0; color: var(--muted); }
          .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }
          button, a { font: inherit; height: 32px; padding: 0 12px; border-radius: 6px; display: inline-flex; align-items: center; cursor: pointer; text-decoration: none; }
          button { background: var(--primary); color: var(--on-primary); border: 0; }
          a { color: var(--fg); border: 1px solid color-mix(in srgb, var(--muted) 50%, transparent); }
          :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
          code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
        `}</style>
      </head>
      <body>
        <main>
          <h1>Something went wrong on our side</h1>
          <p>We&apos;ve logged the problem. Try again in a moment — your data is safe.</p>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                retry();
              }}
            >
              Try again
            </button>
            {/* A full reload is intentional: the app's root layout failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/dashboard">Go to dashboard</a>
          </div>
          {error.digest ? (
            <p>
              Error ID <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
