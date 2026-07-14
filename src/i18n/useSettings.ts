import { useContext } from 'react';
import { SettingsContext, SettingsContextValue } from './context';

export function useSettings(): SettingsContextValue {
    const ctx = useContext(SettingsContext);
    if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
    return ctx;
}
