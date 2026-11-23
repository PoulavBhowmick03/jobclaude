export const workModes = ['any', 'remote', 'hybrid', 'onsite'];
export const experienceLevels = ['0–1 years', '1–2 years', '2–4 years', '4+ years'];

const cities = {
  india: ['bengaluru', 'bangalore', 'mumbai', 'bombay', 'kolkata', 'calcutta', 'delhi', 'noida', 'gurgaon', 'gurugram', 'hyderabad', 'pune', 'chennai', 'ahmedabad', 'kochi', 'jaipur', 'chandigarh'],
};
const aliases = [
  ['bengaluru', 'bangalore'], ['mumbai', 'bombay'], ['kolkata', 'calcutta'], ['gurugram', 'gurgaon'],
  ['united states', 'usa', 'us'], ['united kingdom', 'uk'],
];
const countries = ['india', 'united states', 'united kingdom', 'canada', 'germany', 'australia', 'singapore', 'ireland', 'netherlands', 'france', 'poland', 'dubai', 'philippines', 'japan', 'new zealand'];

const explicitMode = /\b(?:work from (?:the )?office|work from (?:your )?home|in[ -]office|on[ -]?site|in[ -]person|hybrid|remote)\b/i;
const worldwide = /\b(?:worldwide|globally|anywhere in the world|any country)\b/i;
const geographyLabel = /^(?:job location|location|based in|remote (?:from|in)|workplace)\b/i;

function tokens(value) {
  return value.toLowerCase().replace(/[^a-z\d]+/g, ' ').trim();
}

function mentions(line, place) {
  const normalized = tokens(place);
  if (!normalized) return false;
  if (normalized === 'us') return /\bU\.?S\.?A?\b/.test(line);
  if (normalized === 'uk') return /\bU\.?K\.?\b/.test(line);
  const names = aliases.find(group => group.includes(normalized)) ?? [normalized];
  const source = ' ' + tokens(line) + ' ';
  return names.some(name => name === 'us' || name === 'uk'
    ? mentions(line, name)
    : source.includes(' ' + name + ' '));
}

export function statedMinimum(text) {
  for (const line of String(text).split('\n')) {
    if (/\b(?:preferred|nice to have|bonus|ideally)\b/i.test(line)) continue;
    const match = line.match(/\b(\d{1,2})(?:\s*[-–—]\s*\d{1,2}|\s*\+|\s+or more)?\s+years?\b/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function modeOf(line) {
  if (/\b(?:hybrid|\d+ days? (?:a|per) week in (?:the )?office)\b/i.test(line)) return 'hybrid';
  if (/\b(?:work from (?:the )?office|in[ -]office|on[ -]?site|in[ -]person)\b/i.test(line)) return 'onsite';
  if (/\b(?:remote|work from (?:your )?home)\b/i.test(line)) return 'remote';
  return null;
}

function sourceEligibility(brief, lines, metadata) {
  const country = tokens(brief.country ?? '');
  const allowedCities = (brief.locations ?? '').split(',').map(place => place.trim()).filter(Boolean);
  const countryPlaces = [country, ...(cities[country] ?? []), ...allowedCities];
  const somePlace = line => worldwide.test(line) || [...countryPlaces, ...countries].some(place => mentions(line, place));
  const metadataLocation = metadata.location?.trim();
  const metadataMode = metadata.mode?.trim();
  const header = lines.slice(0, 26);

  // Prefer the workplace field or explicit sentences over mentions like “remote tooling”.
  const modeLines = lines.filter(line => /\b(?:this (?:is|role)|workplace|work mode|employment type|work from|location|must (?:be|work)|required|based in)\b/i.test(line));
  const modeEvidence = [metadataMode, metadataLocation, ...modeLines, ...header]
    .filter(Boolean).find(line => line.length < 230 && modeOf(line) && (line === metadataMode ||
      somePlace(line) || /^(?:remote|hybrid|on[ -]?site|in[ -]office)$/i.test(line) || geographyLabel.test(line) || /\b(?:this role|this is|work mode|workplace|work from|in[ -]office)\b/i.test(line)));
  const workMode = modeOf(modeEvidence ?? '');

  const localLine = line => {
    if (!somePlace(line) || line.length >= 200) return false;
    if (geographyLabel.test(line) || explicitMode.test(line)) return true;
    return line.length < 85 && (/[·,|()]/.test(line) || countryPlaces.some(place => tokens(line) === tokens(place)));
  };
  const locationEvidence = [metadataLocation, ...modeLines.filter(ln => explicitMode.test(ln)), ...header, ...lines.filter(ln => geographyLabel.test(ln))]
    .filter(Boolean).find(line => line === metadataLocation ? somePlace(line) : localLine(line));
  const numeric = lines.filter(line => line.length < 300 && /\b(?:experience|building|developing|shipping|working|customer.facing|engineering)\b/i.test(line))
    .map(line => ({ line, minimum: statedMinimum(line) })).filter(item => item.minimum !== null)
    .sort((a, b) => b.minimum - a.minimum)[0];
  const junior = header.find(line => line.length < 110 && /\b(?:junior|entry.level|new grad(?:uate)?)\b/i.test(line));
  return {
    workMode, modeEvidence: modeEvidence ?? null, locationEvidence: locationEvidence ?? null,
    experienceEvidence: numeric?.line ?? junior ?? null, minimum: numeric?.minimum ?? null,
    country, allowedCities,
  };
}

function technicalRequirements(lines) {
  const first = lines.findIndex(line => line.length < 105 &&
    /^(?:what (?:we(?:['’]re| are) looking for|you(?:['’]ll| will) bring)|(?:minimum |must.have |required )?requirements|qualifications|about you)\b/i.test(line));
  if (first < 0) return [];
  const following = lines.slice(first + 1, first + 15);
  const stop = following.findIndex(line => /^(?:nice to have|bonus|preferred|benefits|apply|what we offer|compensation)\b/i.test(line));
  return following.slice(0, stop < 0 ? following.length : stop).filter(line => line.length <= 260).slice(0, 10);
}

export function verifyEligibility(lead, brief, lines = [], metadata = {}) {
  const info = sourceEligibility(brief, lines, metadata);
  const { workMode, modeEvidence, locationEvidence, experienceEvidence, minimum, country, allowedCities } = info;
  const requestedMode = brief.workMode ?? 'any';
  if (workMode && requestedMode !== 'any' && requestedMode !== workMode) return null;

  let location = 'unverified';
  if (locationEvidence && country) {
    const acceptedCity = allowedCities.some(city => mentions(locationEvidence, city));
    const inCountry = mentions(locationEvidence, country) || (cities[country] ?? []).some(city => mentions(locationEvidence, city));
    const elsewhere = countries.some(other => other !== country &&
      !(aliases.find(group => group.includes(country)) ?? []).includes(other) && mentions(locationEvidence, other));
    if (workMode === 'remote') {
      if (acceptedCity || inCountry || worldwide.test(locationEvidence)) location = 'confirmed';
      else if (elsewhere) return null;
    } else if (workMode === 'onsite' || workMode === 'hybrid') {
      if (acceptedCity || (inCountry && brief.relocation)) location = 'confirmed';
      else if (elsewhere || (!brief.relocation && (cities[country] ?? []).some(city => mentions(locationEvidence, city)))) return null;
    }
  }

  const ceiling = { '0–1 years': 1, '1–2 years': 2, '2–4 years': 4 }[brief.experience];
  const allowance = brief.stretch === 1 ? 1 : 0;
  if (ceiling !== undefined && minimum !== null && minimum > ceiling + allowance) return null;
  const stretch = ceiling !== undefined && minimum !== null && minimum > ceiling;
  const experience = minimum !== null ? 'confirmed' : 'unverified';
  const fit = lead.fit === 'conversation' ? 'conversation'
    : stretch ? 'stretch' : workMode && location === 'confirmed' && experience === 'confirmed' ? 'direct' : 'unverified';
  return {
    ...lead,
    location: locationEvidence ?? 'Location not verified',
    experience: minimum === null ? 'Years not verified' : `${minimum}+ years minimum`,
    fit,
    technicalRequirements: technicalRequirements(lines),
    eligibility: {
      location: { status: location, quote: locationEvidence },
      workMode: { status: workMode ? 'confirmed' : 'unverified', value: workMode, quote: modeEvidence },
      experience: { status: experience, minimum, quote: experienceEvidence },
    },
  };
}
