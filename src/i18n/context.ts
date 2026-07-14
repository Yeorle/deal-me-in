import { createContext } from 'react';
import { AccentName, AppSettings, CurrencyCode, Language, ProjectorTheme } from '../types';
import { TranslationKey } from './translations';

export interface SettingsContextValue extends AppSettings {
    t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
    formatCurrency: (amount: number) => string;
    setLanguage: (language: Language) => Promise<void>;
    setAccentColor: (accent: AccentName) => Promise<void>;
    setCurrency: (currency: CurrencyCode) => Promise<void>;
    setProjectorTheme: (theme: ProjectorTheme) => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);
