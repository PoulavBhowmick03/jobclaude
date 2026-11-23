import { allowedOrigin, config, cookie, createStore, json, publicPass, readCookie } from '../server/session.js';
import { checkout, createRazorpay, reconcilePayment } from '../server/payment.js';

export async function handleSession(request, dependencies = {}) {
  const settings = dependencies.settings ?? config();
  if (!settings.enabled) return json({ enabled: false, state: 'preview' });
  if (settings.pilot && request.method === 'GET') return json({ enabled: true, pilot: true, state: 'pilot' });
  if (settings.pilot) return json({ error: 'Checkout is off during the private pilot.' }, 405);
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  if (request.method === 'POST' && !allowedOrigin(request, settings)) return json({ error: 'Invalid origin.' }, 403);

  try {
    const store = dependencies.store ?? createStore();
    let token = readCookie(request);
    let pass = token && await store.get(token);
    let headers = {};
    if (!pass) {
      if (request.method === 'POST') return json({ error: 'Reload this page to start a checkout.' }, 409);
      ({ token, pass } = await store.new(settings.price));
      headers = { 'Set-Cookie': cookie(token, settings.origin.startsWith('https:')) };
    }
    if (request.method === 'GET') return json(publicPass(pass, settings), 200, headers);

    const action = new URL(request.url).searchParams.get('action');
    if (action === 'new' && ['complete', 'expired'].includes(pass.state)) {
      ({ token, pass } = await store.new(settings.price));
      return json(publicPass(pass, settings), 200, { 'Set-Cookie': cookie(token, settings.origin.startsWith('https:')) });
    }
    const razorpay = dependencies.razorpay ?? createRazorpay();
    if (action === 'checkout') pass = await checkout(token, pass, store, razorpay, settings.origin);
    else if (action === 'refresh') pass = await reconcilePayment(token, pass, store, razorpay);
    else return json({ error: 'Unknown checkout action.' }, 400);
    return json(publicPass(pass, settings));
  } catch {
    return json({ error: 'Checkout is temporarily unavailable. Check your payment before trying again.' }, 502);
  }
}

export default { fetch: handleSession };
