import React, { useEffect, useState } from 'react';
import { Prize, StandingRow } from '../types';
import { useSettings } from '../i18n/useSettings';
import { formatDuration } from '../utils/format';
import { placeLabel } from '../utils/place';
import { mediaUrl } from '../utils/media';
import { defaultAvatar } from '../utils/avatar';

interface FinalizeStandingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    // Called after the tournament has been archived (with or without results).
    onFinalized: () => void;
}

const FinalizeStandingsModal: React.FC<FinalizeStandingsModalProps> = ({ isOpen, onClose, onFinalized }) => {
    const { t, formatCurrency } = useSettings();
    const [survivors, setSurvivors] = useState<StandingRow[]>([]);
    const [eliminated, setEliminated] = useState<StandingRow[]>([]);
    const [prizes, setPrizes] = useState<Prize[]>([]);
    const [entryFee, setEntryFee] = useState(0);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const load = async () => {
            const [rows, state] = await Promise.all([
                window.api.getStandings(),
                window.api.getTournamentState(),
            ]);
            if (cancelled) return;
            setSurvivors(rows.filter(r => r.isSurvivor).sort((a, b) => a.place - b.place));
            setEliminated(rows.filter(r => !r.isSurvivor).sort((a, b) => a.place - b.place));
            setPrizes(state.prizes || []);
            setEntryFee(state.entryFee || 0);
        };
        load();
        return () => { cancelled = true; };
    }, [isOpen]);

    if (!isOpen) return null;

    const prizeForPlace = (place: number) => prizes.find(p => p.place === place)?.amount ?? 0;

    const move = (index: number, dir: -1 | 1) => {
        const target = index + dir;
        if (target < 0 || target >= survivors.length) return;
        const next = [...survivors];
        [next[index], next[target]] = [next[target], next[index]];
        setSurvivors(next);
    };

    const handleConfirm = async () => {
        setIsSaving(true);
        try {
            await window.api.finalizeTournament(survivors.map(s => s.playerId));
            onFinalized();
        } catch (e) {
            console.error('Failed to finalize tournament', e);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSkip = async () => {
        setIsSaving(true);
        try {
            // Await the archive so onFinalized's re-query of running
            // tournaments can't race it.
            await window.api.stopTournament();
            onFinalized();
        } catch (e) {
            console.error('Failed to stop tournament', e);
        } finally {
            setIsSaving(false);
        }
    };

    const earningsClass = (earnings: number) =>
        earnings > 0 ? 'text-accent' : earnings < 0 ? 'text-danger' : 'text-ink-muted';

    const renderRow = (
        row: StandingRow,
        place: number,
        opts: { reorderIndex?: number } = {}
    ) => {
        const prize = prizeForPlace(place);
        const earnings = prize - entryFee;
        return (
            <tr key={row.playerId} className="border-t border-line">
                <td className="px-4 py-2.5 tabular text-ink-muted w-16">{placeLabel(place, t)}</td>
                <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                        <img
                            src={row.photoPath ? mediaUrl(row.photoPath) : defaultAvatar}
                            onError={(e) => { (e.target as HTMLImageElement).src = defaultAvatar; }}
                            alt={row.name}
                            className="w-7 h-7 rounded-full object-cover border border-line"
                        />
                        <span className="text-ink font-medium">{row.name}</span>
                    </div>
                </td>
                <td className="px-4 py-2.5 tabular text-ink-soft">{formatDuration(row.playtimeSec)}</td>
                <td className="px-4 py-2.5 tabular text-ink-soft text-right">{formatCurrency(prize)}</td>
                <td className={`px-4 py-2.5 tabular text-right font-medium ${earningsClass(earnings)}`}>{formatCurrency(earnings)}</td>
                <td className="px-3 py-2.5 w-20 text-right">
                    {opts.reorderIndex !== undefined && (
                        <div className="inline-flex gap-1">
                            <button
                                type="button"
                                onClick={() => move(opts.reorderIndex!, -1)}
                                disabled={opts.reorderIndex === 0}
                                title={t('finalize.moveUp')}
                                className="px-1.5 py-0.5 rounded border border-line text-ink-muted hover:text-ink hover:bg-surface-sunken disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >↑</button>
                            <button
                                type="button"
                                onClick={() => move(opts.reorderIndex!, 1)}
                                disabled={opts.reorderIndex === survivors.length - 1}
                                title={t('finalize.moveDown')}
                                className="px-1.5 py-0.5 rounded border border-line text-ink-muted hover:text-ink hover:bg-surface-sunken disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >↓</button>
                        </div>
                    )}
                </td>
            </tr>
        );
    };

    return (
        <div className="fixed inset-0 bg-ink/30 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded border border-line w-full max-w-3xl h-[90vh] flex flex-col">
                <div className="px-6 py-5 border-b border-line">
                    <h2 className="text-base font-semibold text-ink">{t('finalize.title')}</h2>
                    <p className="text-sm text-ink-muted mt-1">{t('finalize.subtitle')}</p>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                    {survivors.length > 0 && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-micro uppercase text-ink-muted">{t('finalize.stillIn')}</h3>
                            </div>
                            <p className="text-xs text-ink-muted mb-3">{t('finalize.reorderHint')}</p>
                            <div className="bg-surface-raised border border-line rounded overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="text-micro uppercase text-ink-muted">
                                        <tr>
                                            <th className="px-4 py-2 text-left font-medium">{t('finalize.colPlace')}</th>
                                            <th className="px-4 py-2 text-left font-medium">{t('finalize.colPlayer')}</th>
                                            <th className="px-4 py-2 text-left font-medium">{t('finalize.colPlaytime')}</th>
                                            <th className="px-4 py-2 text-right font-medium">{t('finalize.colPrize')}</th>
                                            <th className="px-4 py-2 text-right font-medium">{t('finalize.colEarnings')}</th>
                                            <th className="px-3 py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {survivors.map((row, i) => renderRow(row, i + 1, { reorderIndex: i }))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {eliminated.length > 0 && (
                        <div>
                            <h3 className="text-micro uppercase text-ink-muted mb-2">{t('finalize.eliminated')}</h3>
                            <div className="bg-surface-raised border border-line rounded overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="text-micro uppercase text-ink-muted">
                                        <tr>
                                            <th className="px-4 py-2 text-left font-medium">{t('finalize.colPlace')}</th>
                                            <th className="px-4 py-2 text-left font-medium">{t('finalize.colPlayer')}</th>
                                            <th className="px-4 py-2 text-left font-medium">{t('finalize.colPlaytime')}</th>
                                            <th className="px-4 py-2 text-right font-medium">{t('finalize.colPrize')}</th>
                                            <th className="px-4 py-2 text-right font-medium">{t('finalize.colEarnings')}</th>
                                            <th className="px-3 py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {eliminated.map(row => renderRow(row, row.place))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-line flex justify-end items-center gap-3">
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="px-4 py-2 rounded text-sm font-medium text-ink-muted hover:text-ink transition-colors mr-auto"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleSkip}
                        disabled={isSaving}
                        className="px-4 py-2 rounded text-sm font-medium bg-surface border border-line text-danger hover:bg-danger-soft transition-colors"
                    >
                        {t('finalize.skip')}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isSaving}
                        className="px-5 py-2 rounded text-sm font-medium bg-accent text-white hover:bg-accent-600 transition-colors disabled:opacity-50"
                    >
                        {isSaving ? t('finalize.saving') : t('finalize.confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FinalizeStandingsModal;
