import React, { useEffect, useState } from 'react';
import { Level, Player, Prize, Table, TournamentState } from '../types';
import TournamentCreator from './TournamentCreator';
import ManagePlayersPanel from './ManagePlayersPanel';
import SeatMovePopup from './SeatMovePopup';
import FinalizeStandingsModal from './FinalizeStandingsModal';
import { formatEuropeanDateTime, formatDuration, formatClock } from '../utils/format';
import { placeLabel } from '../utils/place';
import { useSettings } from '../i18n/useSettings';

interface TimerState {
    id?: number;
    remainingTime: number;
    levelDuration: number;
    level: number;
    smallBlind: number;
    bigBlind: number;
    ante: number;
    isRunning: boolean;
    isActive: boolean;
    name?: string;
    tables?: Table[];
    unassignedPlayers?: Player[];
    bustedPlayers?: Player[];
    levels?: Level[];
    currentLevelIndex: number;
    elapsedTime: number;
    prizes?: Prize[];
}

type ActiveMenu = 'players' | 'structure' | 'prizes';

const ControlPanel: React.FC = () => {
    const { t } = useSettings();
    const [timerState, setTimerState] = useState<TimerState>({
        remainingTime: 0,
        levelDuration: 0,
        level: 1,
        smallBlind: 0,
        bigBlind: 0,
        ante: 0,
        isRunning: false,
        isActive: false,
        name: '',
        currentLevelIndex: 0,
        elapsedTime: 0
    });
    const [isCreatorOpen, setIsCreatorOpen] = useState(false);
    const [runningTournaments, setRunningTournaments] = useState<{ id: number; name: string; start_date: string }[]>([]);

    const [isFinalizeOpen, setIsFinalizeOpen] = useState(false);
    const [activeMenu, setActiveMenu] = useState<ActiveMenu>('players');
    // While the user drags the time slider we show the local value and suppress
    // the live broadcast so the thumb doesn't fight the incoming timer-update.
    const [dragTime, setDragTime] = useState<number | null>(null);

    useEffect(() => {
        const handleStateUpdate = (state: TournamentState) => {
            setTimerState({
                id: state.id,
                remainingTime: state.timeLeftInLevel,
                levelDuration: state.currentLevel?.duration || 0,
                level: state.currentLevelIndex + 1,
                smallBlind: state.currentLevel?.smallBlind || 0,
                bigBlind: state.currentLevel?.bigBlind || 0,
                ante: state.currentLevel?.ante || 0,
                isRunning: !state.isPaused,
                isActive: state.isActive,
                name: state.name,
                tables: state.tables,
                unassignedPlayers: state.unassignedPlayers,
                bustedPlayers: state.bustedPlayers,
                levels: state.levels,
                currentLevelIndex: state.currentLevelIndex,
                elapsedTime: state.elapsedTime,
                prizes: state.prizes
            });
        };

        window.api.getTournamentState().then(handleStateUpdate);
        loadRunningTournaments();

        const removeListener = window.ipcRenderer.on('timer-update', handleStateUpdate);

        return () => {
            removeListener();
        };
    }, []);

    // The running-tournament list only changes on create/switch/finalize, so
    // refresh it when the active tournament id changes — not on every one of
    // the ~1/sec timer-update broadcasts (each refresh is an IPC round-trip +
    // SQLite query).
    useEffect(() => {
        loadRunningTournaments();
    }, [timerState.id, timerState.isActive]);

    const handlePlayPause = () => {
        if (timerState.isRunning) window.ipcRenderer.send('pause-timer');
        else window.ipcRenderer.send('start-timer');
    };

    const handleOpenProjector = () => window.api.openProjector();

    const sliderValue = dragTime ?? timerState.remainingTime;

    const commitDrag = () => {
        if (dragTime !== null) {
            window.api.setTimeLeft(dragTime);
            setDragTime(null);
        }
    };

    const handleCreateTournament = async (config: Parameters<typeof window.api.createTournament>[0]) => {
        await window.api.createTournament(config);
    };

    const loadRunningTournaments = async () => {
        const running = await window.api.getRunningTournaments();
        setRunningTournaments(running);
    }

    const handleSwitchTournament = async (id: number) => {
        await window.api.switchTournament(id);
    }

    const hasUnassigned = !!timerState.unassignedPlayers && timerState.unassignedPlayers.length > 0;
    // Unassigned players block *starting* the clock, but you must still be able to
    // pause a clock that is already running (e.g. after un-busting mid-level).
    const playDisabled = hasUnassigned && !timerState.isRunning;

    const menus: { key: ActiveMenu; label: string }[] = [
        { key: 'players', label: t('controlPanel.menuPlayers') },
        { key: 'structure', label: t('controlPanel.menuStructure') },
        { key: 'prizes', label: t('controlPanel.menuPrizes') },
    ];

    return (
        <div className="px-10 py-10 w-full">
            <div className="flex justify-between items-center mb-10">
                <h2 className="text-xl font-semibold tracking-tight">{t('controlPanel.title')}</h2>
                <button
                    onClick={() => setIsCreatorOpen(true)}
                    className="bg-accent text-white px-4 py-2 rounded text-sm font-medium hover:bg-accent-600 transition-colors"
                >
                    {t('controlPanel.newTournament')}
                </button>
            </div>

            <section>
                {timerState.isActive ? (
                    <div className="bg-surface border border-line rounded p-6">
                        {/* Header: name + window actions */}
                        <div className="flex items-start justify-between gap-4 mb-6">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-lg font-semibold text-ink truncate tracking-tight">
                                        {timerState.name || t('controlPanel.title')}
                                    </h3>
                                    {timerState.isRunning && (
                                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                                    )}
                                </div>
                                <div className="text-sm text-ink-soft tabular mt-1">
                                    {timerState.smallBlind} <span className="text-ink-faint">/</span> {timerState.bigBlind}
                                    {timerState.ante > 0 && (
                                        <span className="text-xs text-ink-muted ml-3">{t('controlPanel.ant')}: {timerState.ante}</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <button
                                    onClick={handleOpenProjector}
                                    className="bg-surface border border-line text-ink px-4 py-2 rounded text-sm font-medium hover:bg-surface-sunken transition-colors"
                                >
                                    {t('controlPanel.projector')}
                                </button>
                                <button
                                    onClick={() => setIsFinalizeOpen(true)}
                                    className="bg-surface border border-line text-danger px-4 py-2 rounded text-sm font-medium hover:bg-danger-soft transition-colors"
                                >
                                    {t('controlPanel.terminate')}
                                </button>
                            </div>
                        </div>

                        {/* Controls */}
                        <section className="border-t border-line pt-5 mb-6">
                            <h4 className="text-micro font-medium uppercase text-ink-muted mb-4">{t('controlPanel.controls')}</h4>
                            <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                                <div className="flex items-stretch gap-2 shrink-0">
                                    <button
                                        onClick={() => window.api.previousLevel()}
                                        title={t('controlPanel.prevLevel')}
                                        aria-label={t('controlPanel.prevLevel')}
                                        className="px-4 py-3 rounded text-sm font-medium bg-surface border border-line text-ink hover:bg-surface-sunken transition-colors"
                                    >
                                        ⏮
                                    </button>
                                    <button
                                        onClick={handlePlayPause}
                                        disabled={playDisabled}
                                        title={playDisabled ? t('controlPanel.assignSeatsFirst') : ""}
                                        className={`w-32 py-3 rounded text-sm font-medium transition-colors ${
                                            playDisabled
                                                ? 'bg-line text-ink-faint cursor-not-allowed'
                                                : timerState.isRunning
                                                    ? 'bg-surface border border-line text-ink hover:bg-surface-sunken'
                                                    : 'bg-accent text-white hover:bg-accent-600'
                                        }`}
                                    >
                                        {timerState.isRunning ? t('controlPanel.pause') : t('controlPanel.play')}
                                    </button>
                                    <button
                                        onClick={() => window.api.nextLevel()}
                                        title={t('controlPanel.nextLevel')}
                                        aria-label={t('controlPanel.nextLevel')}
                                        className="px-4 py-3 rounded text-sm font-medium bg-surface border border-line text-ink hover:bg-surface-sunken transition-colors"
                                    >
                                        ⏭
                                    </button>
                                </div>

                                <div className="flex-1 min-w-0">
                                    <input
                                        type="range"
                                        min={0}
                                        max={timerState.levelDuration || 0}
                                        // Slider tracks elapsed progress (left→right = forward in
                                        // the level), so dragging right reduces the remaining time.
                                        value={(timerState.levelDuration || 0) - sliderValue}
                                        title={t('controlPanel.adjustTime')}
                                        aria-label={t('controlPanel.adjustTime')}
                                        // The IPC send (full save + broadcast in the main
                                        // process) happens once on release, not on every
                                        // pointer-move tick.
                                        onChange={(e) => {
                                            const remaining = (timerState.levelDuration || 0) - Number(e.target.value);
                                            setDragTime(remaining);
                                        }}
                                        onPointerUp={commitDrag}
                                        onKeyUp={commitDrag}
                                        onBlur={commitDrag}
                                        className="w-full accent-accent"
                                    />
                                </div>

                                <div className="flex gap-8 shrink-0">
                                    <Stat label={t('controlPanel.elapsed')} value={formatDuration(timerState.elapsedTime)} widthCh={6} />
                                    <Stat label={t('controlPanel.level')} value={`#${timerState.level}`} widthCh={3} />
                                    <Stat
                                        label={t('controlPanel.timeLeft')}
                                        value={`${formatClock(sliderValue)}/${formatClock(timerState.levelDuration)}`}
                                        widthCh={11}
                                    />
                                </div>
                            </div>

                            {hasUnassigned && (
                                <div className="text-xs text-danger mt-3">
                                    {t('controlPanel.unassignedPlayers', { n: timerState.unassignedPlayers!.length })}
                                </div>
                            )}
                        </section>

                        {/* Menus */}
                        <section className="border-t border-line pt-5">
                            <div className="flex gap-2 mb-5">
                                {menus.map(m => (
                                    <button
                                        key={m.key}
                                        onClick={() => setActiveMenu(m.key)}
                                        className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                                            activeMenu === m.key
                                                ? 'bg-accent text-white'
                                                : 'bg-surface border border-line text-ink hover:bg-surface-sunken'
                                        }`}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>

                            {activeMenu === 'players' && (
                                <ManagePlayersPanel
                                    tables={timerState.tables || []}
                                    unassignedPlayers={timerState.unassignedPlayers || []}
                                    bustedPlayers={timerState.bustedPlayers || []}
                                />
                            )}
                            {activeMenu === 'structure' && (
                                <StructureView levels={timerState.levels || []} currentLevelIndex={timerState.currentLevelIndex} />
                            )}
                            {activeMenu === 'prizes' && (
                                <PrizesView prizes={timerState.prizes || []} />
                            )}
                        </section>
                    </div>
                ) : (
                    <div className="border border-line rounded bg-surface text-center py-16 text-ink-muted">
                        <p className="text-sm">{t('controlPanel.noTournamentRunning')}</p>
                        <p className="text-xs mt-1 text-ink-faint">{t('controlPanel.noTournamentSubtitle')}</p>
                    </div>
                )}

                {runningTournaments.filter(rt => rt.id !== timerState.id).length > 0 && (
                    <div className="mt-4 bg-surface border border-line rounded overflow-hidden">
                        <div className="px-5 py-3 border-b border-line text-micro uppercase text-ink-muted">
                            {t('controlPanel.otherRunning')}
                        </div>
                        <ul className="divide-y divide-line">
                            {runningTournaments
                                .filter(rt => rt.id !== timerState.id)
                                .map(rt => (
                                    <li key={rt.id} className="flex items-center justify-between px-5 py-3 hover:bg-surface-sunken transition-colors">
                                        <div className="min-w-0">
                                            <div className="text-sm text-ink font-medium truncate">{rt.name}</div>
                                            <div className="text-xs text-ink-muted tabular">
                                                {t('controlPanel.startedAt', { date: formatEuropeanDateTime(rt.start_date) })}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleSwitchTournament(rt.id)}
                                            className="bg-surface border border-line text-ink px-3 py-1.5 rounded text-xs font-medium hover:bg-surface-raised transition-colors"
                                        >
                                            {t('controlPanel.switchTo')}
                                        </button>
                                    </li>
                                ))}
                        </ul>
                    </div>
                )}
            </section>

            {isCreatorOpen && (
                <TournamentCreator
                    onClose={() => setIsCreatorOpen(false)}
                    onSave={handleCreateTournament}
                />
            )}

            <FinalizeStandingsModal
                isOpen={isFinalizeOpen}
                onClose={() => setIsFinalizeOpen(false)}
                onFinalized={() => {
                    setIsFinalizeOpen(false);
                    loadRunningTournaments();
                }}
            />
            <SeatMovePopup />
        </div>
    );
};

const Stat: React.FC<{ label: string; value: string; widthCh?: number }> = ({ label, value, widthCh }) => (
    <div>
        <div className="text-micro uppercase text-ink-muted mb-1">{label}</div>
        {/* Reserve a fixed width (in ch) so per-second digit changes don't ripple the layout. */}
        <div className="text-lg font-medium text-ink tabular leading-none" style={widthCh ? { minWidth: `${widthCh}ch` } : undefined}>
            {value}
        </div>
    </div>
);

const StructureView: React.FC<{ levels: Level[]; currentLevelIndex: number }> = ({ levels, currentLevelIndex }) => {
    const { t } = useSettings();
    return (
        <div className="border border-line rounded overflow-hidden">
            <table className="w-full text-left text-sm">
                <thead className="bg-surface-raised border-b border-line">
                    <tr className="text-micro uppercase text-ink-muted">
                        <th className="px-3 py-2.5 font-medium w-12 text-center">{t('editor.colNumber')}</th>
                        <th className="px-3 py-2.5 font-medium">{t('editor.colBlinds')}</th>
                        <th className="px-3 py-2.5 font-medium w-24">{t('editor.colAnte')}</th>
                        <th className="px-3 py-2.5 font-medium w-28">{t('editor.colDuration')}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-line">
                    {levels.map((lvl, idx) => {
                        const isCurrent = idx === currentLevelIndex;
                        return (
                            <tr
                                key={idx}
                                className={isCurrent ? 'bg-accent text-white' : (lvl.isBreak ? 'bg-surface-raised' : '')}
                            >
                                <td className={`px-3 py-2.5 text-center tabular ${isCurrent ? 'text-white' : 'text-ink-muted'}`}>{idx + 1}</td>
                                <td className="px-3 py-2.5">
                                    {lvl.isBreak ? (
                                        <span className={`text-xs uppercase tracking-wider ${isCurrent ? 'text-white/90' : 'text-ink-muted'}`}>
                                            {t('editor.breakTime')}
                                        </span>
                                    ) : (
                                        <span className={`tabular ${isCurrent ? 'text-white' : 'text-ink'}`}>
                                            {lvl.smallBlind} <span className={isCurrent ? 'text-white/60' : 'text-ink-faint'}>/</span> {lvl.bigBlind}
                                        </span>
                                    )}
                                </td>
                                <td className={`px-3 py-2.5 tabular ${isCurrent ? 'text-white' : 'text-ink-soft'}`}>
                                    {lvl.isBreak ? '—' : (lvl.ante || 0)}
                                </td>
                                <td className={`px-3 py-2.5 tabular ${isCurrent ? 'text-white' : 'text-ink-soft'}`}>
                                    {Math.round((lvl.duration || 0) / 60)} {t('editor.minutesShort')}
                                </td>
                            </tr>
                        );
                    })}
                    {levels.length === 0 && (
                        <tr>
                            <td colSpan={4} className="py-10 text-center text-sm text-ink-muted">
                                {t('editor.startByAdding')}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

const PrizesView: React.FC<{ prizes: Prize[] }> = ({ prizes }) => {
    const { t, formatCurrency } = useSettings();

    const sorted = [...prizes].filter(p => p.amount > 0).sort((a, b) => a.place - b.place);
    const total = sorted.reduce((sum, p) => sum + p.amount, 0);

    if (sorted.length === 0) {
        return (
            <div className="border border-line rounded bg-surface-raised text-center py-12 text-sm text-ink-muted">
                {t('controlPanel.noPrizes')}
            </div>
        );
    }

    return (
        <div className="border border-line rounded overflow-hidden">
            <ul className="divide-y divide-line">
                {sorted.map(prize => (
                    <li key={prize.place} className="flex items-center justify-between px-5 py-3">
                        <span className="text-sm text-ink-muted">{placeLabel(prize.place, t)}</span>
                        <span className="text-sm text-ink font-medium tabular">{formatCurrency(prize.amount)}</span>
                    </li>
                ))}
            </ul>
            <div className="flex items-center justify-between px-5 py-3 border-t border-line bg-surface-raised">
                <span className="text-micro uppercase text-ink-muted">{t('creator.total')}</span>
                <span className="text-sm text-ink font-medium tabular">{formatCurrency(total)}</span>
            </div>
        </div>
    );
};

export default ControlPanel;
