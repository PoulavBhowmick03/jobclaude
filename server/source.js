import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 3],
]) blocked.addSubnet(ip, prefix);

export function isPublicIpv4(address) {
  return isIP(address) === 4 && !blocked.check(address);
}

const allowHost = /^(?:[a-z\d-]+\.)+[a-z]{2,63}$/i;
const canonicalHost = (url) => url.hostname.replace(/^www\./, '');

export async function readPublicListing(url, signal = AbortSignal.timeout(8500), remaining = 1) {
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowHost.test(url.hostname)) return null;
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (signal.aborted || !addresses.length || addresses.some(({ address }) => !isPublicIpv4(address))) return null;
  const response = await new Promise((resolve, reject) => {
    const socket = request(url, {
      agent: false, signal, autoSelectFamily: false, family: 4,
      lookup: (_hostname, _options, callback) => callback(null, addresses[0].address, 4),
      headers: { 'User-Agent': 'Jobclaude listing verifier', Accept: 'text/html' },
    }, res => {
      const status = res.statusCode;
      const location = res.headers.location;
      if (status !== 200 || !res.headers['content-type']?.includes('text/html')) {
        res.resume();
        resolve({ status, location, html: '' });
        return;
      }
      let bytes = 0;
      const chunks = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1500000) res.destroy(new Error('Listing response exceeded size limit'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status, html: Buffer.concat(chunks).toString('utf8') }));
    });
    socket.on('error', reject);
    socket.end();
  });
  if (response.status >= 300 && response.status < 400 && response.location && remaining) {
    const next = new URL(response.location, url);
    if (canonicalHost(url) === canonicalHost(next)) return readPublicListing(next, signal, remaining - 1);
  }
  return response;
}

export function visibleText(html) {
  return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(?:li|p|h\d|div|section|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&(?:ndash|mdash);/gi, '–')
    .replace(/&#(?:8211|8212);/g, '–').replace(/&#43;/g, '+')
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
