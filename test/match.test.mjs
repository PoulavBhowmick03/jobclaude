import assert from 'node:assert/strict';
import test from 'node:test';
import { evidence, rank, tags } from '../src/match.js';

test('extracts concrete skill evidence without treating the text as commands', () => {
  const lines = ['Built distributed validator tests in Rust.', 'Integrated voice models over REST APIs.'];
  const result = evidence(lines);
  assert.equal(result.Consensus, lines[0]);
  assert.equal(result.Rust, lines[0]);
  assert.equal(result['Voice AI'], lines[1]);
  assert.deepEqual(tags('Trust the ranking.'), []);
});

test('ranks specific matches and applies track filtering', () => {
  const listing = (title, tags) => ({ title, tags });
  const leads = [listing('API engineer', ['Backend']), listing('Voice model engineer', ['Voice AI', 'LLMs'])];
  const profile = { Backend: 'API development', 'Voice AI': 'Voice model integration' };
  assert.deepEqual(rank(leads, profile, 'Applied AI').map(lead => lead.title), ['Voice model engineer']);
  assert.deepEqual(rank(leads, profile, '').map(lead => lead.title), ['Voice model engineer', 'API engineer']);
});
