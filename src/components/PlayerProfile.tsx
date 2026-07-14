import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PlayerProfileData } from '../types';
import { useSettings } from '../i18n/useSettings';
import { formatEuropeanDateTime, formatDuration } from '../utils/format';
import { placeLabel } from '../utils/place';
import { mediaUrl } from '../utils/media';
import { defaultAvatar } from '../utils/avatar';


const PlayerProfile: React.FC = () => {
    const { t, formatCurrency } = useSettings();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [data, setData] = useState<PlayerProfileData | null>(null);
    const [loaded, setLoaded] = useState(false);

    const [name, setName] = useState('');
    const [nickname, setNickname] = useState('');
    const [email, setEmail] = useState('');
    const [photoPath, setPhotoPath] = useState('');
    const [existingPhotoPath, setExistingPhotoPath] = useState<string | undefined>(undefined);
    const [justSaved, setJustSaved] = useState(false);

    const load = async () => {
        if (!id) return;
        const d = await window.api.getPlayerProfile(Number(id));
        setData(d);
        setLoaded(true);
        if (d) {
            setName(d.player.name || '');
            setNickname(d.player.nickname || '');
            setEmail(d.player.email || '');
            setExistingPhotoPath(d.player.photo_path);
            setPhotoPath('');
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !id) return;
        await window.api.updatePlayer({
            id: Number(id),
            name,
            nickname,
            email,
            photoPath,
            photo_path: existingPhotoPath,
        });
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
        await load();
    };

    if (loaded && !data) {
        return (
            <div className="px-10 py-10 max-w-5xl">
                <BackLink label={t('profile.back')} onClick={() => navigate('/players')} />
                <p className="text-sm text-ink-muted mt-6">{t('profile.notFound')}</p>
            </div>
        );
    }
    if (!data) return null;

    const { stats, history } = data;
    const previewSrc = photoPath
        ? mediaUrl(photoPath)
        : existingPhotoPath ? mediaUrl(existingPhotoPath) : defaultAvatar;

    const inputClass = "w-full bg-surface border border-line rounded px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors";

    return (
        <div className="px-10 py-10 max-w-5xl">
            <BackLink label={t('profile.back')} onClick={() => navigate('/players')} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
                {/* Editable info */}
                <form onSubmit={handleSave} className="bg-surface border border-line rounded p-5 lg:col-span-1">
                    <h3 className="text-sm font-medium text-ink mb-4">{t('profile.editInfo')}</h3>
                    <div className="flex justify-center mb-5">
                        <img
                            src={previewSrc}
                            onError={(e) => { (e.target as HTMLImageElement).src = defaultAvatar; }}
                            alt={name}
                            className="w-24 h-24 rounded-full object-cover border border-line"
                        />
                    </div>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('players.name')}</label>
                            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('players.nickname')}</label>
                            <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('players.email')}</label>
                            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('players.updatePhoto')}</label>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) setPhotoPath(window.api.getPathForFile(file));
                                }}
                                className="block w-full text-sm text-ink-soft file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-line file:text-xs file:font-medium file:bg-surface file:text-ink hover:file:bg-surface-sunken file:transition-colors file:cursor-pointer"
                            />
                        </div>
                    </div>
                    <div className="mt-5 flex justify-end items-center gap-3">
                        {justSaved && <span className="text-xs text-accent">{t('profile.saved')}</span>}
                        <button type="submit" className="bg-accent text-white px-4 py-2 rounded text-sm font-medium hover:bg-accent-600 transition-colors">
                            {t('common.save')}
                        </button>
                    </div>
                </form>

                {/* Stats + history */}
                <div className="lg:col-span-2 space-y-6">
                    <div>
                        <h3 className="text-micro uppercase text-ink-muted mb-3">{t('profile.stats')}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <Stat label={t('profile.tournamentsPlayed')} value={String(stats.tournaments)} />
                            <Stat label={t('profile.totalPlaytime')} value={formatDuration(stats.total_playtime)} />
                            <Stat label={t('profile.totalEarnings')} value={formatCurrency(stats.total_earnings)} valueClass={stats.total_earnings > 0 ? 'text-accent' : stats.total_earnings < 0 ? 'text-danger' : 'text-ink'} />
                            <Stat label={t('profile.bestFinish')} value={stats.best_place ? placeLabel(stats.best_place, t) : '-'} />
                            <Stat label={t('profile.wins')} value={String(stats.wins)} />
                            <Stat label={t('profile.cashes')} value={String(stats.cashes)} />
                        </div>
                    </div>

                    <div>
                        <h3 className="text-micro uppercase text-ink-muted mb-3">{t('profile.playHistory')}</h3>
                        <div className="bg-surface border border-line rounded overflow-hidden">
                            {history.length === 0 ? (
                                <div className="px-6 py-12 text-center text-sm text-ink-muted">{t('profile.noHistory')}</div>
                            ) : (
                                <table className="min-w-full text-sm">
                                    <thead className="bg-surface-raised border-b border-line text-micro uppercase text-ink-muted">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-medium">{t('profile.colDate')}</th>
                                            <th className="px-4 py-3 text-left font-medium">{t('profile.colTournament')}</th>
                                            <th className="px-4 py-3 text-left font-medium">{t('profile.colPlace')}</th>
                                            <th className="px-4 py-3 text-left font-medium">{t('profile.colPlaytime')}</th>
                                            <th className="px-4 py-3 text-right font-medium">{t('profile.colEarnings')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {history.map(h => {
                                            const earnings = h.prize - h.entry_fee;
                                            return (
                                                <tr
                                                    key={h.tournament_id}
                                                    onClick={() => navigate(`/history/${h.tournament_id}`)}
                                                    className="hover:bg-surface-sunken transition-colors cursor-pointer"
                                                >
                                                    <td className="px-4 py-3 text-ink-soft tabular whitespace-nowrap">{formatEuropeanDateTime(h.start_date)}</td>
                                                    <td className="px-4 py-3 text-ink font-medium">{h.name}</td>
                                                    <td className="px-4 py-3 text-ink-soft tabular">{placeLabel(h.place, t)}</td>
                                                    <td className="px-4 py-3 text-ink-soft tabular">{formatDuration(h.playtime_sec)}</td>
                                                    <td className={`px-4 py-3 tabular text-right font-medium ${earnings > 0 ? 'text-accent' : earnings < 0 ? 'text-danger' : 'text-ink-muted'}`}>
                                                        {formatCurrency(earnings)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Stat: React.FC<{ label: string; value: string; valueClass?: string }> = ({ label, value, valueClass = 'text-ink' }) => (
    <div className="bg-surface border border-line rounded p-3">
        <div className="text-micro uppercase text-ink-muted mb-1">{label}</div>
        <div className={`text-sm font-medium tabular truncate ${valueClass}`}>{value}</div>
    </div>
);

const BackLink: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
    <button onClick={onClick} className="text-sm text-ink-muted hover:text-ink transition-colors">
        ← {label}
    </button>
);

export default PlayerProfile;
