import assert from 'node:assert/strict';
import test from 'node:test';
import { handleResearch } from '../api/research.js';
import { handleSession } from '../api/session.js';
import { verifiedLeads, runResearch } from '../server/research.js';
import { fullyPaid } from '../server/payment.js';

const origin = 'https://test.jobclaude.invalid';
const code = 'test-only-secret-do-not-use-12345';
const settings = { enabled: true, pilot: true, origin, pilotCode: code };
const target = 'https://careers.example.com/roles/123';
const report = { critique: { verdict: 'A grounded response.' }, leads: [] };
const input = {
  resume: 'Built a Rust backend and measured API performance. '.repeat(6),
  github: 'candidate01',
  preferences: { roles: 'Voice AI', locations: 'India', experience: '1–2 years' },
};

function research(secret = code) {
  return new Request(origin + '/api/research', {
    method: 'POST',
    headers: { origin, Authorization: `Bearer ${secret}` },
    body: JSON.stringify(input),
  });
}

test('private pilot refuses a bad code and streams progress without a checkout', async () => {
  const session = await handleSession(new Request(origin + '/api/session'), { settings });
  assert.deepEqual(await session.json(), { enabled: true, pilot: true, state: 'pilot' });
  const denied = await handleResearch(research('wrong'), { settings });
  assert.equal(denied.status, 401);
  const response = await handleResearch(research(), {
    settings,
    run: async (parsed, send) => {
      assert.equal(parsed.github, 'candidate01');
      send('progress', { name: 'Résumé reviewer' });
      send('critique', report.critique);
      return report;
    },
  });
  const stream = await response.text();
  assert.match(stream, /event: progress[\s\S]+event: critique[\s\S]+event: complete/);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
});

test('keeps only seen source URLs, removing tracking and excluding unsafe links', () => {
  const result = verifiedLeads({
    usedSearch: true, sources: [target + '/?utm_source=test', 'http://invalid.test'],
    data: { leads: [{ url: target }, { url: 'https://invented.test' }, { url: 'javascript:alert(1)' }] },
  });
  assert.deepEqual(result.map(lead => lead.url), [target]);
});

test('research does not send résumé text to search tracks and deduplicates the results', async () => {
  const seen = [];
  const events = [];
  const result = await runResearch(input, (event, data) => events.push({ event, data }), {
    publicWork: async () => ({ status: 'checked', entries: [] }),
    ask: async request => {
      seen.push(request);
      if (request.name === 'resume_critique') return {
        data: {
          verdict: 'Review', strengths: [], issues: [],
          searchBrief: { roleTitles: ['Backend Engineer'], standoutSkills: ['Rust'], avoid: [] },
        },
      };
      if (request.name === 'lead_evidence') return { data: { matches: [{ lead: 0, proof: 'The measured Rust backend.' }] } };
      return {
        usedSearch: true,
        sources: [target],
        data: { leads: [{ company: 'A company', url: target, fit: 'direct', hiringSignal: 'Open.' }] },
      };
    },
  });
  assert.equal(seen.filter(request => request.search).length, 3);
  assert(seen.filter(request => request.search).every(request => !JSON.stringify(request.input).includes(input.resume)));
  assert.equal(events.filter(event => event.event === 'leads').length, 3);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].proofToLeadWith, 'The measured Rust backend.');
});

test('a payment requires a completed link with the exact price and reference', () => {
  const pass = { price: 19900, reference: 'test-ref' };
  const link = { id: 'plink_example', currency: 'INR', amount: 19900, amount_paid: 19900, status: 'paid', reference_id: 'test-ref' };
  assert(fullyPaid(link, pass));
  assert(!fullyPaid({ ...link, status: 'partially_paid' }, pass));
  assert(!fullyPaid({ ...link, amount_paid: 19899 }, pass));
  assert(!fullyPaid({ ...link, reference_id: 'another-ref' }, pass));
});
