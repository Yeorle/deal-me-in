export const formatEuropeanDateTime = (input: string | number | Date): string => {
    const d = new Date(input);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
};

export const formatEuropeanDate = (input: string | number | Date): string => {
    const d = new Date(input);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
};

export const formatEuropeanTime = (input: string | number | Date): string => {
    const d = new Date(input);
    if (isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${min}`;
};

// Format an amount with an explicit currency code (e.g. a tournament's stored
// currency snapshot, which may differ from the current app setting).
export const formatCurrencyWith = (amount: number, currency: string, language: 'en' | 'fr' = 'en'): string => {
    const locale = language === 'fr' ? 'fr-FR' : 'en-US';
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            currencyDisplay: 'narrowSymbol',
            maximumFractionDigits: 0,
            minimumFractionDigits: 0,
        }).format(amount);
    } catch {
        return `${Math.round(amount)} ${currency}`;
    }
};

// Narrow symbol for a currency code (e.g. 'EUR' → '€') without formatting a number.
export const currencySymbol = (currency: string, language: 'en' | 'fr' = 'en'): string => {
    const locale = language === 'fr' ? 'fr-FR' : 'en-US';
    try {
        const parts = new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            currencyDisplay: 'narrowSymbol',
        }).formatToParts(0);
        return parts.find(p => p.type === 'currency')?.value ?? currency;
    } catch {
        return currency;
    }
};

// mm:ss clock, e.g. "07:30" (level countdowns).
export const formatClock = (totalSeconds: number): string => {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

// h:mm:ss once over an hour, else mm:ss (elapsed time, break countdowns).
export const formatHMS = (totalSeconds: number): string => {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

// Human-readable duration from a number of seconds, e.g. "2h 05m", "47m", "0m".
export const formatDuration = (totalSeconds: number): string => {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    return `${minutes}m`;
};
