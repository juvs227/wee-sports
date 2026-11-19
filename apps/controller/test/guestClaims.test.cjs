const {test} = require('node:test');
const assert = require('node:assert/strict');
async function fixture() {
  const {createGuestClaimVault} = await import('../src/guestClaims.js');
  let saved = [];
  return {vault:createGuestClaimVault({read:async () => structuredClone(saved),write:async value => {saved=structuredClone(value);}}),read:() => saved};
}
test('native guest ownership proofs are submitted only to their original server', async () => {
  const {vault,read} = await fixture(); const seen=[];
  await vault.remember('https://first.example','a'.repeat(43));
  await vault.remember('https://second.example','b'.repeat(43));
  await vault.claimFor('https://first.example',async claim => seen.push(claim));
  assert.deepEqual(seen,['a'.repeat(43)]);
  assert.deepEqual(read(),[{origin:'https://second.example',claim:'b'.repeat(43)}]);
});
test('secure claim writes serialize, deduplicate and reject malformed tokens', async () => {
  const {vault,read} = await fixture();
  await Promise.all([vault.remember('https://game.example','a'.repeat(43)),vault.remember('https://game.example','b'.repeat(43)),vault.remember('https://game.example','a'.repeat(43)),vault.remember('https://game.example','invalid')]);
  assert.equal(read().length,2);
});
test('expired claims are discarded while temporary failures remain retryable', async () => {
  const {vault,read} = await fixture();
  await vault.remember('https://game.example','a'.repeat(43));
  await vault.remember('https://game.example','b'.repeat(43));
  await vault.claimFor('https://game.example',async claim => {const error=new Error('failed');error.status=claim[0]==='a'?403:503;throw error;});
  assert.deepEqual(read(),[{origin:'https://game.example',claim:'b'.repeat(43)}]);
});
test('an unavailable profile service stops the batch without losing pending ownership proofs', async () => {
  const {vault,read} = await fixture();
  const entries = [
    {origin:'https://game.example',claim:'a'.repeat(43)},
    {origin:'https://other.example',claim:'b'.repeat(43)},
    {origin:'https://game.example',claim:'c'.repeat(43)},
  ];
  for (const {origin,claim} of entries) await vault.remember(origin,claim);
  let requests = 0;
  await vault.claimFor('https://game.example', async () => {requests++; throw new Error('profile-timeout');});
  assert.equal(requests,1);
  assert.deepEqual(read(),entries);
  await vault.claimFor('https://game.example',async () => {});
  assert.deepEqual(read(),[entries[1]]);
});
