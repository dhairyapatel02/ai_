// Liveness of the web process (compose healthcheck). No dependencies, no user data.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
