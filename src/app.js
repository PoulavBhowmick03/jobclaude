import './style.css';
import { evidence, rank, tags } from './match.js';

const $ = id => document.getElementById(id);
const stateKey = 'jobclaude-v1';
const defaultProfile = { resumes: [], github: null, saved: {} };
let local = defaultProfile;
try {
  local = { ...defaultProfile, ...JSON.parse(localStorage.getItem(stateKey)) };
} catch {
  // The page also works when browser storage is unavailable.
}

const data = { leads: [], sources: [] };
let view = 'shortlist';
let visible = 16;
let scanReady = false;
let profileBusy = false;

function node(tag, content, className) {
  const result = document.createElement(tag);
  if (content) result.textContent = content;
  if (className) result.className = className;
  return result;
}

function link(content, url) {
  const result = node('a', content);
  try {
    if (new URL(url).protocol !== 'https:') return result;
    result.href = url;
    result.target = '_blank';
    result.rel = 'noreferrer';
  } catch {
    // Leave malformed source links inactive.
  }
  return result;
}

function persist() {
  try {
    localStorage.setItem(stateKey, JSON.stringify(local));
    return true;
  } catch {
    $('profile-status').textContent = 'Browser storage is unavailable. Changes last until you close the page.';
    return false;
  }
}

function profileEvidence() {
  const result = { ...local.github?.evidence };
  for (const resume of local.resumes) Object.assign(result, resume.evidence);
  return result;
}

function renderProfile() {
  const chips = Object.keys(profileEvidence()).map(tag => node('span', tag, 'tag matched'));
  $('profile-tags').replaceChildren(...chips);
  const files = local.resumes.map(resume => {
    const row = node('div', '', 'file-row');
    const remove = node('button', 'Remove', 'quiet');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${resume.name}`);
    remove.disabled = profileBusy;
    remove.addEventListener('click', () => {
      local.resumes = local.resumes.filter(file => file.id !== resume.id);
      persist();
      renderProfile();
      render();
    });
    row.append(node('span', resume.name), remove);
    return row;
  });
  $('resume-list').replaceChildren(...files);
  $('clear-profile').hidden = !(files.length || local.github);
  $('clear-profile').disabled = profileBusy;
  $('export-profile').hidden = !chips.length;
  $('export-profile').disabled = profileBusy;
}

async function readResume(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('File exceeds 10 MB.');
  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return (await file.text()).split('\n');
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;
  const task = getDocument({
    data: await file.arrayBuffer(), isEvalSupported: false,
    disableFontFace: true, useSystemFonts: false, stopAtErrors: true,
  });
  try {
    const pdf = await task.promise;
    const lines = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const { items } = await page.getTextContent();
      let line = '';
      for (const item of items) {
        if (typeof item.str !== 'string') continue;
        line += ' ' + item.str;
        if (!item.hasEOL) continue;
        lines.push(line.trim());
        line = '';
      }
      if (line.trim()) lines.push(line.trim());
    }
    return lines;
  } finally {
    await task.destroy();
  }
}

$('resumes').addEventListener('change', async event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  setBusy(true);
  $('profile-status').textContent = 'Reading résumés…';
  const messages = [];
  const fresh = [];
  for (const file of files) {
    try {
      const lines = await readResume(file);
      const clean = lines.map(line => line.replace(/\S+@\S+|\+?\d[\d ().-]{8,}\d/g, '').trim()).filter(Boolean);
      const extracted = evidence(clean);
      if (!Object.keys(extracted).length) {
        messages.push(`${file.name}: no matching skills found. Try a text PDF or TXT file.`);
        continue;
      }
      fresh.push({ id: `${file.name}:${file.size}:${file.lastModified}`, name: file.name, evidence: extracted });
    } catch (error) {
      messages.push(`${file.name}: ${error.message}`);
    }
  }
  local.resumes = [...new Map([...local.resumes, ...fresh].map(file => [file.id, file])).values()];
  if (persist()) $('profile-status').textContent = messages.join(' ') || 'Résumé skills added.';
  setBusy(false);
  updateResults();
});

function setBusy(busy) {
  profileBusy = busy;
  $('resumes').disabled = busy;
  $('github').disabled = busy;
  $('github-form').querySelector('button').disabled = busy;
  renderProfile();
}

$('github-form').addEventListener('submit', async event => {
  event.preventDefault();
  const value = $('github').value.trim();
  const username = value.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\/$/, '');
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(username)) {
    $('profile-status').textContent = 'Enter a GitHub username or profile URL.';
    return;
  }
  const request = async path => {
    const response = await fetch(`https://api.github.com/${path}`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
    return response.json();
  };
  setBusy(true);
  $('profile-status').textContent = 'Reading public GitHub activity…';
  try {
    const query = encodeURIComponent(`author:${username} is:pr is:merged -user:${username}`);
    const [user, prs, repos] = await Promise.allSettled([
      request(`users/${username}`),
      request(`search/issues?q=${query}&sort=updated&per_page=30`),
      request(`users/${username}/repos?sort=pushed&per_page=30`),
    ]);
    if (user.status === 'rejected') throw user.reason;
    const found = {};
    for (const pr of prs.value?.items ?? []) {
      const repo = pr.repository_url.split('/').slice(-2).join('/');
      for (const tag of tags(`${repo} ${pr.title}`)) {
        found[tag] ??= { text: `${pr.title} (${repo})`, url: pr.html_url };
      }
    }
    for (const repo of repos.value ?? []) {
      if (repo.fork || repo.archived) continue;
      for (const tag of tags(`${repo.language} ${repo.description} ${repo.topics?.join(' ').replace(/-/g, ' ')}`)) {
        found[tag] ??= { text: `Public repository: ${repo.full_name}`, url: repo.html_url };
      }
    }
    if (prs.status === 'rejected' && repos.status === 'rejected') throw prs.reason;
    local.github = { login: user.value.login, evidence: found };
    const partial = prs.status === 'rejected' || repos.status === 'rejected';
    if (persist()) $('profile-status').textContent = `Imported @${user.value.login}${partial ? ' (partial GitHub results).' : '.'}`;
  } catch (error) {
    $('profile-status').textContent = `GitHub import failed. ${error.message}`;
  } finally {
    setBusy(false);
    updateResults();
  }
});

$('export-profile').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(profileEvidence(), null, 2)], { type: 'application/json' }));
  const download = node('a');
  download.href = url;
  download.download = 'jobclaude-profile.json';
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('clear-profile').addEventListener('click', () => {
  local.resumes = [];
  local.github = null;
  $('github').value = '';
  if (persist()) $('profile-status').textContent = 'Profile cleared.';
  renderProfile();
  updateResults();
});

function card(lead, profile) {
  const article = node('article', '', 'lead');
  const top = node('div', '', 'lead-top');
  const kind = node('span', lead.kind === 'job' ? 'Open role' : 'Contribution', `kind ${lead.kind}`);
  const save = node('button', local.saved[lead.id] ? 'Saved' : 'Save', 'save');
  save.type = 'button';
  save.setAttribute('aria-pressed', String(Boolean(local.saved[lead.id])));
  save.setAttribute('aria-label', `${save.textContent} ${lead.title}`);
  save.addEventListener('click', () => {
    if (local.saved[lead.id]) delete local.saved[lead.id];
    else {
      const { matches, score, inTrack, ...sourceLead } = lead;
      local.saved[lead.id] = sourceLead;
    }
    persist();
    if (view === 'saved') {
      render();
      $('results').querySelector('.save')?.focus();
    } else {
      save.textContent = local.saved[lead.id] ? 'Saved' : 'Save';
      save.setAttribute('aria-pressed', String(Boolean(local.saved[lead.id])));
      save.setAttribute('aria-label', `${save.textContent} ${lead.title}`);
    }
  });
  top.append(kind, node('span', lead.org, 'org'), save);
  const title = node('h3');
  title.append(link(lead.title, lead.url));
  article.append(top, title, node('p', lead.location, 'location'));
  if (lead.experience) {
    const qualifier = lead.autoShortlisted ? ' · Scanner match' : '';
    article.append(node('p', lead.experience + qualifier, 'experience'));
  }
  if (lead.summary) article.append(node('p', lead.summary, 'description'));
  if (lead.route) {
    const route = node('div', '', 'route');
    route.append(node('strong', 'Way in'), node('p', lead.route));
    if (lead.contact) route.append(link(lead.contact.name, lead.contact.url));
    article.append(route);
  }
  const chips = node('div', '', 'tags');
  const labelOrder = [...new Set([...lead.matches, ...lead.tags])];
  for (const tag of labelOrder.slice(0, 6)) chips.append(node('span', tag, profile[tag] ? 'tag matched' : 'tag'));
  article.append(chips);
  if (lead.matches.length) {
    const details = node('details', '', 'evidence');
    const summary = node('summary', `Your evidence · ${lead.matches.length} shared skills`);
    const list = node('ul');
    for (const tag of lead.matches) {
      const row = node('li');
      row.append(node('strong', tag), document.createTextNode(' · '));
      const entry = profile[tag];
      row.append(typeof entry === 'string' ? document.createTextNode(entry) : link(entry.text, entry.url));
      const github = local.github?.evidence[tag];
      if (github && typeof entry === 'string') {
        row.append(document.createTextNode(' · '), link('GitHub evidence', github.url));
      }
      list.append(row);
    }
    details.append(summary, list);
    article.append(details);
  }
  const active = data.leads.some(item => item.id === lead.id);
  const fresh = active && !data.sources.some(source => source.key === lead.sourceKey && source.error);
  const note = fresh ? 'Source checked' : 'Last seen';
  const day = new Date(lead.checkedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  article.append(node('p', `${note} ${day}${lead.starter ? ' · Starter label' : ''}`, 'lead-date'));
  return article;
}

function teamGroups(leads) {
  const groups = new Map();
  for (const lead of leads) {
    const key = lead.org.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: lead.org, leads: [] });
    groups.get(key).leads.push(lead);
  }
  return [...groups.values()];
}

function teamCard(team, profile) {
  const section = node('details', '', 'lead team');
  const jobs = team.leads.filter(lead => lead.kind === 'job').length;
  const issues = team.leads.length - jobs;
  const summary = node('summary');
  summary.append(node('strong', team.name), node('span', `${jobs} roles · ${issues} issues`, 'location'));
  section.append(summary, ...team.leads.map(lead => card(lead, profile)));
  return section;
}

function render() {
  const profile = profileEvidence();
  const current = new Map(data.leads.map(lead => [lead.id, lead]));
  const candidates = view === 'saved'
    ? Object.values(local.saved).map(lead => current.get(lead.id) ?? lead)
    : data.leads.filter(lead => view === 'shortlist' ? lead.shortlisted : !['job', 'issue'].includes(view) || lead.kind === view);
  const query = $('search').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered = candidates.filter(lead => {
    const text = [lead.org, lead.title, lead.location, ...lead.tags].join(' ').toLowerCase();
    return query.every(word => text.includes(word));
  });
  const ranked = rank(filtered, profile, $('track').value);
  if (view === 'shortlist') ranked.sort((a, b) => a.priority - b.priority);
  const entries = view === 'teams' ? teamGroups(ranked) : ranked;
  $('results-heading').textContent = document.querySelector(`[data-view="${view}"]`).textContent;
  $('shortlist-note').hidden = view !== 'shortlist';
  $('result-count').textContent = scanReady || view === 'saved'
    ? `${entries.length} ${view === 'teams' ? 'teams' : 'leads'}`
    : '';
  const children = entries.slice(0, visible).map(entry => view === 'teams' ? teamCard(entry, profile) : card(entry, profile));
  if (!children.length) {
    const message = view === 'saved' ? 'No saved leads match these filters.'
      : scanReady ? 'No leads match these filters.' : 'Waiting for the source scan.';
    children.push(node('p', message, 'lead empty'));
  }
  $('results').replaceChildren(...children);
  $('more').hidden = entries.length <= visible;
}

function updateResults() {
  visible = 16;
  render();
}

for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    for (const tab of document.querySelectorAll('[data-view]')) {
      tab.setAttribute('aria-pressed', String(tab === button));
    }
    updateResults();
  });
}

$('more').addEventListener('click', () => {
  const previousCount = visible;
  visible += 16;
  render();
  const firstAdded = $('results').children[previousCount];
  if (firstAdded) {
    firstAdded.tabIndex = -1;
    firstAdded.focus({ preventScroll: true });
    firstAdded.scrollIntoView({ block: 'nearest' });
  }
});
$('track').addEventListener('change', updateResults);
$('search').addEventListener('input', updateResults);

function showFeed(feed, live) {
  Object.assign(data, feed);
  scanReady = true;
  const success = feed.sources.filter(source => !source.error).length;
  const stamp = new Date(feed.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('feed-status').textContent = `${live ? 'Last scan' : 'Deployment snapshot'} · ${stamp} · ${success}/${feed.sources.length} sources checked`;
  const coverage = $('sources-content');
  const rows = feed.sources.map(source => node('li', `${source.label} · ${source.error ?? `${source.count} leads`}`));
  const list = node('ul');
  list.append(...rows);
  coverage.replaceChildren(
    node('p', `${feed.discovery.completed}/${feed.discovery.queries} discovery searches completed. ${feed.discovery.found} repositories found.`),
    list,
  );
  render();
}

async function feedFrom(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(7000), cache: 'no-cache' });
  if (!response.ok) throw new Error('Feed unavailable');
  const feed = await response.json();
  if (!Array.isArray(feed.leads) || !Array.isArray(feed.sources) || !feed.discovery) throw new Error('Invalid feed');
  return feed;
}

async function loadFeed() {
  const latest = 'https://raw.githubusercontent.com/PoulavBhowmick03/jobclaude/main/public/data/latest.json';
  const [remote, localFeed] = await Promise.allSettled([feedFrom(latest), feedFrom('/data/latest.json')]);
  if (remote.status === 'fulfilled'
    && (localFeed.status === 'rejected' || remote.value.checkedAt >= localFeed.value.checkedAt)) {
    showFeed(remote.value, true);
  } else if (localFeed.status === 'fulfilled') {
    showFeed(localFeed.value, false);
  } else {
    $('feed-status').textContent = 'The source feed is unavailable. Reload the page to try again.';
  }
}

if (local.github) {
  $('github').value = local.github.login;
  $('profile-status').textContent = `Imported @${local.github.login}.`;
}
renderProfile();
render();
loadFeed();
