import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Player } from '../types';
import { useSettings } from '../i18n/useSettings';
import { mediaUrl } from '../utils/media';
import { defaultAvatar } from '../utils/avatar';

const PlayerManagement: React.FC = () => {
    const { t } = useSettings();
    const navigate = useNavigate();
    const [players, setPlayers] = useState<Player[]>([]);

    const [name, setName] = useState('');
    const [nickname, setNickname] = useState('');
    const [email, setEmail] = useState('');
    const [photoPath, setPhotoPath] = useState('');

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [playerToDelete, setPlayerToDelete] = useState<number | null>(null);
    const [hasConfirmedDelete, setHasConfirmedDelete] = useState(false);


    const fetchPlayers = async () => {
        try {
            const result = await window.api.getPlayers();
            setPlayers(result);
        } catch (error) {
            console.error('Failed to fetch players:', error);
        }
    };

    useEffect(() => {
        fetchPlayers();
    }, []);

    const resetForm = () => {
        setName('');
        setNickname('');
        setEmail('');
        setPhotoPath('');
    };

    const handleAddPlayer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        try {
            await window.api.addPlayer({ name, nickname, email, photoPath });
            resetForm();
            fetchPlayers();
        } catch (error) {
            console.error('Failed to save player:', error);
        }
    };

    const confirmDeleteClick = (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setPlayerToDelete(id);
        setHasConfirmedDelete(false);
        setIsDeleteModalOpen(true);
    };

    const handleDelete = async () => {
        if (playerToDelete !== null) {
            try {
                await window.api.deletePlayer(playerToDelete);
                setIsDeleteModalOpen(false);
                setPlayerToDelete(null);
                fetchPlayers();
            } catch (error) {
                console.error('Failed to delete player:', error);
            }
        }
    };

    const inputClass = "w-full bg-surface border border-line rounded px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors";

    return (
        <div className="px-10 py-10 max-w-6xl">
            <h2 className="text-xl font-semibold tracking-tight mb-8">{t('players.title')}</h2>

            <form onSubmit={handleAddPlayer} className="mb-8 bg-surface border border-line rounded p-5">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-medium text-ink">{t('players.addNewPlayer')}</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                    <div>
                        <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('players.name')}</label>
                        <input
                            type="text"
                            placeholder={t('players.name')}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('players.nickname')}</label>
                        <input
                            type="text"
                            placeholder={t('players.nickname')}
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('players.email')}</label>
                        <input
                            type="email"
                            placeholder={t('players.email')}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('players.photo')}</label>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    setPhotoPath(window.api.getPathForFile(file));
                                }
                            }}
                            className="block w-full text-sm text-ink-soft file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-line file:text-xs file:font-medium file:bg-surface file:text-ink hover:file:bg-surface-sunken file:transition-colors file:cursor-pointer"
                        />
                    </div>
                </div>
                <div className="mt-5 flex justify-end">
                    <button type="submit" className="bg-accent text-white px-4 py-2 rounded text-sm font-medium hover:bg-accent-600 transition-colors">
                        {t('players.addPlayer')}
                    </button>
                </div>
            </form>

            <div className="bg-surface border border-line rounded overflow-hidden">
                <table className="min-w-full text-sm">
                    <thead className="bg-surface-raised border-b border-line text-micro uppercase text-ink-muted">
                        <tr>
                            <th className="px-5 py-3 text-left font-medium w-16">{t('players.id')}</th>
                            <th className="px-5 py-3 text-left font-medium w-20">{t('players.photo')}</th>
                            <th className="px-5 py-3 text-left font-medium">{t('players.name')}</th>
                            <th className="px-5 py-3 text-left font-medium">{t('players.nickname')}</th>
                            <th className="px-5 py-3 text-left font-medium">{t('players.email')}</th>
                            <th className="px-5 py-3 text-right font-medium w-32">{t('common.actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                        {players.map((player) => (
                            <tr
                                key={player.id}
                                onClick={() => navigate(`/players/${player.id}`)}
                                className="hover:bg-surface-sunken transition-colors cursor-pointer"
                            >
                                <td className="px-5 py-3 text-ink-faint tabular">{player.id}</td>
                                <td className="px-5 py-3">
                                    <img
                                        src={player.photo_path ? mediaUrl(player.photo_path) : defaultAvatar}
                                        onError={(e) => {
                                            const target = e.target as HTMLImageElement;
                                            target.src = defaultAvatar;
                                        }}
                                        alt={player.name}
                                        className="w-9 h-9 rounded-full object-cover border border-line"
                                    />
                                </td>
                                <td className="px-5 py-3 text-ink font-medium">{player.name}</td>
                                <td className="px-5 py-3 text-ink-soft">{player.nickname || '-'}</td>
                                <td className="px-5 py-3 text-ink-soft">{player.email || '-'}</td>
                                <td className="px-5 py-3 text-right">
                                    <button
                                        onClick={(e) => confirmDeleteClick(player.id!, e)}
                                        className="text-ink-muted hover:text-danger text-xs font-medium transition-colors"
                                    >
                                        {t('common.delete')}
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {players.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-5 py-8 text-center text-sm text-ink-muted">
                                    {t('players.noPlayers')}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {isDeleteModalOpen && (
                <div className="fixed inset-0 bg-ink/30 flex items-center justify-center p-4 z-50">
                    <div className="bg-surface rounded p-6 max-w-sm w-full border border-line">
                        <h3 className="text-base font-semibold mb-3 text-ink">{t('common.confirmDeletion')}</h3>
                        <p className="text-sm text-ink-soft mb-5">
                            {t('players.confirmDeletionMessage')}
                        </p>

                        <label htmlFor="confirmDelete" className="flex items-center gap-2 mb-5 text-sm text-ink-soft select-none cursor-pointer">
                            <input
                                type="checkbox"
                                id="confirmDelete"
                                checked={hasConfirmedDelete}
                                onChange={(e) => setHasConfirmedDelete(e.target.checked)}
                                className="w-4 h-4 accent-accent"
                            />
                            {t('players.confirmDeletionCheckbox')}
                        </label>

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setIsDeleteModalOpen(false)}
                                className="px-4 py-2 rounded border border-line bg-surface text-ink text-sm font-medium hover:bg-surface-sunken transition-colors"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={!hasConfirmedDelete}
                                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                                    hasConfirmedDelete
                                        ? 'bg-accent text-white hover:bg-accent-600'
                                        : 'bg-line text-ink-faint cursor-not-allowed'
                                }`}
                            >
                                {t('common.confirmDelete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlayerManagement;
