# Jobclaude

Jobclaude finds engineering teams that hire for your skills and open-source projects where you could contribute. It shows the source for each lead.

## Use the dashboard

1. Open [Jobclaude](https://jobclaude.vercel.app).
2. Add one or more text-based PDF or TXT résumés.
3. Enter your GitHub username and select **Import**.
4. Select a track or search by location, company, or skill.
5. Open **Your evidence** on a lead to see where a shared skill came from.
6. Select **Teams** for the company and project list, or **Save** to keep a lead.

The browser stores selected résumé excerpts, imported GitHub evidence, and saved leads on the current device. Clear the profile to remove résumé and GitHub evidence from browser storage. GitHub receives the username you ask it to look up.

Keyword matches are starting points for reading. Check the source for hiring geography, work authorization, seniority, and open status.

## Run locally

Use Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Run `npm test` to check the matching rules. Run `npm run build` to build the static dashboard.

## Refresh the public feed

GitHub Actions checks configured employer boards and public GitHub repositories every day at 03:17 UTC (08:47 IST). Three GitHub searches add repositories to a rotating watchlist. The scan records source failures and keeps recently verified results for up to seven days.

The workflow writes the public feed to `public/data/latest.json`. The dashboard loads this file from GitHub and falls back to a copy from its deployment. The workflow uses the repository's built-in GitHub token.

To start a scan, open **Actions**, select **Scan career leads**, and select **Run workflow**. To change coverage, edit `scripts/sources.mjs`. For a local scan, run the following commands with the GitHub CLI signed in.

```sh
GH_TOKEN="$(gh auth token)" npm run scan
npm run dev
```

Standard GitHub-hosted runners are free for public repositories. Vercel Hobby is free for personal use within plan limits. GitHub can delay scheduled runs and disables inactive public schedules after 60 days. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) · [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) · [Vercel Hobby](https://vercel.com/docs/plans/hobby)

## Review leads with a local model

This optional step uses a local Ollama model to pick up to five leads for further reading. It uses the premise that you found a job six months from now and asks which leads could plausibly explain that outcome. The script accepts only picks that refer to real feed entries and shared skills.

1. Select **Export skills** in the dashboard.
2. Store the exported profile in the ignored `private/` directory.
3. Install Ollama and start it with `OLLAMA_NO_CLOUD=1`.
4. Download a local model and set `OLLAMA_MODEL` to its name.
5. Pull the current feed and run the review.

```sh
git pull --ff-only
OLLAMA_MODEL="<downloaded-model>" npm run review -- private/jobclaude-profile.json "Applied AI"
```

Use your OS scheduler to run this command periodically on an awake machine. Keep the output in `private/`. Ollama's local mode has no model API fees. [Ollama local-only mode](https://docs.ollama.com/faq#how-do-i-disable-ollama-s-cloud-features)
