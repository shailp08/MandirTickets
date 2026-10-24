import { createContext, useCallback, useContext, useState } from 'react';
import { LANG_KEY } from '../config';
import { Lang, strings } from './strings';

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: 'en',
  setLang: () => {},
  t: (key) => key,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(LANG_KEY);
    return stored === 'gu' ? 'gu' : 'en';
  });

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(LANG_KEY, l);
    setLangState(l);
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const tbl = strings[lang];
    let s = (tbl && tbl[key]) ?? (strings.en[key] ?? key);
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return s;
  }, [lang]);

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue { return useContext(LangContext); }
export function useT(): LangContextValue['t'] { return useContext(LangContext).t; }
