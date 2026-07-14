import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TournamentResultsData } from '../types';
import { useSettings } from '../i18n/useSettings';
import { formatEuropeanDateTime, formatCurrencyWith, formatDuration } from '../utils/format';
import { placeLabel } from '../utils/place';
import { mediaUrl } from '../utils/media';
import { defaultAvatar } from '../utils/avatar';


const TournamentResultsView: React.FC = () => {
    const { t, language } = useSettings();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [data, setData] = useState<TournamentResultsData | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!id) return;
        window.api.getTournamentResults(Number(id)).then(d => {
            setData(d);
            setLoaded(true);
        });
    }, [id]);

    if (loaded && !data) {
        return (
            <div className="px-10 py-10 max-w-5xl">
                <BackLink label={t('history.back')} onClick={() => navigate('/history')} />
                <p className="text-sm text-ink-muted mt-6">{t('history.notFound')}</p>
            </div>
        );
    }

    if (!data) return null;

    const { tournament, results } = data;
    const money = (n: number) => formatCurrencyWith(n, tournament.currency, language);
    const prizePool = results.reduce((sum, r) => sum + r.prize, 0);
    const duration = results.reduce((max, r) => Math.max(max, r.playtime_sec), 0);

    return (
        <div className="px-10 py-10 max-w-5xl">
            <BackLink label={t('history.back')} onClick={() => navigate('/history')} />

            <h2 className="text-xl font-semibold tracking-tight mt-4 mb-1">{tournament.name}</h2>
            <div className="text-sm text-ink-muted mb-6 tabular">{formatEuropeanDateTime(tournament.start_date)}</div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
                <Stat label={t('history.structure')} value={tournament.structure_name || '-'} />
                <Stat label={t('history.entrants')} value={String(results.length)} />
                <Stat label={t('history.entryFee')} value={money(tournament.entry_fee)} />
                <Stat label={t('history.prizePool')} value={money(prizePool)} />
                <Stat label={t('history.duration')} value={formatDuration(duration)} />
            </div>

            <h3 className="text-micro uppercase text-ink-muted mb-3">{t('history.rankings')}</h3>
            <div className="bg-surface border border-line rounded overflow-hidden">
                {results.length === 0 ? (
                    <div className="px-6 py-12 text-center text-sm text-ink-muted">{t('history.noResults')}</div>
                ) : (
                    <table className="min-w-full text-sm">
                        <thead className="bg-surface-raised border-b border-line text-micro uppercase text-ink-muted">
                            <tr>
                                <th className="px-5 py-3 text-left font-medium w-20">{t('history.colPlace')}</th>
                                <th className="px-5 py-3 text-left font-medium">{t('history.colPlayer')}</th>
                                <th className="px-5 py-3 text-left font-medium">{t('history.colPlaytime')}</th>
                                <th className="px-5 py-3 text-right font-medium">{t('history.colPrize')}</th>
                                <th className="px-5 py-3 text-right font-medium">{t('history.colEarnings')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {results.map(r => {
                                const earnings = r.prize - r.entry_fee;
                                const deleted = r.is_deleted === 1 || !r.name;
                                return (
                                    <tr
                                        key={r.player_id}
                                        onClick={() => { if (!deleted) navigate(`/players/${r.player_id}`); }}
                                        className={`transition-colors ${deleted ? '' : 'hover:bg-surface-sunken cursor-pointer'}`}
                                    >
                                        <td className="px-5 py-3 tabular text-ink-muted">{placeLabel(r.place, t)}</td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <img
                                                    src={r.photo_path ? mediaUrl(r.photo_path) : defaultAvatar}
                                                    onError={(e) => { (e.target as HTMLImageElement).src = defaultAvatar; }}
                                                    alt={r.name || ''}
                                                    className="w-8 h-8 rounded-full object-cover border border-line"
                                                />
                                                <span className={deleted ? 'text-ink-faint italic' : 'text-ink font-medium'}>
                                                    {r.name || t('common.deletedPlayer')}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 tabular text-ink-soft">{formatDuration(r.playtime_sec)}</td>
                                        <td className="px-5 py-3 tabular text-ink-soft text-right">{money(r.prize)}</td>
                                        <td className={`px-5 py-3 tabular text-right font-medium ${earnings > 0 ? 'text-accent' : earnings < 0 ? 'text-danger' : 'text-ink-muted'}`}>
                                            {money(earnings)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="bg-surface border border-line rounded p-3">
        <div className="text-micro uppercase text-ink-muted mb-1">{label}</div>
        <div className="text-sm text-ink font-medium tabular truncate">{value}</div>
    </div>
);

const BackLink: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
    <button onClick={onClick} className="text-sm text-ink-muted hover:text-ink transition-colors">
        ← {label}
    </button>
);

export default TournamentResultsView;
