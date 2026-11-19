/** Keep an older room save from completing after a newer Forget/Leave. */
export function createPrivateWriteQueue(write) {
  const pending = new Map();
  return function enqueue(key, value) {
    const next = (pending.get(key) || Promise.resolve()).catch(() => {}).then(() => write(key, value));
    pending.set(key, next);
    const clear = () => {if (pending.get(key) === next) pending.delete(key);};
    next.then(clear, clear);
    return next;
  };
}
