import React from 'react';
import { useSettings } from '../i18n/useSettings';
import { accentPalettes } from '../i18n/accents';
import { AccentName, CurrencyCode, Language } from '../types';

const Settings: React.FC = () => {
    const { t, language, accentColor, currency, setLanguage, setAccentColor, setCurrency } = useSettings();

    const languageOptions: { value: Language; label: string }[] = [
        { value: 'en', label: t('settings.languageEnglish') },
        { value: 'fr', label: t('settings.languageFrench') },
    ];

    const accentOptions: { value: AccentName; label: string }[] = [
        { value: 'moss', label: t('settings.accentMoss') },
        { value: 'slate', label: t('settings.accentSlate') },
        { value: 'terracotta', label: t('settings.accentTerracotta') },
        { value: 'plum', label: t('settings.accentPlum') },
        { value: 'charcoal', label: t('settings.accentCharcoal') },
    ];

    const currencyOptions: { value: CurrencyCode; label: string }[] = [
        { value: 'EUR', label: t('settings.currencyEUR') },
        { value: 'USD', label: t('settings.currencyUSD') },
        { value: 'GBP', label: t('settings.currencyGBP') },
        { value: 'CHF', label: t('settings.currencyCHF') },
    ];

    return (
        <div className="px-10 py-10 w-full max-w-3xl mx-auto">
            <h2 className="text-xl font-semibold tracking-tight mb-8">{t('settings.title')}</h2>

            <section className="bg-surface border border-line rounded p-5 mb-5">
                <h3 className="text-sm font-medium text-ink mb-1">{t('settings.language')}</h3>
                <p className="text-xs text-ink-muted mb-4">{t('settings.languageDesc')}</p>
                <div className="flex flex-wrap gap-2">
                    {languageOptions.map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => setLanguage(opt.value)}
                            className={`px-4 py-2 rounded text-sm font-medium border transition-colors ${
                                language === opt.value
                                    ? 'bg-accent text-white border-accent'
                                    : 'bg-surface text-ink border-line hover:bg-surface-sunken'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </section>

            <section className="bg-surface border border-line rounded p-5 mb-5">
                <h3 className="text-sm font-medium text-ink mb-1">{t('settings.accentColor')}</h3>
                <p className="text-xs text-ink-muted mb-4">{t('settings.accentColorDesc')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {accentOptions.map(opt => {
                        const palette = accentPalettes[opt.value];
                        const selected = accentColor === opt.value;
                        return (
                            <button
                                key={opt.value}
                                onClick={() => setAccentColor(opt.value)}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded border transition-colors text-left ${
                                    selected
                                        ? 'border-accent bg-accent-50'
                                        : 'border-line bg-surface hover:bg-surface-sunken'
                                }`}
                            >
                                <span
                                    className="inline-block h-6 w-6 rounded-full border border-line"
                                    style={{ backgroundColor: palette[500] }}
                                />
                                <span className="text-sm text-ink font-medium">{opt.label}</span>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className="bg-surface border border-line rounded p-5">
                <h3 className="text-sm font-medium text-ink mb-1">{t('settings.currency')}</h3>
                <p className="text-xs text-ink-muted mb-4">{t('settings.currencyDesc')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {currencyOptions.map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => setCurrency(opt.value)}
                            className={`px-4 py-2.5 rounded text-sm font-medium border transition-colors text-left ${
                                currency === opt.value
                                    ? 'border-accent bg-accent-50 text-ink'
                                    : 'border-line bg-surface text-ink hover:bg-surface-sunken'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
};

export default Settings;
