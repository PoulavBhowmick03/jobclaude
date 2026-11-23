import assert from 'node:assert/strict';
import test from 'node:test';
import { startupFit } from '../scripts/eligibility.mjs';

test('only admits relevant roles with India geography and early-career evidence', () => {
  const skills = ['Voice AI'];
  const localized = 'Bengaluru (on-site)';
  const requirements = '0–2 years of professional software engineering experience.';
  assert.equal(startupFit('AI Engineer', localized, requirements, skills), '0–2 years in the posting');
  assert.equal(startupFit('AI Engineer', 'Remote (US)', requirements, skills), null);
  assert.equal(startupFit('Senior AI Engineer', localized, requirements, skills), null);
  assert.equal(startupFit('AI Engineer', localized, requirements, ['Python']), null);
  assert.equal(startupFit('Junior AI Engineer', localized, '4+ years of relevant experience.', skills), null);
  assert.equal(startupFit('AI Engineer', localized, '2–8 years of engineering experience.', skills), null);
  assert.equal(startupFit('AI Engineer', localized, '2–8 years of software engineering experience.', skills), null);
  assert.equal(startupFit('AI Engineer', localized, 'Operate our voice infrastructure.', skills), null);
});
