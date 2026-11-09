/**
 * AUDIT HELPER — tiny stand-in for the Anthropic Messages API.
 *
 * v0.1.0's @anthropic-ai/sdk honours ANTHROPIC_BASE_URL, so the API can be pointed here
 * (local-only env override, no code change) to exercise the generation endpoints' happy
 * path without a real key and to capture the exact prompts the API sends.
 *
 *   node docs/v2/audit/scripts/mock-anthropic.mjs [port=4010] [captureDir]
 *   ANTHROPIC_BASE_URL=http://localhost:4010 npm run dev:api
 *
 * Behaviour:
 *   - every request body is written to <captureDir>/<n>-<kind>.json
 *   - prompt containing "FORCE_400" -> 400 invalid_request_error (to observe retry policy)
 *   - prompt containing "FORCE_PROSE" -> answer with prose + two JSON objects (greedy regex test)
 *   - otherwise returns a plausible JSON payload for resume / appraisal / promotion / impact
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || 4010);
const captureDir = process.argv[3] || path.resolve('docs/v2/audit/logs/ai-prompts');
fs.mkdirSync(captureDir, { recursive: true });
let n = 0;

function kindOf(prompt) {
  if (prompt.includes('resume bullet')) return 'resume';
  if (prompt.includes('performance appraisal')) return 'appraisal';
  if (prompt.includes('promotion packet')) return 'promotion';
  if (prompt.includes('impact scores')) return 'impact';
  if (prompt.includes('commit message')) return 'enhance';
  return 'unknown';
}

const payloads = {
  resume: { bullets: [
    { text: 'Engineered idempotent payment capture for the checkout service.', category: 'reliability', impact: 'Eliminated duplicate charges' },
    { text: 'Introduced a Redis cache for product search.', category: 'performance', impact: '~30% lower p95 latency' },
    { text: 'Reviewed teammates\' pull requests across 5 repositories.', category: 'collaboration', impact: 'Faster merges' },
  ] },
  appraisal: {
    executiveSummary: 'Strong quarter focused on checkout reliability.',
    keyContributions: [{ title: 'Idempotent payments', evidence: 'Checkout: idempotent payment capture' }],
    metrics: { prCount: 12, reviewCount: 20, featuresShipped: 6, commitsCount: 80 },
    areasOfImpact: ['Reliability'], growthAndLearning: ['Observability'], goalsForNextPeriod: ['Lead billing split'],
  },
  promotion: {
    whyReady: 'Consistently operates at the next level.', leadershipEvidence: ['Led billing split'],
    technicalImpact: ['Cut latency'], businessValue: ['Fewer refunds'], mentorship: ['Reviewed 60+ PRs'],
    supportingData: { totalContributions: 300, crossTeamCollaboration: 5, technicalComplexity: 'high', consistency: 'steady' },
  },
  impact: { overall: 72, featureDelivery: 75, codeQuality: 70, collaboration: 68, leadership: 60, highlights: ['a', 'b', 'c'] },
  enhance: { enhanced: 'Engineered X', category: 'feature' },
  unknown: { ok: true },
};

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch {}
    const prompt = parsed?.messages?.[0]?.content ?? '';
    const kind = kindOf(typeof prompt === 'string' ? prompt : JSON.stringify(prompt));
    n += 1;
    fs.writeFileSync(path.join(captureDir, `${String(n).padStart(3, '0')}-${kind}.json`),
      JSON.stringify({ method: req.method, url: req.url, headers: { 'x-api-key': req.headers['x-api-key'] ? '<redacted>' : undefined }, body: parsed }, null, 2));
    console.log(new Date().toISOString(), req.method, req.url, kind, `prompt_chars=${String(prompt).length}`);

    if (String(prompt).includes('FORCE_400')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'mock 400' } }));
    }
    const text = String(prompt).includes('FORCE_PROSE')
      ? 'Here is the result: {"bullets":[{"text":"a","category":"features","impact":"x"}]} and an extra note {"debug":true}'
      : 'Sure! ' + JSON.stringify(payloads[kind]);
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': `mock_${n}` });
    res.end(JSON.stringify({
      id: `msg_mock_${n}`, type: 'message', role: 'assistant', model: parsed.model,
      content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: Math.ceil(String(prompt).length / 4), output_tokens: Math.ceil(text.length / 4) },
    }));
  });
}).listen(port, () => console.log(`mock anthropic on :${port}, capturing to ${captureDir}`));
