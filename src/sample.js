export const sample = {
  critique: {
    verdict: 'The strongest evidence is the systems work you can walk through. Bring the best example to the top.',
    strengths: [
      { claim: 'Latency investigation', evidence: 'The example résumé describes measuring a slow request path and addressing the database query.' },
    ],
    issues: [
      { issue: 'This claim hides the engineering work.', evidence: 'Built an AI assistant for customer support.', fix: 'Name the integration you owned and one failure you could detect or recover from. Include a measurement only if you can explain how you got it.' },
      { issue: 'The top summary targets too many roles.', evidence: 'Full-stack, applied AI, platform, and DevOps engineer.', fix: 'Lead with one role family. Put projects that support it ahead of the general tool list.' },
    ],
    github: { status: 'skipped', entries: [] },
  },
  leads: [
    {
      company: 'Example voice infrastructure team', role: 'Deployment Engineer', fit: 'direct',
      location: 'Bengaluru · Hybrid', experience: '0–2 years',
      hiringSignal: 'Illustrative lead. A live report includes a source link and checks the actual listing.',
      proofToLeadWith: 'Show the request path you debugged and how you verified recovery.',
      route: 'Look for the founder or engineering lead named in the original posting.',
      url: '',
    },
  ],
  failedSearches: 0,
};
