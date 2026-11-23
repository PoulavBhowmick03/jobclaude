import { randomUUID } from 'node:crypto';
import { allowedOrigin, config, createStore, json, readCookie, validPilot } from '../server/session.js';
import { runResearch } from '../server/research.js';

async function readInput(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Add a résumé to start.');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 64000) {
      await reader.cancel();
      throw new Error('Résumé text is too long.');
    }
    text += decoder.decode(value, { stream: true });
  }
  const body = JSON.parse(text + decoder.decode());
  const resume = body.resume?.trim();
  const github = body.github?.trim().replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\/$/, '') ?? '';
  const roles = body.preferences?.roles?.trim();
  const locations = body.preferences?.locations?.trim();
  const experience = body.preferences?.experience?.trim();
  if (!resume || resume.length < 200 || resume.length > 22000) throw new Error('Use 200–22,000 characters of résumé text.');
  if (github && !/^[a-z\d][a-z\d-]{0,38}$/i.test(github)) throw new Error('Use a GitHub username or profile URL.');
  if (!roles || roles.length > 140 || !locations || locations.length > 140 ||
      !['0–1 years', '1–2 years', '2–4 years', '4+ years'].includes(experience)) {
    throw new Error('Add a target role, location, and experience level.');
  }
  return { resume, github, preferences: { roles, locations, experience } };
}

export async function handleResearch(request, dependencies = {}) {
  const settings = dependencies.settings ?? config();
  if (!settings.enabled) return json({ error: 'Live research is unavailable in preview.' }, 503);
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!allowedOrigin(request, settings)) return json({ error: 'Invalid origin.' }, 403);
  const token = readCookie(request);
  if (settings.pilot && !validPilot(request, settings)) return json({ error: 'A valid pilot access code is required.' }, 401);
  if (!settings.pilot && !token) return json({ error: 'A paid report is required.' }, 402);
  let input;
  try {
    input = await readInput(request);
  } catch (error) {
    return json({ error: error.message }, 400);
  }

  const store = settings.pilot ? null : dependencies.store ?? createStore();
  const claim = randomUUID();
  if (store) try {
    const pass = await store.get(token);
    if (!pass || !['paid', 'running'].includes(pass.state)) return json({ error: 'A paid report is required.' }, 402);
    if (pass.state === 'running' && pass.leaseUntil > Date.now()) return json({ error: 'Research is already running.' }, 409);
    if (pass.attempts >= 3) return json({ error: 'This pass reached its retry limit. Contact support with your Razorpay receipt.' }, 409);
    if (pass.state === 'running' && pass.recoveryUsed) return json({ error: 'This run was interrupted. Contact support with your Razorpay receipt.' }, 409);
    const expected = { state: pass.state, attempts: pass.attempts };
    if (pass.state === 'running') expected.claim = pass.claim;
    const won = await store.patch(token, expected, {
      state: 'running', claim, leaseUntil: Date.now() + 240000, attempts: pass.attempts + 1,
      recoveryUsed: pass.state === 'running' || Boolean(pass.recoveryUsed),
    });
    if (!won) return json({ error: 'Research is already running.' }, 409);
  } catch {
    return json({ error: 'Could not reserve your paid report. Please try again.' }, 502);
  }

  const encoder = new TextEncoder();
  let connected = true;
  const run = dependencies.run ?? runResearch;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        if (connected) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        if (connected) controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 12000);
      try {
        const report = await run(input, send, { oidcToken: request.headers.get('x-vercel-oidc-token') });
        if (store) {
          const saved = await store.patch(token, { state: 'running', claim }, { state: 'complete', reportJson: JSON.stringify(report) });
          if (!saved) throw new Error('Could not save the report.');
        }
        send('complete', report);
      } catch (error) {
        // Log the stage failure only. Report content and résumé text stay out of logs.
        console.warn('Research did not finish:', error instanceof SyntaxError ? 'Invalid structured result' : error.message);
        try {
          await store?.patch(token, { state: 'running', claim }, { state: 'paid' });
          send('failed', { message: 'Research could not finish. You can retry.' });
        } catch {
          send('failed', { message: 'Research was interrupted. Check the status of your paid report before retrying.' });
        }
      } finally {
        clearInterval(heartbeat);
        if (connected) controller.close();
      }
    },
    cancel() { connected = false; },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default { fetch: handleResearch };
