import { useEffect, useState } from 'react';
import { joinOrigin, joinUrl } from './joinUrl.js';

const secure = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
};

/** Runtime tunnel discovery also works with a TV opened on localhost. */
export function usePhoneLink(code) {
  const [origin, setOrigin] = useState(() => secure(joinOrigin()));
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch('/api/phone-link', { signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (secure(data?.origin)) setOrigin(secure(data.origin)); })
      .catch(() => {})
      .finally(() => { clearTimeout(timer); setLoading(false); });
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);
  return { url: origin ? joinUrl(code, origin) : null, loading };
}
