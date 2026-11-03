import { useEffect, useState } from 'react';
import { joinOrigin, joinUrl } from './joinUrl.js';
import { resolvePhoneLink, securePhoneOrigin } from './phoneLinkState.js';

/** Runtime tunnel discovery also works with a TV opened on localhost. */
export function usePhoneLink(code) {
  const [link, setLink] = useState(() => ({ origin: securePhoneOrigin(joinOrigin()), status: 'connecting' }));
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    let retry;
    let controller;
    async function readLink() {
      controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch('/api/phone-link', { signal: controller.signal, cache: 'no-store' });
        const data = response.ok ? await response.json() : null;
        if (!disposed) setLink(current => resolvePhoneLink(current, data, window.location.origin));
      } catch {
        if (!disposed) setLink(current => resolvePhoneLink(current, null, window.location.origin));
      }
      finally {
        clearTimeout(timer);
        if (!disposed) { setLoading(false); retry = setTimeout(readLink, 10000); }
      }
    }
    void readLink();
    return () => { disposed = true; clearTimeout(retry); controller?.abort(); };
  }, []);
  return { url: link.origin ? joinUrl(code, link.origin) : null, loading, status: link.status };
}
