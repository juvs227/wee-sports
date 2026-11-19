import * as SecureStore from 'expo-secure-store';
import {fetchJson} from '../../../src/network/fetchJson.js';
import {createPrivateWriteQueue} from './privateWriteQueue.js';

export async function readPrivate(key) {
  const raw = await SecureStore.getItemAsync(`wee.${key}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export const writePrivate = createPrivateWriteQueue(async (key, value) => {
  if (value === null) await SecureStore.deleteItemAsync(`wee.${key}`);
  else await SecureStore.setItemAsync(`wee.${key}`, JSON.stringify(value), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
});

export async function profileRequest(origin, path = '', { method = 'GET', body, token, signal } = {}) {
  const {response, data: result} = await fetchJson(`${origin}/api/profile${path}`, {
    method, signal, headers: { 'Content-Type': 'application/json', 'X-Wee-Client': 'native', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).catch(error => {
    if (error.message === 'profile-timeout') throw new Error('The profile request took too long. Check your connection and reopen your profile before trying again.');
    throw error;
  });
  if (!response.ok) { const error = new Error(result.message || result.error || 'Profile request failed'); error.status = response.status; throw error; }
  return result;
}
