'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'casestudyhub-theme';

/**
 * The applied theme lives on the document element, written before first paint
 * by ThemeScript. Reading it through useSyncExternalStore keeps this component
 * in step with that external value without a state-setting effect.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** The server cannot know the viewer's choice; ThemeScript corrects it instantly. */
function getServerSnapshot(): Theme {
  return 'light';
}

export function ThemeToggle() {
  const t = useTranslations('common');
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A viewer blocking site data simply loses the preference.
    }
  }, [theme]);

  const label = theme === 'dark' ? t('themeDark') : t('themeLight');

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`${t('theme')}: ${label}`}
      className="surface-card hover:border-brand-400 inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors"
    >
      <span aria-hidden="true">{theme === 'dark' ? '🌙' : '☀️'}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
