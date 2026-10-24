// 知识库、敏感词表、上次的选择保存在本机应用数据目录的 settings.json（kit 的 settingsStore）。
import { settingsStore } from '../kit/platform';
import { DEFAULT_WORDS, type Tone } from './core';
import { validKb, type Kb } from './kb';
import { sampleKb } from './samples';

const KB_KEY = 'kb.e25';
const WORDS_KEY = 'words.e25';
const PREFS_KEY = 'prefs.e25';

export interface Prefs {
  shop: string;
  tone: Tone;
  count: number;
}

async function get<T>(key: string): Promise<T | undefined> {
  try {
    return (await (await settingsStore()).get<T>(key)) ?? undefined;
  } catch {
    return undefined; // 预览环境没有本机存储
  }
}
async function set(key: string, value: unknown): Promise<boolean> {
  try {
    const st = await settingsStore();
    await st.set(key, value);
    await st.save();
    return true;
  } catch {
    return false;
  }
}

export async function loadKb(): Promise<{ kb: Kb; saved: boolean }> {
  const v = validKb(await get(KB_KEY));
  return v ? { kb: v, saved: true } : { kb: sampleKb(), saved: false };
}
export const saveKb = (kb: Kb) => set(KB_KEY, kb);

export async function loadWords(): Promise<string[]> {
  const v = await get<string[]>(WORDS_KEY);
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : DEFAULT_WORDS;
}
export const saveWords = (w: string[]) => set(WORDS_KEY, w);

export const loadPrefs = () => get<Partial<Prefs>>(PREFS_KEY);
export const savePrefs = (p: Prefs) => set(PREFS_KEY, p);
