# Jobclaude

Jobclaude reviews a résumé and searches for matching engineering roles on demand. The workspace streams the review and each search result to the browser. Search results show the source text for work mode, location, and experience. Set your base country, office cities, relocation preference, and experience range before starting. Missing evidence is marked for review.

## Preview

Open [Jobclaude](https://jobclaude.vercel.app). Select **See an example report** to inspect the format. The example uses fictional candidate and employer data.

## Private pilot on Vercel

1. Set `APP_ORIGIN` to the exact production origin, such as `https://jobclaude.vercel.app`.
2. Set `RESEARCH_PROVIDER=vercel` to use the project’s Vercel AI Gateway OIDC token. Alternatively, set `OPENAI_API_KEY`.
3. Generate a private pilot code and set `PILOT_ACCESS_CODE` in the project.
4. Redeploy and enter the private code in the research form.

Use a random code with 24 or more URL-safe characters. Keep the code and model key out of Git. The pilot uses no payment service or report database. Download results before closing the page. Keep the pilot code private. Use the AI Gateway free balance or configure a provider budget before sharing access.

The browser extracts text from PDF or TXT files. The API removes common email and phone formats before model submission. Avoid including unnecessary sensitive details. The reference search receives a role brief. The OpenAI API requests set `store: false`. An optional GitHub username enables a check of public merged PRs. The report links to actual approvals from repository collaborators and to current issues when available. These routes do not establish a vacancy or a referral.

## Checkout

Keep checkout disabled during the pilot. The checkout flow uses Razorpay Payment Links and one paid report per browser pass.

Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `REPORT_PRICE_PAISE`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` for test mode. Activate live keys and `ENABLE_LIVE_PAYMENTS=true` only after testing payments and confirming the commercial hosting plan. A paid report is stored for up to seven days. Resume input is processed by the research service and is not written to the report database.

## Develop

```sh
npm ci
npm test
npm run build
vercel dev
```

The local tests exercise report streaming and payment verification with test doubles. Legacy source scan scripts remain available for local use.
