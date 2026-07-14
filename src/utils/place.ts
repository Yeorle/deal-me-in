import type { TranslationKey } from '../i18n/translations';

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

// Localized ordinal for a finishing place (1 → "1st"/"1er", etc.).
export const placeLabel = (place: number, t: TFn): string => {
    if (place === 1) return t('place.first');
    if (place === 2) return t('place.second');
    if (place === 3) return t('place.third');
    return t('place.nth', { n: place });
};
