export function createRazorpay(env = process.env, fetcher = fetch) {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');

  async function request(path, payload) {
    const result = await fetcher(`https://api.razorpay.com/v1/payment_links${path}`, {
      method: payload ? 'POST' : 'GET',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) throw new Error(`Razorpay HTTP ${result.status}`);
    return result.json();
  }

  return {
    find: async reference => {
      const data = await request(`?reference_id=${encodeURIComponent(reference)}`);
      if (!Array.isArray(data.payment_links)) throw new Error('Unexpected checkout lookup response');
      return data.payment_links.find(link => link.reference_id === reference);
    },
    get: id => {
      if (!/^plink_[a-z\d]+$/i.test(id)) throw new Error('Invalid payment link');
      return request(`/${id}`);
    },
    create: (pass, origin) => request('', {
      amount: pass.price,
      currency: 'INR',
      reference_id: pass.reference,
      accept_partial: false,
      description: 'Jobclaude live career report',
      callback_url: `${origin}/?checkout=return`,
      callback_method: 'get',
      expire_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    }),
  };
}

function matches(link, pass) {
  return link?.reference_id === pass.reference && link.currency === 'INR'
    && link.amount === pass.price && /^plink_[a-z\d]+$/i.test(link.id);
}

export function fullyPaid(link, pass) {
  return matches(link, pass) && link.status === 'paid' && link.amount_paid === pass.price;
}

export async function reconcilePayment(token, pass, store, razorpay) {
  if (pass.state !== 'checkout' || !pass.paymentId) return pass;
  const link = await razorpay.get(pass.paymentId);
  if (fullyPaid(link, pass)) {
    await store.patch(token, { state: 'checkout', paymentId: pass.paymentId }, { state: 'paid' });
  } else if (matches(link, pass) && ['expired', 'cancelled'].includes(link.status)) {
    await store.patch(token, { state: 'checkout', paymentId: pass.paymentId }, { state: 'expired' });
  }
  return store.get(token);
}

export async function checkout(token, pass, store, razorpay, origin) {
  if (pass.state !== 'ready' && pass.state !== 'checkout') return pass;
  if (pass.paymentId) return reconcilePayment(token, pass, store, razorpay);
  if (pass.state === 'ready') {
    const won = await store.patch(token, { state: 'ready' }, { state: 'checkout' });
    if (!won) return store.get(token);
  }
  let link = await razorpay.find(pass.reference);
  if (!link) {
    try {
      link = await razorpay.create(pass, origin);
    } catch (error) {
      // A timeout can happen after Razorpay creates the link.
      link = await razorpay.find(pass.reference);
      if (!link) throw error;
    }
  }
  if (!matches(link, pass) || !/^https:\/\/(?:rzp\.io|razorpay\.me|rzpy\.in)\//i.test(link.short_url ?? '')) {
    throw new Error('Razorpay link does not match this pass');
  }
  await store.patch(token, { state: 'checkout' }, { paymentId: link.id, paymentUrl: link.short_url });
  const current = await store.get(token);
  return reconcilePayment(token, current, store, razorpay);
}
