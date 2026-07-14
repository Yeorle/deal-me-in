import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArchivedTournament } from '../types';
import { useSettings } from '../i18n/useSettings';
import { formatEuropeanDateTime, formatCurrencyWith } from '../utils/format';
import ConfirmationModal from './ConfirmationModal';

const TournamentHistory: React.FC = () => {
    const { t, language } = useSettings();
    const navigate = useNavigate();
    const [tournaments, setTournaments] = useState<ArchivedTournament[]>([]);
    const [deleteId, setDeleteId] = useState<number | null>(null);

    const load = async () => {
        const rows = await window.api.getArchivedTournaments();
        setTournaments(rows);
    };

    useEffect(() => {
        load();
    }, []);

    const confirmDelete = async () => {
        if (deleteId !== null) {
            await window.api.deleteTournament(deleteId);
            setDeleteId(null);
            load();
        }
    };

    return (
        <div className="px-10 py-10 max-w-6xl">
            <h2 className="text-xl font-semibold tracking-tight mb-8">{t('history.title')}</h2>

            <div className="bg-surface border border-line rounded overflow-hidden">
                {tournaments.length === 0 ? (
                    <div className="px-6 py-16 text-center text-sm text-ink-muted">{t('history.none')}</div>
                ) : (
                    <table className="min-w-full text-sm">
                        <thead className="bg-surface-raised border-b border-line text-micro uppercase text-ink-muted">
                            <tr>
                                <th className="px-5 py-3 text-left font-medium">{t('history.colDate')}</th>
                                <th className="px-5 py-3 text-left font-medium">{t('history.colName')}</th>
                                <th className="px-5 py-3 text-left font-medium">{t('history.colStructure')}</th>
                                <th className="px-5 py-3 text-right font-medium">{t('history.colPlayers')}</th>
                                <th className="px-5 py-3 text-left font-medium">{t('history.colWinner')}</th>
                                <th className="px-5 py-3 text-right font-medium">{t('history.colPrizePool')}</th>
                                <th className="px-5 py-3 text-right font-medium w-20"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {tournaments.map(at => (
                                <tr
                                    key={at.id}
                                    onClick={() => navigate(`/history/${at.id}`)}
                                    className="hover:bg-surface-sunken transition-colors cursor-pointer"
                                >
                                    <td className="px-5 py-3 text-ink-soft tabular whitespace-nowrap">{formatEuropeanDateTime(at.start_date)}</td>
                                    <td className="px-5 py-3 text-ink font-medium">{at.name}</td>
                                    <td className="px-5 py-3 text-ink-soft">{at.structure_name || '-'}</td>
                                    <td className="px-5 py-3 text-ink-soft tabular text-right">{at.player_count}</td>
                                    <td className="px-5 py-3 text-ink-soft">{at.winner_name || (at.player_count > 0 ? t('common.deletedPlayer') : '-')}</td>
                                    <td className="px-5 py-3 text-ink-soft tabular text-right">{formatCurrencyWith(at.prize_pool, at.currency, language)}</td>
                                    <td className="px-5 py-3 text-right">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setDeleteId(at.id); }}
                                            className="text-ink-muted hover:text-danger text-xs font-medium transition-colors"
                                        >
                                            {t('common.delete')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <ConfirmationModal
                isOpen={deleteId !== null}
                onClose={() => setDeleteId(null)}
                onConfirm={confirmDelete}
                title={t('history.deleteArchiveTitle')}
                message={t('history.deleteArchiveMessage')}
                checkboxLabel={t('history.deleteArchiveCheckbox')}
                confirmButtonText={t('history.deleteArchiveConfirm')}
                isDestructive={true}
            />
        </div>
    );
};

export default TournamentHistory;
