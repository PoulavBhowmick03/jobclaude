const skills = [
  ['Forward deployed', /forward[ -]deployed|deployment engineer|customer engineer|solutions engineer/i],
  ['AI agents', /\bagent(?:s|ic)\b|\bmcp\b|tool.calling|tool.use/i],
  ['LLMs', /\bllms?\b|language models?|generative ai|model integration/i],
  ['Voice AI', /voice(?: ai| models?)?|speech.to.text|text.to.speech|\basr\b|\btts\b/i],
  ['AI evaluation', /\bevals?\b|model evaluation|agent evaluation/i],
  ['Rust', /\brust\b/i],
  ['Python', /\bpython\b/i],
  ['TypeScript', /\btypescript\b/i],
  ['Backend', /\bback[ -]?end\b|server.side|\brest apis?\b/i],
  ['PostgreSQL', /\bpostgres(?:ql)?\b|\bsqlx\b/i],
  ['Distributed systems', /distributed systems?|distributed validator|\bp2p\b|\blibp2p\b/i],
  ['Ethereum', /\bethereum\b|\bevm\b|\breth\b|\blighthouse\b.{0,20}rust/i],
  ['Consensus', /\bconsensus\b|beacon chain|beacon node|validator client|distributed validator|fork choice/i],
  ['Crypto payments', /crypto payments?|on.chain payments?|private payments?|\bx402\b|\bstablecoins?\b|\bsettlement\b/i],
  ['Testing', /integration test|property.based test|\bfuzz(?:ing)?\b|test infrastructure/i],
  ['Performance', /benchmark|profiling|latency|performance engineering|memory overhead/i],
];

export const tracks = {
  'Applied AI': ['Forward deployed', 'AI agents', 'LLMs', 'Voice AI', 'AI evaluation', 'Python', 'TypeScript'],
  'Rust & backend': ['Rust', 'Backend', 'PostgreSQL', 'Distributed systems', 'Testing', 'Performance', 'Crypto payments'],
  'Protocol engineering': ['Ethereum', 'Consensus', 'Rust', 'Distributed systems', 'Testing', 'Crypto payments'],
};

export function tags(text) {
  return skills.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

export function evidence(lines) {
  const result = {};
  for (const line of lines) {
    for (const tag of tags(line)) result[tag] ??= line.slice(0, 220);
  }
  return result;
}

export function rank(leads, profile, track) {
  const trackTags = tracks[track] ?? [];
  return leads.map(lead => {
    const matches = lead.tags.filter(tag => profile[tag]);
    const inTrack = lead.tags.filter(tag => trackTags.includes(tag));
    const specific = matches.filter(tag => !['Python', 'TypeScript', 'Testing', 'Performance', 'Backend'].includes(tag));
    const score = matches.length * 2 + specific.length * 2 + inTrack.length * 2 + (lead.fitTitle ?? 0);
    return { ...lead, matches, score, inTrack };
  }).filter(lead => !track || lead.inTrack.length)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
