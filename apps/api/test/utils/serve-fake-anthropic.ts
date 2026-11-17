/**
 * Local AI without a key: serves the in-process fake Messages API (schema-valid, cited answers
 * built from the request's evidence). Never used in production.
 *
 *   npm run ai:mock --workspace=apps/api          # port 4010 (or pass a port)
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ANTHROPIC_API_KEY=mock npm run dev:api
 */
import { autoReply, startFakeAnthropic } from './fake-anthropic';

void startFakeAnthropic(
  (req) => ({ ...autoReply(req), chunkSize: 12, delayMs: 15 }),
  Number(process.argv[2] ?? 4010),
).then((fake) => {
  console.log(
    `Fake Anthropic API on ${fake.url} (set ANTHROPIC_BASE_URL and any ANTHROPIC_API_KEY)`,
  );
});
