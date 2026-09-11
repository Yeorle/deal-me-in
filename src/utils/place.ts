import type { TranslationKey } from '../i18n/translations';

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

// Localized ordinal for a finishing place (1 → "1st"/"1er", etc.). The
// suffix keys differ per language: English st/nd/rd/th (with the 11–13
// exception), French always "e".
export const placeLabel = (place: number, t: TFn): string => {
    if (place === 1) return t('place.first');
    if (place === 2) return t('place.second');
    if (place === 3) return t('place.third');
    const mod100 = ((place % 100) + 100) % 100;
    const suffixKey =
        (mod100 >= 11 && mod100 <= 13) ? 'place.ordTh'
            : place % 10 === 1 ? 'place.ordSt'
                : place % 10 === 2 ? 'place.ordNd'
                    : place % 10 === 3 ? 'place.ordRd'
                        : 'place.ordTh';
    return t('place.nth', { n: place }) + t(suffixKey);
};
