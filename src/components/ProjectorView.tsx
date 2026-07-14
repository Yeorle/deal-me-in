import React, { useEffect, useState } from 'react';
import { TournamentState, Level, Prize } from '../types';
import { formatEuropeanTime, formatHMS } from '../utils/format';
import { placeLabel } from '../utils/place';
import { mediaUrl } from '../utils/media';
import logo from '../assets/logo.png';
import { useSettings } from '../i18n/useSettings';

interface TimerState {
    remainingTime: number;
    level: number;
    smallBlind: number;
    bigBlind: number;
    ante: number;
    isBreak: boolean;
    isRunning: boolean;
    isActive?: boolean;
    name?: string;
    nextLevel?: Level;
    playersRemaining: number;
    totalEntries: number;
    startingChips: number;
    timeUntilNextBreak: number | null;
    elapsedTime: number;
    prizes: Prize[];
}

const ProjectorView: React.FC = () => {
    const { t, formatCurrency, projector } = useSettings();
    const [timerState, setTimerState] = useState<TimerState>({
        remainingTime: 0,
        level: 1,
        smallBlind: 0,
        bigBlind: 0,
        ante: 0,
        isBreak: false,
        isRunning: false,
        name: '',
        playersRemaining: 0,
        totalEntries: 0,
        startingChips: 0,
        timeUntilNextBreak: null,
        elapsedTime: 0,
        prizes: []
    });
    const [currentTime, setCurrentTime] = useState<string>(formatEuropeanTime(new Date()));

    useEffect(() => {
        const handleStateUpdate = (state: TournamentState) => {
            setTimerState({
                remainingTime: state.timeLeftInLevel || 0,
                level: (state.currentLevelIndex || 0) + 1,
                smallBlind: state.currentLevel?.smallBlind || 0,
                bigBlind: state.currentLevel?.bigBlind || 0,
                ante: state.currentLevel?.ante || 0,
                isBreak: !!state.currentLevel?.isBreak,
                isRunning: !state.isPaused,
                isActive: state.isActive,
                name: state.name || '',
                nextLevel: state.nextLevel,
                playersRemaining: state.playersRemaining || 0,
                totalEntries: state.totalEntries || 0,
                startingChips: state.startingChips || 0,
                timeUntilNextBreak: state.timeUntilNextBreak ?? null,
                elapsedTime: state.elapsedTime ?? 0,
                prizes: state.prizes ?? []
            });
        };

        window.api.getTournamentState().then(handleStateUpdate);

        const removeListener = window.ipcRenderer.on('timer-update', handleStateUpdate);

        const clockInterval = setInterval(() => {
            setCurrentTime(formatEuropeanTime(new Date()));
        }, 1000);

        return () => {
            removeListener();
            clearInterval(clockInterval);
        };
    }, []);

    const mins = Math.floor(timerState.remainingTime / 60).toString().padStart(2, '0');
    const secs = (timerState.remainingTime % 60).toString().padStart(2, '0');

    const isCountdown = timerState.remainingTime < 60 && timerState.isRunning;
    const timerColor = isCountdown ? 'text-accent animate-pulse' : 'text-[color:var(--proj-ink)]';

    const averageStack = timerState.playersRemaining > 0 && timerState.startingChips > 0
        ? Math.round((timerState.totalEntries * timerState.startingChips) / timerState.playersRemaining)
        : 0;

    const next = timerState.nextLevel;

    const breakLabel = (() => {
        const remaining = timerState.timeUntilNextBreak;
        if (remaining === null) return '—';
        if (remaining === 0) return t('projector.onBreak');
        return formatHMS(remaining);
    })();

    const sortedPrizes = [...timerState.prizes].sort((a, b) => a.place - b.place);

    const background = projector.backgroundType === 'image' && projector.backgroundImage
        ? `center / cover no-repeat url("${mediaUrl(projector.backgroundImage)}")`
        : projector.backgroundColor;

    // Shadow inherits, but -webkit-text-stroke width does not, so apply both to
    // every text node under the root via a scoped style block.
    const textEffects: string[] = [];
    if (projector.textShadow) {
        textEffects.push(`text-shadow: 0 0 ${projector.textShadowBlur}px ${projector.textShadowColor};`);
    }
    if (projector.textOutline) {
        textEffects.push(`-webkit-text-stroke: ${projector.textOutlineWidth}px ${projector.textOutlineColor};`);
        textEffects.push('paint-order: stroke fill;');
    }
    const textEffectCss = textEffects.join(' ');

    return (
        <>
            {textEffectCss && <style>{`.projector-root, .projector-root * { ${textEffectCss} }`}</style>}
        <div
            className="projector-root h-screen w-screen grid overflow-hidden"
            style={{
                gridTemplateColumns: '20% 60% 20%',
                background,
                color: projector.textColor,
                // muted/faint variants via color-mix so the existing visual hierarchy is preserved
                ['--proj-ink' as string]: projector.textColor,
                ['--proj-ink-muted' as string]: `color-mix(in srgb, ${projector.textColor} 60%, transparent)`,
                ['--proj-ink-faint' as string]: `color-mix(in srgb, ${projector.textColor} 38%, transparent)`,
            }}
        >
            {/* Left column */}
            <aside className="flex flex-col items-center justify-around py-10 px-6 text-center">
                {/* Logo */}
                <div className="aspect-square w-full max-w-[16vw] flex items-center justify-center">
                    <img src={projector.logoPath ? mediaUrl(projector.logoPath) : logo} alt="Logo" className="w-full h-full object-contain" />
                </div>

                {/* Wall clock */}
                <div className="flex flex-col items-center">
                    <div className="text-[1.5vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-2">{t('projector.time')}</div>
                    <div className="text-[4vw] tabular text-[color:var(--proj-ink)] leading-none">
                        {currentTime}
                    </div>
                </div>

                {/* Total elapsed time */}
                <div className="flex flex-col items-center">
                    <div className="text-[1.5vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-2">{t('projector.totalTime')}</div>
                    <div className="text-[4vw] tabular text-[color:var(--proj-ink)] leading-none">
                        {formatHMS(timerState.elapsedTime)}
                    </div>
                </div>

                {/* Time until break */}
                <div className="flex flex-col items-center">
                    <div className="text-[1.5vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-2">{t('projector.nextBreak')}</div>
                    <div className="text-[4vw] tabular text-[color:var(--proj-ink)] leading-none">
                        {breakLabel}
                    </div>
                </div>
            </aside>

            {/* Center column */}
            <main className="relative flex flex-col items-center justify-center py-10 px-6 border-x border-ink-faint/100">
                {/* Tournament name */}
                {timerState.name && (
                    <div className="absolute top-10 left-0 right-0 text-center text-[3.5vw] text-[color:var(--proj-ink)] leading-none tracking-tight font-medium">
                        {timerState.name}
                    </div>
                )}

                {/* Current level label (or break banner) */}
                <div className="text-[3vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-6">
                    {timerState.isBreak ? t('projector.break') : `${t('projector.level')} ${timerState.level}`}
                </div>

                {/* Countdown timer */}
                <div className={`grid items-baseline leading-none mb-10 tracking-tight font-medium tabular text-[15vw] ${timerColor}`} style={{ gridTemplateColumns: '1fr auto 1fr' }}>
                    <span className="text-right">{mins}</span>
                    <span className="px-[0.05em]">:</span>
                    <span className="text-left">{secs}</span>
                </div>

                {/* Current blinds — hidden during a break ("0 / 0" means nothing) */}
                {!timerState.isBreak && (
                    <>
                        <div className="flex justify-center items-start gap-12">
                            <div className="flex flex-col items-center">
                                <div className="text-[2vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-3">{t('projector.smallBlind')}</div>
                                <div className="text-[5vw] tabular text-[color:var(--proj-ink)] leading-none">
                                    {timerState.smallBlind}
                                </div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-[2vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-3">{t('projector.bigBlind')}</div>
                                <div className="text-[5vw] tabular text-[color:var(--proj-ink)] leading-none">
                                    {timerState.bigBlind}
                                </div>
                            </div>
                        </div>
                        {timerState.ante > 0 && (
                            <div className="text-[2vw] text-[color:var(--proj-ink-muted)] mt-4 tabular">
                                {t('projector.ante')}: {timerState.ante}
                            </div>
                        )}
                    </>
                )}

                {/* Next blinds */}
                <div className="flex justify-center items-start gap-12 mt-10">
                    <div className="flex flex-col items-center">
                        <div className="text-[1.25vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-2">{t('projector.nextSb')}</div>
                        <div className="text-[3vw] tabular text-[color:var(--proj-ink-muted)] leading-none">
                            {next ? next.smallBlind : '—'}
                        </div>
                    </div>
                    <div className="flex flex-col items-center">
                        <div className="text-[1.25vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-2">{t('projector.nextBb')}</div>
                        <div className="text-[3vw] tabular text-[color:var(--proj-ink-muted)] leading-none">
                            {next ? next.bigBlind : '—'}
                        </div>
                    </div>
                </div>
                {next && next.ante && next.ante > 0 ? (
                    <div className="text-[1.25vw] text-[color:var(--proj-ink-muted)] mt-2 tabular">{t('projector.nextAnte')}: {next.ante}</div>
                ) : null}
            </main>

            {/* Right column */}
            <aside className="grid py-10 px-6 text-center" style={{ gridTemplateRows: '1fr 1fr' }}>
                {/* Prize distribution */}
                <div className="flex flex-col items-center justify-center border-b border-ink-faint/100 min-h-0 overflow-hidden">
                    <div className="text-[1.5vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-4">{t('projector.prizeDistribution')}</div>
                    {sortedPrizes.length > 0 ? (
                        <div className="flex flex-col items-stretch gap-2 w-full max-w-[14vw]">
                            {sortedPrizes.map(prize => (
                                <div key={prize.place} className="flex items-baseline justify-between gap-3">
                                    <span className="text-[1.75vw] text-[color:var(--proj-ink-muted)] tabular">{placeLabel(prize.place, t)}</span>
                                    <span className="text-[2.25vw] tabular text-[color:var(--proj-ink)] leading-none">
                                        {formatCurrency(prize.amount)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-[2vw] text-[color:var(--proj-ink-faint)] tabular">—</div>
                    )}
                </div>

                {/* Players + average stack */}
                <div className="flex flex-col items-center justify-around pt-6">
                    {/* Players remaining */}
                    <div className="flex flex-col items-center">
                        <div className="text-[1.5vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-2">{t('projector.players')}</div>
                        <div className="text-[4vw] tabular text-[color:var(--proj-ink)] leading-none">
                            {timerState.playersRemaining} <span className="text-[color:var(--proj-ink-faint)]">/</span> {timerState.totalEntries}
                        </div>
                    </div>

                    {/* Average stack */}
                    <div className="flex flex-col items-center">
                        <div className="text-[1.5vw] text-[color:var(--proj-ink-muted)] uppercase tracking-[0.25em] mb-2">{t('projector.avgStack')}</div>
                        <div className="text-[4vw] tabular text-[color:var(--proj-ink)] leading-none">
                            {averageStack > 0 ? averageStack.toLocaleString() : '—'}
                        </div>
                    </div>
                </div>
            </aside>
        </div>
        </>
    );
};

export default ProjectorView;
