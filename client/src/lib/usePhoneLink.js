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
    let requestTimeout;
    let currentLink = link;
    function updateLink(data) {
      if (disposed) return;
      currentLink = resolvePhoneLink(currentLink, data, window.location.origin);
      setLink(currentLink);
    }
    async function readLink() {
      controller = new AbortController();
      requestTimeout = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch('/api/phone-link', { signal: controller.signal, cache: 'no-store' });
        const data = response.ok ? await response.json() : null;
        updateLink(data);
      } catch {
        updateLink(null);
      }
      finally {
        clearTimeout(requestTimeout);
        if (!disposed) {
          setLoading(false);
          const waiting = !currentLink.origin && ['connecting', 'reconnecting', 'unavailable'].includes(currentLink.status);
          retry = setTimeout(readLink, waiting ? 1000 : 10000);
        }
      }
    }
    void readLink();
    return () => { disposed = true; clearTimeout(retry); clearTimeout(requestTimeout); controller?.abort(); };
  }, []);
  return { url: link.origin ? joinUrl(code, link.origin) : null, loading, status: link.status };
}
