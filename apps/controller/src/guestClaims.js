/** Serialize secure-storage updates; ownership proofs never leave their server. */
export function createGuestClaimVault({read, write}) {
  let pending = Promise.resolve();
  const run = work => { pending = pending.then(work, work); return pending; };
  const valid = value => typeof value?.origin === 'string' && typeof value.claim === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.claim);
  const load = async () => { const values = await read(); return Array.isArray(values) ? values.filter(valid).slice(-20) : []; };
  return {
    remember(origin, claim) {
      if (!valid({origin, claim})) return Promise.resolve();
      return run(async () => {
        const values = await load();
        if (!values.some(value => value.origin === origin && value.claim === claim)) values.push({origin, claim});
        await write(values.slice(-20));
      });
    },
    claimFor(origin, submit) {
      return run(async () => {
        const retained = [];
        const entries = await load();
        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index];
          if (entry.origin !== origin) {retained.push(entry); continue;}
          try {await submit(entry.claim);}
          catch (error) {
            if (error.status === 403) continue;
            retained.push(...entries.slice(index)); break;
          }
        }
        await write(retained);
      });
    },
  };
}
