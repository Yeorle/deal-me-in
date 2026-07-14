import React, { useEffect, useState } from 'react';
import { Structure } from '../types';
import { useSettings } from '../i18n/useSettings';

const StructureList: React.FC = () => {
    const { t } = useSettings();
    const [structures, setStructures] = useState<Structure[]>([]);

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [structureToDelete, setStructureToDelete] = useState<number | null>(null);
    const [hasConfirmedDelete, setHasConfirmedDelete] = useState(false);

    const fetchStructures = async () => {
        try {
            const result = await window.api.getStructures();
            setStructures(result);
        } catch (error) {
            console.error('Failed to fetch structures:', error);
        }
    };

    useEffect(() => {
        fetchStructures();
        // The main process broadcasts after every structure mutation (saves
        // happen in the separate editor window), so no polling is needed.
        const removeListener = window.ipcRenderer.on('structures-updated', fetchStructures);
        return () => removeListener();
    }, []);

    const handleCreateNew = () => {
        window.api.openStructureEditor();
    };

    const handleEdit = (id: number) => {
        window.api.openStructureEditor(id);
    };

    const confirmDelete = (id: number) => {
        setStructureToDelete(id);
        setHasConfirmedDelete(false);
        setIsDeleteModalOpen(true);
    };

    const handleDelete = async () => {
        if (structureToDelete !== null) {
            try {
                await window.api.deleteStructure(structureToDelete);
                setIsDeleteModalOpen(false);
                setStructureToDelete(null);
                fetchStructures();
            } catch (error) {
                console.error('Failed to delete structure:', error);
            }
        }
    };

    return (
        <div className="px-10 py-10 max-w-6xl">
            <div className="flex justify-between items-center mb-8">
                <h2 className="text-xl font-semibold tracking-tight">{t('structureList.title')}</h2>
                <button
                    onClick={handleCreateNew}
                    className="bg-accent text-white px-4 py-2 rounded text-sm font-medium hover:bg-accent-600 transition-colors"
                >
                    {t('structureList.createNew')}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {structures.map((struct) => (
                    <div key={struct.id} className="bg-surface border border-line rounded p-5 flex flex-col hover:border-line-strong transition-colors">
                        <h3 className="text-base font-semibold mb-3 text-ink">{struct.name}</h3>
                        <div className="space-y-1 mb-5 text-sm flex-grow">
                            <div className="flex justify-between">
                                <span className="text-ink-muted">{t('structureList.startingChips')}</span>
                                <span className="text-ink tabular">{struct.starting_chips.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-ink-muted">{t('structureList.levels')}</span>
                                <span className="text-ink tabular">{JSON.parse(struct.data).length}</span>
                            </div>
                        </div>

                        <div className="flex gap-2 mt-auto pt-4 border-t border-line">
                            <button
                                onClick={() => handleEdit(struct.id!)}
                                className="flex-1 bg-surface border border-line text-ink py-1.5 rounded text-xs font-medium hover:bg-surface-sunken transition-colors"
                            >
                                {t('common.edit')}
                            </button>
                            <button
                                onClick={() => confirmDelete(struct.id!)}
                                className="flex-1 bg-surface border border-line text-ink-muted py-1.5 rounded text-xs font-medium hover:bg-danger-soft hover:text-danger transition-colors"
                            >
                                {t('common.delete')}
                            </button>
                        </div>
                    </div>
                ))}

                {structures.length === 0 && (
                    <div className="col-span-full text-center py-16 border border-line rounded bg-surface text-ink-muted text-sm">
                        {t('structureList.none')}
                    </div>
                )}
            </div>

            {isDeleteModalOpen && (
                <div className="fixed inset-0 bg-ink/30 flex items-center justify-center p-4 z-50">
                    <div className="bg-surface rounded p-6 max-w-sm w-full border border-line">
                        <h3 className="text-base font-semibold mb-3 text-ink">{t('common.confirmDeletion')}</h3>
                        <p className="text-sm text-ink-soft mb-5">
                            {t('structureList.confirmDeletionMessage')}
                        </p>

                        <label htmlFor="confirmDeleteStruct" className="flex items-center gap-2 mb-5 text-sm text-ink-soft select-none cursor-pointer">
                            <input
                                type="checkbox"
                                id="confirmDeleteStruct"
                                checked={hasConfirmedDelete}
                                onChange={(e) => setHasConfirmedDelete(e.target.checked)}
                                className="w-4 h-4 accent-accent"
                            />
                            {t('structureList.confirmDeletionCheckbox')}
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

export default StructureList;
