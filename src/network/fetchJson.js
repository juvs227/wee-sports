/** Bound the entire response, including its body, on browser and native fetch.
 * Mutating requests are attempted once; a timeout does not prove they failed.
 */
export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const {signal, ...requestOptions} = options;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once: true});
  let timedOut = false;
  const timer = setTimeout(() => {timedOut = true; abort();}, 10000);
  try {
    const response = await fetch(url, {...requestOptions, signal: controller.signal});
    const data = await response.json();
    return {response, data};
  } catch (error) {
    if (timedOut) throw new Error('profile-timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
