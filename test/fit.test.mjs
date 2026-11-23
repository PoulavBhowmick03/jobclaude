import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyEligibility } from '../server/fit.js';
import { teamRoutes } from '../server/github.js';

const lead = { company: 'Example', fit: 'direct', location: 'Remote India', experience: '1–2 years' };
const brief = { country: 'India', locations: 'Bengaluru', workMode: 'any', relocation: false, stretch: 0, experience: '1–2 years' };

test('employer lines override invented location and experience in the candidate result', () => {
  const source = ['Applied AI Engineer', 'Mumbai, India Full-time', 'Experience: 2+ years of professional full-stack engineering experience.', 'This is an on-site role at our Mumbai office.'];
  assert.equal(verifyEligibility(lead, { ...brief, workMode: 'remote' }, source), null);
  assert.equal(verifyEligibility(lead, brief, source), null);
  const fit = verifyEligibility(lead, { ...brief, relocation: true }, source);
  assert.equal(fit.eligibility.workMode.value, 'onsite');
  assert.match(fit.eligibility.location.quote, /Mumbai/);
  assert.equal(fit.eligibility.experience.quote, source[2]);
});

test('rejects known conflicts and makes missing source facts visible', () => {
  assert.equal(verifyEligibility(lead, brief, ['Remote (US)', '1+ years of experience.']), null);
  const work = ['Backend Engineer', 'Bangalore, India (Hybrid)', '3+ years building production backend services in Python'];
  assert.equal(verifyEligibility(lead, brief, work), null);
  const fit = verifyEligibility(lead, { ...brief, stretch: 1 }, work);
  assert.equal(fit.fit, 'stretch');
  assert.equal(fit.eligibility.location.status, 'confirmed');

  const unknown = verifyEligibility(lead, brief, ['Junior engineer', 'Remote']);
  assert.equal(unknown.fit, 'unverified');
  assert.equal(unknown.location, 'Location not verified');
  assert.equal(unknown.eligibility.experience.quote, 'Junior engineer');
});

test('team routes require an owned, merged PR and link to the actual approval and related issue', async () => {
  const url = 'https://github.com/example/engine/pull/42';
  const review = url + '#pullrequestreview-1';
  const issue = 'https://github.com/example/engine/issues/50';
  const evidence = { url, title: 'Untrusted browser title' };
  const fakeGitHub = async (value) => {
    const path = new URL(value).pathname;
    if (path.endsWith('/reviews')) return Response.json([
      { state: 'APPROVED', author_association: 'MEMBER', html_url: review, user: { login: 'maintainer' } },
    ]);
    if (path.endsWith('/issues')) return Response.json([
      { state: 'open', title: 'Improve cache accounting', updated_at: new Date().toISOString(), html_url: issue, assignee: null },
    ]);
    assert.equal(path, '/repos/example/engine/pulls/42');
    return Response.json({ user: { login: 'candidate' }, merged_at: '2026-01-01', title: 'Account for cache memory' });
  };
  const result = await teamRoutes('candidate', [evidence], fakeGitHub);
  assert.equal(result.routes[0].reviewer.url, review);
  assert.equal(result.routes[0].issue.url, issue);
  assert.equal(result.routes[0].contribution.title, 'Account for cache memory');
  assert.deepEqual((await teamRoutes('unrelated', [evidence], fakeGitHub)).routes, []);
});
