import { MockStorage } from './mockStorage';
import type { Storage } from './storage';
import { TauriStorage } from './tauriStorage';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let instance: Storage | null = null;

export function getStorage(): Storage {
  if (!instance) {
    instance = isTauri() ? new TauriStorage() : new MockStorage();
    if (instance instanceof MockStorage && import.meta.env.DEV) {
      (window as unknown as { __tappivraMock: MockStorage }).__tappivraMock = instance;
    }
  }
  return instance;
}
