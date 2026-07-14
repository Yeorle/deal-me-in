import React, { useEffect, useMemo, useState } from 'react';
import { AccentName, AppSettings, CurrencyCode, Language, ProjectorTheme } from '../types';
import { translate } from './translations';
import { applyAccent } from './accents';
import { SettingsContext, SettingsContextValue } from './context';

const DEFAULT_PROJECTOR_THEME: ProjectorTheme = {
    backgroundType: 'color',
    backgroundColor: '#f5f5f5', // matches bg-surface-sunken
    backgroundImage: null,
    textColor: '#1a1a1a',       // matches text-ink
    logoPath: null,
    textShadow: false,
    textShadowColor: '#000000',
    textShadowBlur: 8,
    textOutline: false,
    textOutlineColor: '#000000',
    textOutlineWidth: 2,
};

const DEFAULTS: AppSettings = {
    language: 'en',
    accentColor: 'moss',
    currency: 'EUR',
    projector: DEFAULT_PROJECTOR_THEME,
};

const ALLOWED_LANGUAGES: Language[] = ['en', 'fr'];
const ALLOWED_ACCENTS: AccentName[] = ['moss', 'slate', 'terracotta', 'plum', 'charcoal'];
const ALLOWED_CURRENCIES: CurrencyCode[] = ['EUR', 'USD', 'GBP', 'CHF'];
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function parseColor(value: unknown, fallback: string): string {
    return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;
}

function parseNumber(value: unknown, fallback: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : fallback;
}

function parseProjectorTheme(raw: string | undefined): ProjectorTheme {
    if (!raw) return DEFAULT_PROJECTOR_THEME;
    try {
        const obj = JSON.parse(raw) as Partial<ProjectorTheme>;
        return {
            backgroundType: obj.backgroundType === 'image' ? 'image' : 'color',
            backgroundColor: parseColor(obj.backgroundColor, DEFAULT_PROJECTOR_THEME.backgroundColor),
            backgroundImage: typeof obj.backgroundImage === 'string' ? obj.backgroundImage : null,
            textColor: parseColor(obj.textColor, DEFAULT_PROJECTOR_THEME.textColor),
            logoPath: typeof obj.logoPath === 'string' ? obj.logoPath : null,
            textShadow: typeof obj.textShadow === 'boolean' ? obj.textShadow : DEFAULT_PROJECTOR_THEME.textShadow,
            textShadowColor: parseColor(obj.textShadowColor, DEFAULT_PROJECTOR_THEME.textShadowColor),
            textShadowBlur: parseNumber(obj.textShadowBlur, DEFAULT_PROJECTOR_THEME.textShadowBlur, 100),
            textOutline: typeof obj.textOutline === 'boolean' ? obj.textOutline : DEFAULT_PROJECTOR_THEME.textOutline,
            textOutlineColor: parseColor(obj.textOutlineColor, DEFAULT_PROJECTOR_THEME.textOutlineColor),
            textOutlineWidth: parseNumber(obj.textOutlineWidth, DEFAULT_PROJECTOR_THEME.textOutlineWidth, 50),
        };
    } catch {
        return DEFAULT_PROJECTOR_THEME;
    }
}

function parseSettings(raw: Record<string, string>): AppSettings {
    const language = ALLOWED_LANGUAGES.includes(raw.language as Language) ? (raw.language as Language) : DEFAULTS.language;
    const accentColor = ALLOWED_ACCENTS.includes(raw.accentColor as AccentName) ? (raw.accentColor as AccentName) : DEFAULTS.accentColor;
    const currency = ALLOWED_CURRENCIES.includes(raw.currency as CurrencyCode) ? (raw.currency as CurrencyCode) : DEFAULTS.currency;
    const projector = parseProjectorTheme(raw.projectorTheme);
    return { language, accentColor, currency, projector };
}

const localeMap: Record<Language, string> = { en: 'en-US', fr: 'fr-FR' };

function buildFormatCurrency(language: Language, currency: CurrencyCode) {
    const formatter = new Intl.NumberFormat(localeMap[language], {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
    });
    return (amount: number) => formatter.format(amount);
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<AppSettings>(DEFAULTS);

    useEffect(() => {
        let cancelled = false;
        window.api.getSettings().then(raw => {
            if (cancelled) return;
            const next = parseSettings(raw);
            setSettings(next);
            applyAccent(next.accentColor);
        });

        const unsub = window.api.onSettingsUpdate(raw => {
            const next = parseSettings(raw);
            setSettings(next);
            applyAccent(next.accentColor);
        });

        return () => {
            cancelled = true;
            unsub();
        };
    }, []);

    const value = useMemo<SettingsContextValue>(() => {
        const formatter = buildFormatCurrency(settings.language, settings.currency);
        return {
            ...settings,
            t: (key, vars) => translate(settings.language, key, vars),
            formatCurrency: formatter,
            setLanguage: async (language) => {
                await window.api.setSetting('language', language);
            },
            setAccentColor: async (accent) => {
                await window.api.setSetting('accentColor', accent);
            },
            setCurrency: async (currency) => {
                await window.api.setSetting('currency', currency);
            },
            setProjectorTheme: async (theme) => {
                await window.api.setSetting('projectorTheme', JSON.stringify(theme));
            },
        };
    }, [settings]);

    return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};
