import './style.css';
import { readResume } from './resume.js';

const $ = id => document.getElementById(id);
const ui = {
  session: null, resume: '', running: false, loadingFile: false, report: null,
  critique: null, leads: [], activity: new Map(), seen: new Set(),
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function external(text, url) {
  const anchor = element('a', text);
  try {
    if (new URL(url).protocol === 'https:') {
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
    }
  } catch {
    // Leave malformed links inactive.
  }
  return anchor;
}

function setMessage(message) {
  $('brief-message').textContent = message;
}

function updateControls() {
  const pass = ui.session;
  const state = pass?.state;
  $('payment-link').hidden = state !== 'checkout' || !pass.paymentUrl;
  if (state === 'checkout' && pass.paymentUrl) $('payment-link').href = pass.paymentUrl;
  $('refresh').hidden = !['checkout', 'running'].includes(state) || ui.running;
  $('new-pass').hidden = !['complete', 'expired'].includes(state);
  $('resumes').disabled = ui.running || ui.loadingFile;
  $('start').disabled = !pass?.enabled || ui.running || ui.loadingFile || ['complete', 'expired'].includes(state);
  $('start').hidden = state === 'checkout' && Boolean(pass.paymentUrl);
  $('pilot-field').hidden = !pass?.pilot;
  $('pilot-code').required = Boolean(pass?.pilot);
  if (state === 'paid' || state === 'running' || state === 'pilot') $('start').textContent = ui.running ? 'Research running…' : 'Start live research';
  else $('start').textContent = state === 'checkout' ? 'Resume checkout' : 'Continue to checkout';
  if (!pass) return;
  if (!pass.enabled) {
    $('pass-label').textContent = 'Product preview · Live checkout is unavailable.';
    return;
  }
  if (pass.pilot) {
    $('pass-label').textContent = 'Private pilot · No payment required.';
    return;
  }
  const price = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(pass.price / 100);
  const mode = pass.testMode ? ' · Test checkout' : '';
  $('pass-label').textContent = ['paid', 'running', 'complete'].includes(state)
    ? `Report paid${mode}` : `${price} for one live report${mode}`;
}

async function session(action) {
  const path = action ? `/api/session?action=${action}` : '/api/session';
  const response = await fetch(path, action ? { method: 'POST' } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Could not check report availability.');
  ui.session = data;
  if (data.report) showReport(data.report);
  updateControls();
  return data;
}

$('resumes').addEventListener('change', async event => {
  const files = [...event.currentTarget.files];
  ui.resume = '';
  if (!files.length || files.length > 2) {
    $('resume-status').textContent = 'Choose one or two files.';
    return;
  }
  ui.loadingFile = true;
  updateControls();
  try {
    const extracted = await Promise.all(files.map(readResume));
    const text = extracted.map(lines => lines.join('\n').trim()).filter(Boolean).join('\n\n--- Résumé version ---\n\n');
    if (text.length < 200) throw new Error('Use a text-based PDF or TXT file with at least 200 characters.');
    if (text.length > 22000) throw new Error('Use a shorter résumé or upload one version at a time.');
    ui.resume = text;
    $('resume-status').textContent = files.length === 1 ? 'Résumé ready.' : 'Both résumé versions are ready.';
  } catch (error) {
    $('resume-status').textContent = error.message;
  } finally {
    ui.loadingFile = false;
    updateControls();
  }
});

function reportSection(title) {
  const section = element('section', '', 'panel result');
  section.append(element('h3', title));
  return section;
}

function renderCritique(critique) {
  const section = reportSection('Résumé teardown');
  section.append(element('p', critique.verdict, 'verdict'));
  if (critique.github?.status === 'unavailable') section.append(element('p', 'GitHub could not be checked during this run.', 'hint'));
  const strength = element('div', '', 'critique-group');
  if (critique.strengths.length) strength.append(element('h4', 'What to lead with'));
  for (const row of critique.strengths) {
    strength.append(element('strong', row.claim), element('p', row.evidence));
  }
  section.append(strength);
  const issues = element('div', '', 'critique-group');
  if (critique.issues.length) issues.append(element('h4', 'What to fix'));
  for (const row of critique.issues) {
    issues.append(element('strong', row.issue), element('blockquote', row.evidence), element('p', row.fix));
  }
  section.append(issues);
  if (critique.github?.entries?.length) {
    const sources = element('details', '', 'critique-group github-work');
    const list = element('ul');
    for (const work of critique.github.entries) {
      const item = element('li');
      item.append(external(work.title, work.url));
      list.append(item);
    }
    sources.append(element('summary', 'Public merged work checked'), list);
    section.append(sources);
  }
  return section;
}

function renderLead(lead) {
  const labels = { direct: 'Direct fit', stretch: 'Stretch', conversation: 'Conversation route' };
  const section = reportSection(lead.company);
  section.classList.add('lead');
  section.prepend(element('span', labels[lead.fit], `badge ${lead.fit}`));
  section.append(element('strong', lead.role), element('p', [lead.location, lead.experience].filter(Boolean).join(' · '), 'hint'));
  section.append(element('p', lead.hiringSignal));
  for (const [label, value] of [['What to show', lead.proofToLeadWith], ['Way in', lead.route]]) {
    const item = element('div', '', 'route');
    item.append(element('strong', label), element('p', value));
    section.append(item);
  }
  section.append(external('Open source', lead.url));
  return section;
}

function renderWorkspace() {
  $('empty').hidden = Boolean(ui.critique || ui.leads.length || ui.activity.size);
  const activity = [...ui.activity].map(([name, detail]) => {
    const item = element('div', '', 'activity-item');
    item.append(element('strong', name), element('span', detail));
    return item;
  });
  $('activity').replaceChildren(...activity);
  const output = [];
  if (ui.critique) output.push(renderCritique(ui.critique));
  if (ui.leads.length) {
    const section = element('div', '', 'lead-list');
    section.append(element('h3', ui.running ? 'Leads coming in' : 'Your shortlist'));
    section.append(...ui.leads.map(renderLead));
    output.push(section);
  } else if (ui.report && ui.critique) {
    output.push(element('p', 'The report returned no leads with enough source evidence.', 'panel hint'));
  }
  if (ui.report?.failedSearches) {
    output.push(element('p', `${ui.report.failedSearches} search paths could not finish. The other results are shown above.`, 'hint'));
  }
  $('output').replaceChildren(...output);
  $('download').hidden = !ui.report;
}

function showReport(report, example = false) {
  ui.report = report;
  ui.critique = report.critique;
  ui.leads = report.leads;
  ui.activity.clear();
  $('mode').textContent = example ? 'Example report' : 'Complete';
  renderWorkspace();
}

function showProgress(event, data) {
  if (event === 'progress') ui.activity.set(data.name, data.detail);
  if (event === 'critique') {
    ui.critique = data;
    ui.activity.set('Résumé reviewer', 'Critique ready.');
  }
  if (event === 'leads') {
    for (const lead of data.leads) {
      const company = lead.company.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!ui.seen.has(company)) {
        ui.seen.add(company);
        ui.leads.push(lead);
      }
    }
    ui.activity.set(data.name, `${data.leads.length} source-backed leads returned.`);
  }
  if (event === 'complete') {
    ui.running = false;
    showReport(data);
    return;
  }
  if (event === 'failed') throw new Error(data.message);
  renderWorkspace();
}

async function readStream(response) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += value;
      let end = pending.indexOf('\n\n');
      while (end !== -1) {
        const chunk = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const [event, data] = chunk.split('\n');
        if (event.startsWith('event: ') && data?.startsWith('data: ')) showProgress(event.slice(7), JSON.parse(data.slice(6)));
        end = pending.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

$('brief').addEventListener('submit', async event => {
  event.preventDefault();
  if (!ui.resume) {
    setMessage('Add your résumé before continuing.');
    return;
  }
  const github = $('github').value.trim().replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\/$/, '');
  if (github && !/^[a-z\d][a-z\d-]{0,38}$/i.test(github)) {
    setMessage('Use a GitHub username or profile URL.');
    return;
  }
  if (!['paid', 'running', 'pilot'].includes(ui.session.state)) {
    $('start').disabled = true;
    try {
      const pass = await session('checkout');
      setMessage(pass.paymentUrl ? 'Checkout opens in a new tab. Return here and check payment when it finishes.' : 'Check your payment status to continue.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      updateControls();
    }
    return;
  }

  ui.running = true;
  ui.report = null;
  ui.critique = null;
  ui.leads = [];
  ui.activity.clear();
  ui.seen.clear();
  $('mode').textContent = 'Live';
  setMessage('');
  renderWorkspace();
  updateControls();
  try {
    const response = await fetch('/api/research', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ui.session.pilot ? { Authorization: `Bearer ${$('pilot-code').value.trim()}` } : {}),
      },
      body: JSON.stringify({
        resume: ui.resume,
        github,
        preferences: { roles: $('roles').value.trim(), locations: $('locations').value.trim(), experience: $('experience').value },
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    await readStream(response);
    if (!ui.report) throw new Error('The connection closed. Check your report status.');
    if (!ui.session.pilot) ui.session.state = 'complete';
  } catch (error) {
    $('mode').textContent = 'Interrupted';
    setMessage(error.message);
    await session().catch(() => {});
  } finally {
    ui.running = false;
    updateControls();
  }
});

$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  try {
    const pass = await session('refresh');
    const messages = {
      paid: 'Payment confirmed. Start your live research when ready.',
      checkout: 'Payment is still pending. If you paid, check again shortly.',
      expired: 'Checkout expired. You can start a new report.',
      running: 'Your report is still running. Check again shortly.',
    };
    setMessage(messages[pass.state] ?? '');
  } catch (error) {
    setMessage(error.message);
  } finally {
    $('refresh').disabled = false;
  }
});

$('new-pass').addEventListener('click', async () => {
  try {
    await session('new');
    setMessage('A new checkout is ready. You can still download the previous report before starting.');
  } catch (error) {
    setMessage(error.message);
  }
});

async function showSample() {
  if (ui.running) return;
  const { sample } = await import('./sample.js');
  showReport(sample, true);
  $('workspace-heading').scrollIntoView({ block: 'nearest' });
}

$('sample').addEventListener('click', showSample);
$('sample-top').addEventListener('click', showSample);
$('download').addEventListener('click', () => {
  if (!ui.report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(ui.report, null, 2)], { type: 'application/json' }));
  const anchor = element('a');
  anchor.href = url;
  anchor.download = 'jobclaude-report.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
});

const callback = new URLSearchParams(location.search).has('checkout');
if (callback) history.replaceState({}, '', location.pathname);
session().then(pass => {
  if (callback && pass.state === 'checkout') $('refresh').click();
}).catch(error => {
  $('pass-label').textContent = 'Could not check live availability.';
  setMessage(error.message);
});
