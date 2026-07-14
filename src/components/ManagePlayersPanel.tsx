import React, { useState, useMemo } from 'react';
import { Table, Player } from '../types';
import ConfirmationModal from './ConfirmationModal';
import { useSettings } from '../i18n/useSettings';

interface ManagePlayersPanelProps {
    tables: Table[];
    unassignedPlayers?: Player[];
    bustedPlayers?: Player[];
}

const DRAG_MIME = 'application/x-poker-player-id';

const ManagePlayersPanel: React.FC<ManagePlayersPanelProps> = ({ tables, unassignedPlayers = [], bustedPlayers = [] }) => {
    const { t } = useSettings();
    const [searchTerm, setSearchTerm] = useState('');
    const [bustTarget, setBustTarget] = useState<Player | null>(null);
    const [draggingPlayerId, setDraggingPlayerId] = useState<number | null>(null);
    const [dragOverSeat, setDragOverSeat] = useState<string | null>(null);

    const { activeTables, filteredBustedPlayers, filteredUnassignedPlayers } = useMemo(() => {
        let active = tables.map(t => ({ ...t, seats: t.seats }));
        let busted = [...bustedPlayers];
        let unassigned = [...unassignedPlayers];

        if (searchTerm) {
            const lowered = searchTerm.toLowerCase();
            active = active.map(t => ({
                ...t,
                seats: t.seats.filter(s =>
                    !s.player || (
                        s.player.name.toLowerCase().includes(lowered) ||
                        s.player.nickname?.toLowerCase().includes(lowered)
                    )
                )
            })).filter(t => t.seats.length > 0);

            busted = busted.filter(p =>
                p.name.toLowerCase().includes(lowered) ||
                p.nickname?.toLowerCase().includes(lowered)
            );

            unassigned = unassigned.filter(p =>
                p.name.toLowerCase().includes(lowered) ||
                p.nickname?.toLowerCase().includes(lowered)
            );
        }

        return { activeTables: active, filteredBustedPlayers: busted, filteredUnassignedPlayers: unassigned };
    }, [tables, bustedPlayers, unassignedPlayers, searchTerm]);

    const handleBustClick = (player: Player) => {
        setBustTarget(player);
    };

    const confirmBust = async () => {
        if (bustTarget?.id != null) {
            await window.api.bustPlayer(bustTarget.id);
        }
        setBustTarget(null);
    };

    const handleUnbust = async (playerId: number) => {
        await window.api.unbustPlayer(playerId);
    };

    const handleRandomizeSeating = async () => {
        await window.api.randomizeSeating();
    };

    const handleDragStart = (e: React.DragEvent, playerId: number) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DRAG_MIME, String(playerId));
        e.dataTransfer.setData('text/plain', String(playerId));
        setDraggingPlayerId(playerId);
    };

    const handleDragEnd = () => {
        setDraggingPlayerId(null);
        setDragOverSeat(null);
    };

    const handleSeatDragOver = (e: React.DragEvent, key: string) => {
        if (draggingPlayerId == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverSeat !== key) setDragOverSeat(key);
    };

    const handleSeatDragLeave = (key: string) => {
        if (dragOverSeat === key) setDragOverSeat(null);
    };

    const handleSeatDrop = async (e: React.DragEvent, tableNumber: number, seatNumber: number) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain');
        const playerId = Number(raw);
        setDragOverSeat(null);
        setDraggingPlayerId(null);
        if (!playerId) return;
        await window.api.seatPlayer(playerId, tableNumber, seatNumber);
    };

    return (
        <div>
            <div className="mb-5">
                <input
                    type="text"
                    placeholder={t('manage.searchPlaceholder')}
                    className="w-full bg-surface border border-line text-ink rounded px-3 py-2 text-sm placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <div className="space-y-6">
                <div className="space-y-4">
                    {activeTables.map(table => (
                        <div key={table.tableNumber} className="bg-surface-raised border border-line rounded p-4">
                            <h3 className="text-micro uppercase font-medium text-ink-muted mb-3">
                                {t('manage.table')} {table.tableNumber}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                {table.seats.map(seat => {
                                    const seatKey = `${table.tableNumber}-${seat.seatNumber}`;
                                    const isDropTarget = !seat.player && draggingPlayerId != null;
                                    const isDragOver = dragOverSeat === seatKey;
                                    return (
                                        <div
                                            key={seat.seatNumber}
                                            onDragOver={!seat.player ? (e) => handleSeatDragOver(e, seatKey) : undefined}
                                            onDragLeave={!seat.player ? () => handleSeatDragLeave(seatKey) : undefined}
                                            onDrop={!seat.player ? (e) => handleSeatDrop(e, table.tableNumber, seat.seatNumber) : undefined}
                                            className={`px-3 py-2 rounded border transition-colors ${
                                                seat.player
                                                    ? 'bg-surface border-line'
                                                    : isDragOver
                                                        ? 'bg-accent-50 border-accent'
                                                        : isDropTarget
                                                            ? 'bg-surface border-dashed border-accent'
                                                            : 'bg-surface border-dashed border-line'
                                            }`}
                                        >
                                            <div className="flex justify-between items-center gap-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-micro tabular text-ink-faint w-5">{seat.seatNumber}</span>
                                                    <span className={`text-sm truncate ${seat.player ? 'text-ink font-medium' : 'text-ink-faint'}`} title={seat.player?.name}>
                                                        {seat.player ? seat.player.name : (isDropTarget ? t('manage.dropHere') : t('manage.empty'))}
                                                    </span>
                                                </div>
                                                {seat.player && (
                                                    <button
                                                        onClick={() => handleBustClick(seat.player!)}
                                                        className="text-micro uppercase text-ink-muted hover:text-danger transition-colors font-medium"
                                                    >
                                                        {t('manage.bust')}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    {activeTables.length === 0 && !searchTerm && (
                        <div className="text-center py-10 text-sm text-ink-muted">{t('manage.allBusted')}</div>
                    )}
                </div>

                {filteredUnassignedPlayers.length > 0 && (
                    <div className="pt-5 border-t border-line">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-micro uppercase font-medium text-ink-muted flex items-center gap-2">
                                <span>{t('manage.unassigned')}</span>
                                <span className="text-ink-faint tabular">({filteredUnassignedPlayers.length})</span>
                                <span className="hidden md:inline normal-case text-ink-faint font-normal tracking-normal">{t('manage.dragOnto')}</span>
                            </h3>
                            <button
                                onClick={handleRandomizeSeating}
                                className="bg-accent text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-accent-600 transition-colors"
                            >
                                {t('manage.randomize')}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {filteredUnassignedPlayers.map(p => (
                                <div
                                    key={p.id}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, p.id!)}
                                    onDragEnd={handleDragEnd}
                                    className={`px-3 py-2 rounded border bg-surface border-line cursor-grab active:cursor-grabbing transition-colors hover:border-line-strong ${draggingPlayerId === p.id ? 'opacity-40' : ''}`}
                                >
                                    <div className="flex justify-between items-center gap-2">
                                        <span className="text-sm text-ink font-medium truncate" title={p.name}>{p.name}</span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <button
                                                onClick={() => handleBustClick(p)}
                                                className="text-micro uppercase text-ink-muted hover:text-danger transition-colors font-medium"
                                            >
                                                {t('manage.bust')}
                                            </button>
                                            <span className="text-ink-faint text-xs">⠿</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {filteredBustedPlayers.length > 0 && (
                    <div className="pt-5 border-t border-line">
                        <h3 className="text-micro uppercase font-medium text-ink-muted mb-3 flex items-center gap-2">
                            <span>{t('manage.busted')}</span>
                            <span className="text-ink-faint tabular">({filteredBustedPlayers.length})</span>
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {filteredBustedPlayers.map(player => (
                                <div
                                    key={player.id}
                                    className="px-3 py-2 rounded border border-line bg-surface-raised"
                                >
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm text-ink-muted line-through truncate" title={player.name}>{player.name}</span>
                                        <button
                                            onClick={() => handleUnbust(player.id!)}
                                            className="text-micro uppercase text-ink-muted hover:text-ink transition-colors font-medium"
                                        >
                                            {t('manage.unbust')}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTables.length === 0 && filteredBustedPlayers.length === 0 && filteredUnassignedPlayers.length === 0 && (
                    <div className="text-center py-16 text-sm text-ink-muted">
                        {searchTerm ? t('manage.noPlayersFound', { q: searchTerm }) : t('manage.noPlayersSeated')}
                    </div>
                )}
            </div>

            <ConfirmationModal
                isOpen={bustTarget !== null}
                onClose={() => setBustTarget(null)}
                onConfirm={confirmBust}
                title={t('manage.bustTitle')}
                message={bustTarget ? t('manage.bustMessage', { name: bustTarget.name }) : ''}
                confirmButtonText={t('manage.bustConfirm')}
                isDestructive={true}
            />
        </div>
    );
};

export default ManagePlayersPanel;
