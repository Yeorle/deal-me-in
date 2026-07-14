import React, { useEffect, useState } from 'react';
import { SeatLocation, SeatMove, SeatMoveReason } from '../types';
import { useSettings } from '../i18n/useSettings';
import type { TranslationKey } from '../i18n/translations';

const REASON_KEY: Record<SeatMoveReason, TranslationKey> = {
    random: 'seatMoves.reasonRandom',
    manual: 'seatMoves.reasonManual',
    merge: 'seatMoves.reasonMerge',
    balance: 'seatMoves.reasonBalance',
    'final-table': 'seatMoves.reasonFinalTable',
};

const SeatMovePopup: React.FC = () => {
    const { t } = useSettings();
    const [moves, setMoves] = useState<SeatMove[]>([]);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const removeListener = window.api.onSeatMoves((newMoves) => {
            // Batches can arrive back-to-back (a merge immediately followed by
            // a balance) — append so the first batch isn't lost before the
            // operator has read it. Closing the popup clears the queue.
            setMoves(prev => [...prev, ...newMoves]);
            setIsOpen(true);
        });

        return () => {
            removeListener();
        };
    }, []);

    const handleClose = () => {
        setIsOpen(false);
        setMoves([]);
    };

    const formatLocation = (loc: SeatLocation): string => {
        if (loc.kind === 'unassigned') return t('seatMoves.unassigned');
        return t('seatMoves.tableSeat', { table: loc.tableNumber, seat: loc.seatNumber });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-ink/30 flex items-center justify-center p-4 z-[9999]">
            <div className="bg-surface rounded border border-line p-6 max-w-2xl w-full max-h-[80vh] flex flex-col">
                <div className="flex justify-between items-center mb-4 border-b border-line pb-3">
                    <h3 className="text-base font-semibold text-ink">{t('seatMoves.title')}</h3>
                    <div className="text-xs text-ink-muted">
                        {[...new Set(moves.map(m => m.reason))].map(r => t(REASON_KEY[r])).join(' · ')}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto mb-5 -mx-1">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-surface-raised border-b border-line sticky top-0">
                            <tr className="text-micro uppercase text-ink-muted">
                                <th className="px-3 py-2.5 font-medium">{t('seatMoves.player')}</th>
                                <th className="px-3 py-2.5 font-medium">{t('seatMoves.from')}</th>
                                <th className="px-3 py-2.5 font-medium text-center w-10"></th>
                                <th className="px-3 py-2.5 font-medium">{t('seatMoves.to')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {moves.map((move, index) => (
                                <tr key={index} className="hover:bg-surface-sunken transition-colors">
                                    <td className="px-3 py-2.5 text-ink font-medium">{move.playerName}</td>
                                    <td className="px-3 py-2.5 text-ink-soft">{formatLocation(move.from)}</td>
                                    <td className="px-3 py-2.5 text-ink-faint text-center">→</td>
                                    <td className="px-3 py-2.5 text-ink font-medium">{formatLocation(move.to)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={handleClose}
                        className="bg-accent text-white px-5 py-2 rounded text-sm font-medium hover:bg-accent-600 transition-colors"
                    >
                        {t('seatMoves.ok')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SeatMovePopup;
