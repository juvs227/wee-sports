export function securePhoneOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

/** Managed tunnel status wins; an unmanaged HTTPS page is already reachable. */
export function resolvePhoneLink(current, data, pageOrigin) {
  if (['connecting', 'reconnecting', 'unavailable'].includes(data?.status)) {
    return { origin: null, status: data.status };
  }
  const origin = securePhoneOrigin(data?.origin);
  if (origin) return { origin, status: 'ready' };
  if (data?.status === 'local') {
    const currentPage = securePhoneOrigin(pageOrigin);
    return { origin: currentPage, status: currentPage ? 'ready' : 'local' };
  }
  // Discovery failure is not evidence that a previously working URL changed.
  // With no URL yet, finish the loading state instead of waiting indefinitely.
  return current.origin ? { ...current, status: 'ready' } : { origin: null, status: 'unavailable' };
}
