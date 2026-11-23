const pullUrl = /^https:\/\/github\.com\/([a-z\d-]+)\/([a-z\d._-]+)\/pull\/(\d+)$/i;
const loginPattern = /^[a-z\d][a-z\d-]{0,38}$/i;

function githubApi(fetcher) {
  return async path => {
    const response = await fetcher(`https://api.github.com/${path}`, {
      headers: {
        'User-Agent': 'Jobclaude',
        Accept: 'application/vnd.github+json',
        ...(process.env.GITHUB_READ_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_READ_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('GitHub unavailable');
    return response.json();
  };
}

export async function publicWork(username, fetcher = fetch) {
  if (!username) return { status: 'skipped', entries: [] };
  if (!loginPattern.test(username)) return { status: 'unavailable', entries: [] };
  const get = githubApi(fetcher);
  try {
    const query = encodeURIComponent(`author:${username} is:pr is:merged -user:${username}`);
    const { items } = await get(`search/issues?q=${query}&sort=updated&per_page=25`);
    return {
      status: 'checked',
      entries: items.filter(pr => pullUrl.test(pr.html_url))
        .map(pr => ({ title: String(pr.title).slice(0, 170), url: pr.html_url })),
    };
  } catch {
    return { status: 'unavailable', entries: [] };
  }
}

const stopwords = new Set(['about', 'added', 'adding', 'change', 'changes', 'config', 'docs', 'feature', 'improve', 'improved',
  'refactor', 'remove', 'support', 'tests', 'update', 'updated', 'using', 'with']);
const terms = value => new Set((value.toLowerCase().match(/[a-z][a-z\d-]{3,}/g) ?? []).filter(term => !stopwords.has(term)));

function nextIssue(issues, contribution, org, repo) {
  const prefix = `https://github.com/${org}/${repo}/issues/`;
  const contributionTerms = terms(contribution);
  const cutoff = Date.now() - 180 * 86400000;
  const matches = Array.isArray(issues) ? issues.flatMap(issue => {
    if (issue.pull_request || issue.assignee || issue.state !== 'open' || Date.parse(issue.updated_at) < cutoff ||
        !issue.html_url?.toLowerCase().startsWith(prefix.toLowerCase()) ||
        typeof issue.title !== 'string' || /\b(?:vulnerability|exploit|security disclosure|bypass|attack)\b/i.test(issue.title)) return [];
    const shared = [...terms(issue.title)].filter(term => contributionTerms.has(term));
    return [{ title: issue.title.slice(0, 170), url: issue.html_url, related: shared.length > 0, shared: shared.length }];
  }) : [];
  return matches.sort((a, b) => b.shared - a.shared)[0] ?? null;
}

export async function teamRoutes(username, entries, fetcher = fetch) {
  if (!loginPattern.test(username ?? '') || !Array.isArray(entries)) return { status: 'skipped', routes: [] };
  const get = githubApi(fetcher);
  const unique = new Map();
  for (const item of entries.slice(0, 35)) {
    const match = pullUrl.exec(item?.url ?? '');
    if (!match) continue;
    const [url, org, repo, number] = match;
    if (org.toLowerCase() === username.toLowerCase() || repo === '.' || repo === '..') continue;
    const key = org.toLowerCase();
    if (!unique.has(key)) unique.set(key, []);
    const group = unique.get(key);
    if (group.length < 2 && !group.some(contribution => contribution.url === url)) group.push({ url, org, repo, number });
  }
  const candidates = [...unique.values()].slice(0, 6);
  async function follow({ url, org, repo, number }) {
    const base = `repos/${org}/${repo}`;
    const [pull, reviews, issues] = await Promise.allSettled([
      get(`${base}/pulls/${number}`),
      get(`${base}/pulls/${number}/reviews?per_page=40`),
      get(`${base}/issues?state=open&sort=updated&direction=desc&per_page=12`),
    ]);
    if (pull.status === 'rejected') throw pull.reason;
    if (!pull.value.merged_at || pull.value.base?.repo?.archived || pull.value.user?.login?.toLowerCase() !== username.toLowerCase()) return null;
    const repository = `${org}/${repo}`;
    const contribution = String(pull.value.title).slice(0, 170);
    const confirmations = Array.isArray(reviews.value) ? reviews.value : [];
    const reviewer = confirmations.find(review =>
      review.state === 'APPROVED' && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(review.author_association) &&
      loginPattern.test(review.user?.login ?? '') && review.user.login.toLowerCase() !== username.toLowerCase() &&
      typeof review.html_url === 'string' && review.html_url.toLowerCase().startsWith(`${url.toLowerCase()}#pullrequestreview-`));
    const issue = nextIssue(issues.value, contribution, org, repo);
    return {
      team: repository,
      repoUrl: `https://github.com/${repository}`,
      contribution: { title: contribution, url },
      reviewer: reviewer ? { login: reviewer.user.login, url: reviewer.html_url } : null,
      issue: issue ? { title: issue.title, url: issue.url, related: issue.related } : null,
    };
  }
  const settled = await Promise.allSettled(candidates.map(async group => {
    const first = await follow(group[0]).catch(error => ({ error }));
    if ((first && !first.error && first.reviewer) || group.length === 1) {
      if (first?.error) throw first.error;
      return first;
    }
    const next = await follow(group[1]).catch(() => null);
    if (next?.reviewer || !first || first.error) return next;
    return first;
  }));
  const routes = settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
    .sort((a, b) => Number(Boolean(b.reviewer)) - Number(Boolean(a.reviewer))
      + 2 * (Number(Boolean(b.issue?.related)) - Number(Boolean(a.issue?.related))));
  return {
    status: settled.length && settled.every(result => result.status === 'rejected') ? 'unavailable' : 'checked',
    routes: routes.slice(0, 4),
  };
}
