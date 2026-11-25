import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * In-process fake of the Anthropic Messages API (`POST /v1/messages`, streaming and not), so tests
 * exercise the real `@anthropic-ai/sdk` path (SSE parsing, error mapping, retries) without ever
 * calling Anthropic (OPS-15). Point `ANTHROPIC_BASE_URL` at `url` and set any `ANTHROPIC_API_KEY`.
 */
export interface FakeRequest {
  path: string;
  headers: IncomingMessage['headers'];
  body: {
    model: string;
    max_tokens: number;
    stream?: boolean;
    system?: { type: string; text: string; cache_control?: unknown }[] | string;
    messages: { role: string; content: string }[];
    thinking?: unknown;
    output_config?: { effort?: string; format?: { type: string; schema: unknown } };
    fallbacks?: unknown;
    [key: string]: unknown;
  };
}

export interface FakeReply {
  /** Assistant text (the JSON document). */
  text?: string;
  stopReason?: 'end_turn' | 'refusal' | 'max_tokens';
  /** HTTP error instead of a message. */
  status?: number;
  errorType?: string;
  /** Characters per text delta (default 40) and delay between deltas. */
  chunkSize?: number;
  delayMs?: number;
  usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  model?: string;
}

export type FakeHandler = (req: FakeRequest) => FakeReply | Promise<FakeReply>;

export interface FakeAnthropic {
  url: string;
  requests: FakeRequest[];
  /** Replies used in order before falling back to the handler. */
  queue: FakeReply[];
  setHandler: (handler: FakeHandler) => void;
  reset: () => void;
  close: () => Promise<void>;
}

const sse = (res: ServerResponse, event: string, data: unknown) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startFakeAnthropic(
  defaultHandler?: FakeHandler,
  port = 0,
): Promise<FakeAnthropic> {
  const requests: FakeRequest[] = [];
  const queue: FakeReply[] = [];
  let handler: FakeHandler = defaultHandler ?? (() => ({ text: '{}' }));

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        if (!req.url?.startsWith('/v1/messages') || req.method !== 'POST') {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'nope' } }),
          );
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as FakeRequest['body'];
        const request: FakeRequest = { path: req.url, headers: req.headers, body };
        requests.push(request);
        const reply = queue.shift() ?? (await handler(request));
        if (reply.status && reply.status >= 400) {
          res.writeHead(reply.status, { 'content-type': 'application/json', 'retry-after': '0' });
          res.end(
            JSON.stringify({
              type: 'error',
              error: { type: reply.errorType ?? 'api_error', message: 'fake error' },
              request_id: 'req_fake_123',
            }),
          );
          return;
        }
        const text = reply.text ?? '';
        const usage = {
          input_tokens: reply.usage?.input ?? 1200,
          output_tokens: reply.usage?.output ?? Math.max(1, Math.ceil(text.length / 4)),
          cache_read_input_tokens: reply.usage?.cacheRead ?? 0,
          cache_creation_input_tokens: reply.usage?.cacheWrite ?? 0,
        };
        const model = reply.model ?? body.model;
        const stopReason = reply.stopReason ?? 'end_turn';
        if (!body.stream) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'msg_fake',
              type: 'message',
              role: 'assistant',
              model,
              content: [{ type: 'text', text }],
              stop_reason: stopReason,
              stop_sequence: null,
              usage,
            }),
          );
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        sse(res, 'message_start', {
          type: 'message_start',
          message: {
            id: 'msg_fake',
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { ...usage, output_tokens: 1 },
          },
        });
        sse(res, 'content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        });
        const size = reply.chunkSize ?? 40;
        for (let i = 0; i < text.length; i += size) {
          if (res.destroyed) return;
          sse(res, 'content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: text.slice(i, i + size) },
          });
          if (reply.delayMs) await sleep(reply.delayMs);
        }
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
        sse(res, 'message_delta', {
          type: 'message_delta',
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { output_tokens: usage.output_tokens },
        });
        sse(res, 'message_stop', { type: 'message_stop' });
        res.end();
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const bound = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${bound}`,
    requests,
    queue,
    setHandler: (h) => {
      handler = h;
    },
    reset: () => {
      requests.length = 0;
      queue.length = 0;
      handler = defaultHandler ?? (() => ({ text: '{}' }));
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

// ── Auto responder: valid output for each prompt, citing the request's evidence ───────────

interface PromptEvidence {
  items: { ref: string; title: string; kind: string }[];
}

export function evidenceOf(req: FakeRequest): PromptEvidence {
  const user = req.body.messages[0]?.content ?? '';
  const match = /<evidence>\n([\s\S]*?)\n<\/evidence>/.exec(user);
  return match ? (JSON.parse(match[1]) as PromptEvidence) : { items: [] };
}

export function systemText(req: FakeRequest): string {
  const s = req.body.system;
  return typeof s === 'string' ? s : (s ?? []).map((b) => b.text).join('\n');
}

/** A schema-valid answer for whichever prompt sent the request. */
export function autoReply(req: FakeRequest): FakeReply {
  const sys = systemText(req);
  const refs = evidenceOf(req).items.map((i) => i.ref);
  const ref = (i: number) => (refs.length ? [refs[i % refs.length]] : []);
  const claim = (text: string, i: number) => ({ text, citations: ref(i) });
  // Achievements rank after PRs; cite one (when present) so ACH- citations are exercised (P12).
  const achievement = refs.find((r) => r.startsWith('ACH-'));
  let output: unknown;
  if (sys.includes('Task: resume bullets')) {
    output = {
      summary: claim('Backend engineer focused on reliable payment services.', 0),
      bullets: [0, 1, 2, 3, 4].map((i) => ({
        ...claim(`Delivered change ${i + 1} to the API.`, i),
        theme: 'Delivery',
      })),
    };
  } else if (sys.includes('Task: self-appraisal')) {
    output = {
      executiveSummary: claim('A period of steady delivery across services.', 0),
      keyContributions: [0, 1].map((i) => ({
        ...claim(`Shipped item ${i + 1}.`, i),
        title: `Contribution ${i + 1}`,
      })),
      areasOfImpact: [
        achievement
          ? { text: 'Mentored teammates beyond code.', citations: [achievement] }
          : claim('Improved reliability of the API.', 1),
      ],
      growth: [claim('Took on larger changes.', 2)],
      nextGoals: [{ text: 'Lead the next migration.' }],
    };
  } else if (sys.includes('Task: promotion packet')) {
    output = {
      whyReady: claim('Operates at the next level across repositories.', 0),
      leadershipEvidence: [claim('Drove changes across two repositories.', 1)],
      technicalImpact: [claim('Improved the API.', 0)],
      businessValue: [claim('Shipped user-facing features.', 1)],
      mentorship: [claim('Reviewed teammates’ pull requests.', 2)],
    };
  } else if (sys.includes('Task: narrative highlights')) {
    output = {
      summary: claim('Delivery and reviews drove the period.', 0),
      highlights: [0, 1].map((i) => ({
        ...claim(`Highlight ${i + 1}.`, i),
        title: `Highlight ${i + 1}`,
      })),
      focusAreas: [{ text: 'Keep pull requests small.' }],
    };
  } else if (sys.includes('Task: turn one pull request or commit')) {
    output = {
      title: 'Shipped an API improvement',
      statement: 'Improved the API with a focused change.',
      category: 'delivery',
      citations: ref(0),
    };
  } else if (sys.includes('Task: a short summary for the engineer')) {
    output = {
      summary: claim('A productive week.', 0),
      highlights: [claim('Merged a change.', 0)],
    };
  } else if (sys.includes('You repair JSON documents')) {
    const m = /<invalid_output>\n([\s\S]*?)\n<\/invalid_output>/.exec(
      req.body.messages[0]?.content ?? '',
    );
    output = m ? JSON.parse(m[1]) : {};
  } else {
    output = {};
  }
  return { text: JSON.stringify(output) };
}
