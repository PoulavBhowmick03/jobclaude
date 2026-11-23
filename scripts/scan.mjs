import { readFile, writeFile, rename } from 'node:fs/promises';
import { tags } from '../src/match.js';
import { boards, repositories } from './sources.mjs';
import { startupFit } from './eligibility.mjs';
import { shortlist } from './shortlist.mjs';

const checkedAt = new Date().toISOString();
const recentCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
const output = new URL('../public/data/latest.json', import.meta.url);
const previous = await readFile(output, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return { leads: [] };
  throw error;
});
const headers = { 'User-Agent': 'jobclaude-source-scanner' };
const githubHeaders = process.env.GH_TOKEN
  ? { ...headers, Authorization: `Bearer ${process.env.GH_TOKEN}` }
  : headers;

async function json(url, requestHeaders = headers) {
  const response = await fetch(url, { headers: requestHeaders, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function batch(items, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += 5) {
    const chunk = items.slice(i, i + 5);
    results.push(...await Promise.all(chunk.map(worker)));
  }
  return results;
}

async function collect(kind, key, label, lookup) {
  try {
    const leads = await lookup();
    return { kind, key, label, count: leads.length, leads };
  } catch (error) {
    const leads = previous.leads.filter(lead => lead.sourceKey === key && lead.checkedAt >= recentCutoff);
    return { kind, key, label, error: error.message, count: leads.length, leads };
  }
}

const ats = {
  greenhouse: slug => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  ashby: slug => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
  lever: slug => `https://api.lever.co/v0/postings/${slug}?mode=json`,
};

const engineering = /\bengineer(?:ing)?\b|developer|research|\brust\b|architect|technical (?:lead|support)|member of technical staff/i;
const irrelevant = /account executive|sales development|recruit|marketing|talent acquisition/i;
const plain = value => String(value ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ' ').replace(/&[\w#]+;/g, ' ').replace(/\s+/g, ' ').trim();

function safeUrl(value) {
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

async function board([org, system, slug, startup]) {
  const sourceKey = `${system}:${slug}`;
  return collect('board', sourceKey, org, async () => {
    const body = await json(ats[system](slug));
    const jobs = system === 'lever' ? body : body.jobs;
    if (!Array.isArray(jobs)) throw new Error('Unexpected job board response');
    return jobs.flatMap(job => {
      const title = job.title ?? job.text ?? '';
      const url = safeUrl(job.absolute_url ?? job.jobUrl ?? job.hostedUrl);
      if (!url || !engineering.test(title) || irrelevant.test(title)) return [];
      const description = plain(job.content ?? job.descriptionPlain ?? job.description);
      const titleTags = tags(title);
      const found = [...new Set([...titleTags, ...tags(description)])];
      if (!found.length) return [];
      const primary = job.location?.name ?? job.location ?? job.categories?.location ?? 'See posting';
      const secondary = (job.secondaryLocations ?? []).map(item => item.location).filter(Boolean);
      const location = [...new Set([primary, ...secondary])].join(' · ');
      const experience = startup && startupFit(title, location, description, found);
      const discovered = experience ? {
        experience, shortlisted: true, autoShortlisted: true, priority: 4,
        route: 'Open the source to check the requirements and application route. Pick one shipped project that demonstrates a core skill on the posting.',
      } : {};
      return [{
        ...discovered,
        id: `job:${sourceKey}:${job.id ?? url}`, sourceKey, kind: 'job', org, title, url, checkedAt,
        location, tags: found,
        fitTitle: titleTags.length * 3, summary: description.slice(0, 220),
      }];
    });
  });
}

const cutoff = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
const queries = ['language:Rust topic:ethereum', 'language:Rust topic:distributed-systems', 'topic:ai-agents'];
async function discover() {
  const results = await Promise.allSettled(queries.map(async query => {
    const q = encodeURIComponent(`${query} stars:>100 archived:false pushed:>${cutoff}`);
    const { items } = await json(`https://api.github.com/search/repositories?q=${q}&sort=updated&per_page=10`, githubHeaders);
    return items.filter(repo => !repo.fork).map(repo => [repo.owner.login, repo.full_name]);
  }));
  const seen = new Set(repositories.map(([, repo]) => repo.toLowerCase()));
  const discovered = [];
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Repository discovery:', result.reason.message);
      continue;
    }
    for (const [owner, repo] of result.value) {
      if (seen.has(repo.toLowerCase())) continue;
      seen.add(repo.toLowerCase());
      discovered.push([owner, repo]);
    }
  }
  return { discovered, completed: results.filter(result => result.status === 'fulfilled').length };
}

async function issues([org, repo]) {
  const sourceKey = `github:${repo}`;
  return collect('github', sourceKey, repo, async () => {
    const base = `https://api.github.com/repos/${repo}`;
    const [info, items] = await Promise.all([
      json(base, githubHeaders),
      json(`${base}/issues?state=open&sort=updated&per_page=30`, githubHeaders),
    ]);
    const repoTags = tags(`${info.language} ${info.description} ${info.topics?.join(' ').replace(/-/g, ' ')}`);
    if (info.archived) return [];
    return items.filter(issue => !issue.pull_request && !issue.assignees?.length)
      .map(issue => {
        const starter = issue.labels.some(label => /good first issue|help wanted|beginner|easy|starter/i.test(label.name));
        const summary = plain(issue.body).slice(0, 260);
        const titleTags = tags(issue.title);
        const found = [...new Set([...titleTags, ...repoTags, ...tags(summary)])];
        return {
          id: `issue:${issue.id}`, sourceKey, kind: 'issue', org, title: issue.title, url: safeUrl(issue.html_url),
          checkedAt, updatedAt: issue.updated_at, location: repo, starter, tags: found, summary,
          fitTitle: titleTags.length * 3 + (starter ? 5 : 0),
        };
      })
      .filter(issue => issue.url && issue.tags.length && (issue.starter || issue.updatedAt.slice(0, 10) >= cutoff))
      .sort((a, b) => Number(b.starter) - Number(a.starter) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 4);
  });
}

async function checkShortlist(entry, boardResults) {
  const { key, board, issue, marker, ...details } = entry;
  const sourceKey = `shortlist:${key}`;
  return collect('shortlist', sourceKey, entry.org, async () => {
    if (board) {
      const result = boardResults.find(source => source.key === board);
      if (!result || result.error) throw new Error('Hiring board unavailable');
      if (!result.leads.some(lead => lead.url === entry.url)) return [];
    } else if (issue) {
      const item = await json(`https://api.github.com/repos/${issue}`, githubHeaders);
      if (item.state !== 'open' || item.assignees.length) return [];
    } else {
      const response = await fetch(entry.url, { headers, signal: AbortSignal.timeout(12000) });
      if (response.status === 404 || response.status === 410) return [];
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const page = await response.text();
      const text = plain(page.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/&amp;/g, '&'));
      if (!text.toLowerCase().includes(marker.toLowerCase())) return [];
    }
    return [{ ...details, id: sourceKey, sourceKey, checkedAt, shortlisted: true }];
  });
}

const [boardResults, discovery] = await Promise.all([batch(boards, board), discover()]);
const watch = new Map([...repositories, ...discovery.discovered].map(entry => [entry[1].toLowerCase(), entry]));
for (const lead of previous.leads) {
  if (lead.kind === 'issue' && !lead.shortlisted && !watch.has(lead.location.toLowerCase())) {
    watch.set(lead.location.toLowerCase(), [lead.org, lead.location]);
  }
}
const fixed = new Set(repositories.map(([, repo]) => repo.toLowerCase()));
const rotated = [...watch.values()].filter(([, repo]) => !fixed.has(repo.toLowerCase()));
const start = rotated.length > 25 ? Math.floor(Date.now() / 86400000) % rotated.length : 0;
const selected = [...repositories, ...[...rotated.slice(start), ...rotated.slice(0, start)].slice(0, 25)];
const [issueResults, shortlistResults] = await Promise.all([
  batch(selected, issues),
  batch(shortlist, entry => checkShortlist(entry, boardResults)),
]);
const results = [...boardResults, ...issueResults, ...shortlistResults];
if (results.every(result => result.error)) throw new Error('All sources failed. Previous feed preserved.');
const checkedKeys = new Set(results.map(result => result.key));
const retained = previous.leads.filter(lead => !checkedKeys.has(lead.sourceKey)
  && lead.checkedAt >= recentCutoff);
const reviewed = new Map(shortlistResults.flatMap(source => source.leads).map(lead => [lead.url, lead]));
const found = [...retained, ...results.flatMap(result => result.leads)];
const leads = [...new Map(found.filter(lead => !reviewed.has(lead.url) || reviewed.get(lead.url).id === lead.id).map(lead => [lead.id, lead])).values()];
const dataset = {
  checkedAt,
  discovery: { queries: queries.length, completed: discovery.completed, found: discovery.discovered.length },
  sources: results.map(({ leads: ignored, ...source }) => source),
  leads,
};
await writeFile(new URL('./latest.tmp', output), JSON.stringify(dataset) + '\n');
await rename(new URL('./latest.tmp', output), output);
for (const result of results.filter(item => item.error)) console.warn(`${result.label}: ${result.error}`);
console.log(`${leads.length} leads · ${results.filter(item => !item.error).length}/${results.length} sources checked · ${discovery.discovered.length} repositories discovered`);
