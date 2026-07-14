import React, { useState, useEffect } from 'react';
import { Player, Prize, Structure } from '../types';
import { useSettings } from '../i18n/useSettings';
import { placeLabel } from '../utils/place';
import { currencySymbol } from '../utils/format';

interface TournamentCreatorProps {
    onClose: () => void;
    onSave: (config: { structureId: number; playerIds: number[]; maxPlayersPerTable: number; name: string; autoBalance: boolean; autoMerge: boolean; shuffleFinalTable: boolean; prizes: Prize[]; entryFee: number }) => Promise<void>;
}

const TournamentCreator: React.FC<TournamentCreatorProps> = ({ onClose, onSave }) => {
    const { t, formatCurrency, currency, language } = useSettings();
    const [structures, setStructures] = useState<Structure[]>([]);
    const [players, setPlayers] = useState<Player[]>([]);
    const [selectedStructureId, setSelectedStructureId] = useState<number | null>(null);
    const [selectedPlayerIds, setSelectedPlayerIds] = useState<number[]>([]);
    const [numTables, setNumTables] = useState<number>(1);
    const [maxPlayersPerTable, setMaxPlayersPerTable] = useState<number>(9);
    const [isLoading, setIsLoading] = useState(false);
    const [tournamentName, setTournamentName] = useState('');
    const [autoBalance, setAutoBalance] = useState(true);
    const [autoMerge, setAutoMerge] = useState(true);
    const [shuffleFinalTable, setShuffleFinalTable] = useState(true);
    const [prizes, setPrizes] = useState<Prize[]>([{ place: 1, amount: 0 }]);
    const [entryFee, setEntryFee] = useState<number>(0);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        const loadData = async () => {
            const [s, p] = await Promise.all([
                window.api.getStructures(),
                window.api.getPlayers()
            ]);
            setStructures(s);
            setPlayers(p);

            if (s.length > 0) setSelectedStructureId(s[0].id!);
            if (p.length > 0) setSelectedPlayerIds(p.map(x => x.id!));
        };
        loadData();
    }, []);

    const totalSeats = numTables * maxPlayersPerTable;
    const isCapacityError = selectedPlayerIds.length > totalSeats;

    const handleSave = async () => {
        if (!selectedStructureId || !tournamentName.trim() || isCapacityError) return;
        setIsLoading(true);
        try {
            // Assign each row its displayed place BEFORE dropping empty rows —
            // filtering first and renumbering would silently shift a lower
            // payout up a place (1st=500, 2nd=blank, 3rd=200 must not become
            // 2nd=200).
            const cleanedPrizes = prizes
                .map((p, i) => ({ place: i + 1, amount: p.amount || 0 }))
                .filter(p => p.amount > 0);
            await onSave({
                structureId: selectedStructureId,
                playerIds: selectedPlayerIds,
                maxPlayersPerTable,
                name: tournamentName,
                autoBalance,
                autoMerge,
                shuffleFinalTable,
                prizes: cleanedPrizes,
                entryFee
            });
            onClose();
        } catch (error) {
            console.error(error);
            setSaveError(t('creator.createFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const togglePlayer = (id: number) => {
        if (selectedPlayerIds.includes(id)) {
            setSelectedPlayerIds(selectedPlayerIds.filter(pid => pid !== id));
        } else {
            setSelectedPlayerIds([...selectedPlayerIds, id]);
        }
    };

    const addPrize = () => {
        setPrizes([...prizes, { place: prizes.length + 1, amount: 0 }]);
    };

    const removePrize = (index: number) => {
        setPrizes(prizes.filter((_, i) => i !== index));
    };

    const updatePrizeAmount = (index: number, amount: number) => {
        setPrizes(prizes.map((p, i) => i === index ? { ...p, amount } : p));
    };

    const symbol = currencySymbol(currency, language);

    const totalPrizePool = prizes.reduce((sum, p) => sum + (p.amount || 0), 0);

    const inputClass = "w-full bg-surface border border-line rounded px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors";

    return (
        <div className="fixed inset-0 bg-ink/30 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded border border-line w-full max-w-2xl h-[90vh] flex flex-col">
                <div className="px-6 py-5 border-b border-line">
                    <h2 className="text-base font-semibold text-ink">{t('creator.title')}</h2>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                    <div>
                        <label className="block text-micro uppercase text-ink-muted mb-1.5">
                            {t('creator.tournamentName')} <span className="text-danger normal-case">*</span>
                        </label>
                        <input
                            type="text"
                            className={inputClass}
                            placeholder={t('creator.tournamentNamePlaceholder')}
                            value={tournamentName}
                            onChange={(e) => setTournamentName(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('creator.structure')}</label>
                        <select
                            className={inputClass}
                            value={selectedStructureId || ''}
                            onChange={(e) => setSelectedStructureId(Number(e.target.value))}
                        >
                            {structures.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('creator.numTables')}</label>
                            <input
                                type="number"
                                min="1"
                                className={inputClass}
                                value={numTables}
                                onChange={(e) => setNumTables(Number(e.target.value))}
                            />
                        </div>
                        <div>
                            <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('creator.maxPlayersPerTable')}</label>
                            <input
                                type="number"
                                min="2"
                                max="10"
                                className={inputClass}
                                value={maxPlayersPerTable}
                                onChange={(e) => setMaxPlayersPerTable(Number(e.target.value))}
                            />
                        </div>
                    </div>

                    <div className="bg-surface-raised border border-line rounded p-4 text-sm">
                        <div className="flex justify-between mb-1">
                            <span className="text-ink-muted">{t('creator.totalCapacity')}</span>
                            <span className="text-ink font-medium tabular">{t('creator.seats', { n: totalSeats })}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-ink-muted">{t('creator.selectedPlayers')}</span>
                            <span className={`font-medium tabular ${isCapacityError ? 'text-danger' : 'text-ink'}`}>
                                {t('creator.players', { n: selectedPlayerIds.length })}
                            </span>
                        </div>
                        {isCapacityError && (
                            <div className="text-danger mt-2 text-xs">
                                {t('creator.notEnoughSeats')}
                            </div>
                        )}
                    </div>

                    <div className="bg-surface-raised border border-line rounded divide-y divide-line">
                        <div className="flex items-center justify-between p-4">
                            <div className="flex flex-col">
                                <span className="text-ink text-sm font-medium">{t('creator.autoBalance')}</span>
                                <span className="text-xs text-ink-muted mt-0.5">{t('creator.autoBalanceDesc')}</span>
                            </div>
                            <Toggle checked={autoBalance} onChange={setAutoBalance} />
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="flex flex-col">
                                <span className="text-ink text-sm font-medium">{t('creator.autoMerge')}</span>
                                <span className="text-xs text-ink-muted mt-0.5">{t('creator.autoMergeDesc')}</span>
                            </div>
                            <Toggle checked={autoMerge} onChange={setAutoMerge} />
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="flex flex-col">
                                <span className="text-ink text-sm font-medium">{t('creator.shuffleFinalTable')}</span>
                                <span className="text-xs text-ink-muted mt-0.5">{t('creator.shuffleFinalTableDesc')}</span>
                            </div>
                            <Toggle checked={shuffleFinalTable} onChange={setShuffleFinalTable} />
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-micro uppercase text-ink-muted">{t('creator.entryFee')}</label>
                            <div className="text-xs text-ink-muted tabular">
                                {t('creator.buyInsTotal')}: <span className="text-ink font-medium">{formatCurrency(selectedPlayerIds.length * entryFee)}</span>
                            </div>
                        </div>
                        <div className="relative">
                            <input
                                type="number"
                                min="0"
                                step="1"
                                className={`${inputClass} pr-8 tabular`}
                                placeholder="0"
                                value={entryFee === 0 ? '' : entryFee}
                                onChange={(e) => setEntryFee(Number(e.target.value) || 0)}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted pointer-events-none">{symbol}</span>
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-micro uppercase text-ink-muted">{t('creator.prizeDistribution')}</label>
                            <div className="text-xs text-ink-muted tabular">
                                {t('creator.total')}: <span className="text-ink font-medium">{formatCurrency(totalPrizePool)}</span>
                            </div>
                        </div>
                        <div className="bg-surface-raised border border-line rounded divide-y divide-line">
                            {prizes.map((prize, index) => (
                                <div key={index} className="flex items-center gap-3 p-3">
                                    <span className="text-sm text-ink-muted w-10 tabular">{placeLabel(index + 1, t)}</span>
                                    <div className="relative flex-1">
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            className={`${inputClass} pr-8 tabular`}
                                            placeholder="0"
                                            value={prize.amount === 0 ? '' : prize.amount}
                                            onChange={(e) => updatePrizeAmount(index, Number(e.target.value) || 0)}
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted pointer-events-none">{symbol}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removePrize(index)}
                                        disabled={prizes.length === 1}
                                        className={`text-xs font-medium transition-colors ${
                                            prizes.length === 1
                                                ? 'text-ink-faint cursor-not-allowed'
                                                : 'text-ink-muted hover:text-danger'
                                        }`}
                                    >
                                        {t('creator.remove')}
                                    </button>
                                </div>
                            ))}
                            <div className="p-3">
                                <button
                                    type="button"
                                    onClick={addPrize}
                                    className="text-xs font-medium text-ink-muted hover:text-ink transition-colors"
                                >
                                    {t('creator.addPrizePosition')}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-micro uppercase text-ink-muted">{t('creator.selectPlayers')}</label>
                            <div className="text-xs">
                                <button type="button" className="text-ink-muted hover:text-ink transition-colors" onClick={() => setSelectedPlayerIds(players.map(p => p.id!))}>{t('creator.selectAll')}</button>
                                <span className="mx-2 text-ink-faint">·</span>
                                <button type="button" className="text-ink-muted hover:text-ink transition-colors" onClick={() => setSelectedPlayerIds([])}>{t('creator.deselectAll')}</button>
                            </div>
                        </div>
                        <div className="bg-surface border border-line rounded p-3 max-h-60 overflow-y-auto grid grid-cols-2 gap-2">
                            {players.map(p => {
                                const selected = selectedPlayerIds.includes(p.id!);
                                return (
                                    <button
                                        type="button"
                                        key={p.id}
                                        className={`text-left p-2.5 rounded border transition-colors ${
                                            selected
                                                ? 'border-accent bg-accent-50'
                                                : 'border-line bg-surface hover:bg-surface-sunken'
                                        }`}
                                        onClick={() => togglePlayer(p.id!)}
                                    >
                                        <div className="text-sm text-ink font-medium">{p.name}</div>
                                        <div className="text-xs text-ink-muted">{p.nickname}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-line flex justify-end items-center gap-3">
                    {saveError && <span className="text-danger text-xs mr-auto">{saveError}</span>}
                    {!saveError && !selectedStructureId && <span className="text-danger text-xs mr-auto">{t('creator.pleaseSelectStructure')}</span>}
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded text-sm font-medium text-ink-muted hover:text-ink transition-colors"
                    >
                        {t('common.close')}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isLoading || !selectedStructureId || !tournamentName.trim() || isCapacityError}
                        className={`px-5 py-2 rounded text-sm font-medium transition-colors ${
                            isLoading || !selectedStructureId || !tournamentName.trim() || isCapacityError
                                ? 'bg-line text-ink-faint cursor-not-allowed'
                                : 'bg-accent text-white hover:bg-accent-600'
                        }`}
                    >
                        {isLoading ? t('creator.creating') : t('creator.create')}
                    </button>
                </div>
            </div>
        </div>
    );
};

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex items-center h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border border-line transition-colors ${
            checked ? 'bg-accent' : 'bg-surface'
        }`}
    >
        <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white border border-line shadow-sm transition-transform ${
                checked ? 'translate-x-4' : 'translate-x-0'
            }`}
        />
    </button>
);

export default TournamentCreator;
