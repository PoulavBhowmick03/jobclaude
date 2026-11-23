import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Redis } from '@upstash/redis';

export const ttl = 7 * 24 * 60 * 60;
const cookieName = 'jobclaude_pass';

export function config(env = process.env) {
  const price = Number(env.REPORT_PRICE_PAISE);
  const origin = env.APP_ORIGIN?.trim();
  const pilotCode = env.PILOT_ACCESS_CODE?.trim();
  const validOrigin = /^https:\/\/[^/?#]+$/.test(origin ?? '');
  const pilot = Boolean(validOrigin && (env.OPENAI_API_KEY || env.RESEARCH_PROVIDER?.trim() === 'vercel') && /^[a-zA-Z0-9_-]{24,128}$/.test(pilotCode ?? ''));
  const key = env.RAZORPAY_KEY_ID;
  const testMode = key?.startsWith('rzp_test_');
  const complete = Boolean(
    env.OPENAI_API_KEY && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN &&
    key && env.RAZORPAY_KEY_SECRET && validOrigin &&
    Number.isSafeInteger(price) && price >= 100 && price <= 1000000 &&
    (testMode || (key.startsWith('rzp_live_') && env.ENABLE_LIVE_PAYMENTS === 'true')),
  );
  return { enabled: complete || pilot, pilot: !complete && pilot, pilotCode, origin, price, testMode };
}

export function readCookie(request) {
  const row = request.headers.get('cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`));
  const token = row?.slice(cookieName.length + 1);
  return /^[a-f\d]{64}$/.test(token ?? '') ? token : null;
}

export function cookie(token, secure) {
  return `${cookieName}=${token}; Path=/; Max-Age=${ttl}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

const keyFor = token => `jobclaude:pass:${createHash('sha256').update(token).digest('hex')}`;

const patchScript = `
  local original = redis.call('GET', KEYS[1])
  if not original then return 0 end
  local state = cjson.decode(original)
  local expected = cjson.decode(ARGV[1])
  for key, value in pairs(expected) do
    if state[key] ~= value then return 0 end
  end
  for key, value in pairs(cjson.decode(ARGV[2])) do
    state[key] = value
  end
  redis.call('SET', KEYS[1], cjson.encode(state), 'EX', ARGV[3])
  return 1
`;

export function createStore(redis = Redis.fromEnv()) {
  return {
    get: token => redis.get(keyFor(token)),
    new: async price => {
      const token = randomBytes(32).toString('hex');
      const pass = { state: 'ready', reference: randomUUID(), price, attempts: 0 };
      await redis.set(keyFor(token), pass, { nx: true, ex: ttl });
      return { token, pass };
    },
    patch: async (token, expected, update) => Number(await redis.eval(
      patchScript, [keyFor(token)], [JSON.stringify(expected), JSON.stringify(update), String(ttl)],
    )) === 1,
  };
}

export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function allowedOrigin(request, settings) {
  return request.headers.get('origin') === settings.origin;
}

export function publicPass(pass, settings) {
  return {
    enabled: true,
    testMode: settings.testMode,
    price: pass?.price ?? settings.price,
    state: pass?.state ?? 'ready',
    ...(pass?.state === 'checkout' && pass.paymentUrl ? { paymentUrl: pass.paymentUrl } : {}),
    ...(pass?.state === 'complete' ? { report: JSON.parse(pass.reportJson) } : {}),
  };
}

export function validPilot(request, settings) {
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${settings.pilotCode}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
