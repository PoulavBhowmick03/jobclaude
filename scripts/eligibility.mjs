export function startupFit(title, location, description, skills) {
  const india = /\b(?:india|bengaluru|bangalore|kolkata|delhi|hyderabad|pune|mumbai|ahmedabad|chennai|gurugram|gurgaon|noida)\b/i;
  if (!india.test(location) || /\b(?:senior|staff|principal|manager|lead|director|head)\b/i.test(title)) return null;
  const relevant = ['Voice AI', 'Forward deployed', 'AI agents', 'AI evaluation', 'Rust', 'Distributed systems', 'Consensus'];
  if (!skills.some(skill => relevant.includes(skill))) return null;

  const experience = /\b(\d{1,2})(?:\s*[-–—]\s*(\d{1,2})\s*|(\+)?\s*)years?\s+(?:of\s+)?(?:(?:relevant|professional|industry|related|hands-on|software engineering|development|work)\s+)*experience\b/gi;
  const ranges = [...description.matchAll(experience)];
  if (ranges.some(([, minimum, maximum]) => Number(minimum) > 2 || Number(maximum) > 4)) return null;
  if (ranges.length) {
    const [, minimum, maximum, plus] = ranges[0];
    const label = maximum ? `${minimum}–${maximum}` : `${minimum}${plus ?? ''}`;
    const stretch = Number(minimum) === 2 ? ' · Stretch on tenure' : '';
    return `${label} years in the posting${stretch}`;
  }
  if (/\b(?:junior|entry[- ]level|new grad(?:uate)?)\b/i.test(title)) return 'Early-career title · Check formal requirements';
  return null;
}
