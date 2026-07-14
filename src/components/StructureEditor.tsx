import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSettings } from '../i18n/useSettings';

interface BlindLevel {
    smallBlind: number;
    bigBlind: number;
    ante: number;
    duration: number;
    isBreak?: boolean;
}

// Rows carry a stable client-side key so drag-reordering doesn't remount
// inputs (index keys make focus/DOM state jump on reorder). The key is
// stripped before the levels are serialized to the DB.
interface EditorLevel extends BlindLevel {
    _key: number;
}

const StructureEditor: React.FC = () => {
    const { t } = useSettings();
    const location = useLocation();
    const [structureName, setStructureName] = useState('');
    const [startingChips, setStartingChips] = useState(1000);
    const [levels, setLevels] = useState<EditorLevel[]>([]);
    const [editId, setEditId] = useState<number | null>(null);
    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
    const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
    const keyCounter = useRef(0);
    const newKey = () => ++keyCounter.current;

    useEffect(() => {
        const loadStructure = async () => {
            const searchParams = new URLSearchParams(location.search);
            const idParam = searchParams.get('id');
            if (idParam) {
                const id = parseInt(idParam, 10);
                try {
                    const struct = await window.api.getStructure(id);
                    if (struct) {
                        setEditId(struct.id!);
                        setStructureName(struct.name);
                        setStartingChips(struct.starting_chips);
                        const parsedLevels = JSON.parse(struct.data) as BlindLevel[];
                        setLevels(parsedLevels.map(lvl => ({ ...lvl, _key: newKey() })));
                    }
                } catch (error) {
                    console.error("Failed to load structure:", error);
                }
            }
        };
        loadStructure();
    }, [location.search]);

    const handleAddLevel = () => {
        let referenceLevel = null;
        for (let i = levels.length - 1; i >= 0; i--) {
            if (!levels[i].isBreak) {
                referenceLevel = levels[i];
                break;
            }
        }

        const newSb = referenceLevel ? referenceLevel.smallBlind * 2 : 25;
        const newBb = referenceLevel ? referenceLevel.bigBlind * 2 : 50;
        const newAnte = referenceLevel ? referenceLevel.ante : 0;
        const lastLevel = levels.length > 0 ? levels[levels.length - 1] : null;
        const newDuration = lastLevel ? lastLevel.duration : 15;

        setLevels([...levels, {
            smallBlind: newSb,
            bigBlind: newBb,
            ante: newAnte,
            duration: newDuration,
            isBreak: false,
            _key: newKey()
        }]);
    };

    const handleAddBreak = () => {
        setLevels([...levels, {
            smallBlind: 0,
            bigBlind: 0,
            ante: 0,
            duration: 15,
            isBreak: true,
            _key: newKey()
        }]);
    };

    const handleRemoveLevel = (index: number) => {
        const newLevels = [...levels];
        newLevels.splice(index, 1);
        setLevels(newLevels);
    };

    const handleUpdateLevel = (index: number, field: keyof BlindLevel, value: number) => {
        const newLevels = [...levels];
        newLevels[index] = { ...newLevels[index], [field]: value };
        setLevels(newLevels);
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedItemIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === index) return;

        const newLevels = [...levels];
        const item = newLevels.splice(draggedItemIndex, 1)[0];
        newLevels.splice(index, 0, item);
        setLevels(newLevels);
        setDraggedItemIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedItemIndex(null);
    };

    const validate = (): string | null => {
        if (!structureName.trim()) return t('editor.validationName');
        if (levels.length === 0) return t('editor.validationNoLevels');
        for (let i = 0; i < levels.length; i++) {
            const lvl = levels[i];
            if (!lvl.duration || lvl.duration < 1) return t('editor.validationDuration', { n: i + 1 });
            if (!lvl.isBreak && (lvl.smallBlind <= 0 || lvl.bigBlind <= 0 || lvl.bigBlind < lvl.smallBlind)) {
                return t('editor.validationBlinds', { n: i + 1 });
            }
        }
        return null;
    };

    const handleSave = async () => {
        setNotice(null);
        const validationError = validate();
        if (validationError) {
            setNotice({ kind: 'error', text: validationError });
            return false;
        }

        try {
            const structData = {
                name: structureName,
                starting_chips: Number(startingChips),
                // Strip the client-side _key — only the level fields are stored.
                data: JSON.stringify(levels.map(({ smallBlind, bigBlind, ante, duration, isBreak }) =>
                    ({ smallBlind, bigBlind, ante, duration, isBreak })))
            };

            if (editId) {
                await window.api.updateStructure({ ...structData, id: editId });
            } else {
                // Capture the new row id so a second "Save" updates the same
                // structure instead of inserting a duplicate.
                const result = await window.api.saveStructure(structData);
                setEditId(Number(result.lastInsertRowid));
            }
            return true;
        } catch (error) {
            console.error('Failed to save structure:', error);
            setNotice({ kind: 'error', text: t('editor.saveFailedAlert') });
            return false;
        }
    };

    const onSave = async () => {
        const success = await handleSave();
        if (success) setNotice({ kind: 'success', text: t('editor.savedAlert') });
    };

    const onClose = () => {
        window.close();
    };

    const onSaveAndClose = async () => {
        const success = await handleSave();
        if (success) {
            window.close();
        }
    };

    const inputClass = "w-full bg-surface border border-line rounded px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors";
    const cellInputClass = "w-full bg-surface border border-line rounded px-2 py-1.5 text-sm text-ink text-center tabular focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors";

    return (
        <div className="px-8 py-8 pb-24 min-h-screen bg-surface-sunken text-ink font-sans">
            <h2 className="text-xl font-semibold mb-6 tracking-tight">{editId ? t('editor.editTitle') : t('editor.newTitle')}</h2>

            <div className="bg-surface border border-line rounded p-5 mb-5">
                <h3 className="text-micro uppercase font-medium text-ink-muted mb-4">{t('editor.tournamentDetails')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('editor.structureName')}</label>
                        <input
                            type="text"
                            value={structureName}
                            onChange={(e) => setStructureName(e.target.value)}
                            className={inputClass}
                            placeholder={t('editor.structureNamePlaceholder')}
                        />
                    </div>
                    <div>
                        <label className="block text-micro uppercase text-ink-muted mb-1.5">{t('editor.startingChips')}</label>
                        <input
                            type="number"
                            value={startingChips}
                            onChange={(e) => setStartingChips(Number(e.target.value))}
                            className={inputClass}
                        />
                    </div>
                </div>
            </div>

            <div className="bg-surface border border-line rounded flex flex-col">
                <div className="px-5 py-4 border-b border-line">
                    <h3 className="text-micro uppercase font-medium text-ink-muted">{t('editor.structureLevels')}</h3>
                </div>

                <div className="overflow-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-surface-raised border-b border-line">
                            <tr className="text-micro uppercase text-ink-muted">
                                <th className="px-3 py-2.5 font-medium w-10"></th>
                                <th className="px-3 py-2.5 font-medium w-12 text-center">{t('editor.colNumber')}</th>
                                <th className="px-3 py-2.5 font-medium">{t('editor.colBlinds')}</th>
                                <th className="px-3 py-2.5 font-medium w-32">{t('editor.colAnte')}</th>
                                <th className="px-3 py-2.5 font-medium w-32">{t('editor.colDuration')}</th>
                                <th className="px-3 py-2.5 font-medium w-20 text-center">{t('common.actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {levels.map((lvl, idx) => (
                                <tr
                                    key={lvl._key}
                                    className={`hover:bg-surface-sunken transition-colors ${lvl.isBreak ? 'bg-surface-raised' : ''} ${draggedItemIndex === idx ? 'opacity-50' : ''}`}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, idx)}
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDrop(e, idx)}
                                    onDragEnd={handleDragEnd}
                                >
                                    <td className="px-3 py-2 text-center cursor-move text-ink-faint hover:text-ink-muted">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                        </svg>
                                    </td>
                                    <td className="px-3 py-2 text-center text-ink-muted tabular">{idx + 1}</td>
                                    <td className="px-3 py-2">
                                        {lvl.isBreak ? (
                                            <div className="flex items-center justify-center bg-surface border border-dashed border-line rounded py-1.5">
                                                <span className="text-ink-muted text-xs uppercase tracking-wider">{t('editor.breakTime')}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    value={lvl.smallBlind}
                                                    onChange={(e) => handleUpdateLevel(idx, 'smallBlind', Number(e.target.value))}
                                                    className={cellInputClass}
                                                />
                                                <span className="text-ink-faint">/</span>
                                                <input
                                                    type="number"
                                                    value={lvl.bigBlind}
                                                    onChange={(e) => handleUpdateLevel(idx, 'bigBlind', Number(e.target.value))}
                                                    className={cellInputClass}
                                                />
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        {!lvl.isBreak && (
                                            <input
                                                type="number"
                                                value={lvl.ante}
                                                onChange={(e) => handleUpdateLevel(idx, 'ante', Number(e.target.value))}
                                                className={cellInputClass}
                                            />
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={lvl.duration}
                                                onChange={(e) => handleUpdateLevel(idx, 'duration', Number(e.target.value))}
                                                className={`${cellInputClass} pr-8`}
                                            />
                                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint text-xs">{t('editor.minutesShort')}</span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <button
                                            onClick={() => handleRemoveLevel(idx)}
                                            className="text-ink-muted hover:text-danger text-xs font-medium transition-colors"
                                            title={t('editor.removeLevelTitle')}
                                        >
                                            {t('editor.removeLevel')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {levels.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="py-10 text-center text-sm text-ink-muted">
                                        {t('editor.startByAdding')}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="grid grid-cols-2 gap-2 p-4 border-t border-line">
                    <button
                        onClick={handleAddLevel}
                        className="bg-surface border border-line text-ink py-2.5 rounded text-sm font-medium hover:bg-surface-sunken transition-colors"
                    >
                        {t('editor.addLevel')}
                    </button>
                    <button
                        onClick={handleAddBreak}
                        className="bg-surface border border-line text-ink py-2.5 rounded text-sm font-medium hover:bg-surface-sunken transition-colors"
                    >
                        {t('editor.addBreak')}
                    </button>
                </div>
            </div>

            <div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-line px-6 py-3 flex justify-end items-center gap-2 z-50">
                {notice && (
                    <span className={`text-xs mr-auto ${notice.kind === 'error' ? 'text-danger' : 'text-accent'}`}>
                        {notice.text}
                    </span>
                )}
                <button
                    onClick={onClose}
                    className="px-4 py-2 rounded border border-line bg-surface text-ink text-sm font-medium hover:bg-surface-sunken transition-colors"
                >
                    {t('common.close')}
                </button>
                <button
                    onClick={onSave}
                    className="px-4 py-2 rounded border border-line bg-surface text-ink text-sm font-medium hover:bg-surface-sunken transition-colors"
                >
                    {t('common.save')}
                </button>
                <button
                    onClick={onSaveAndClose}
                    className="px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:bg-accent-600 transition-colors"
                >
                    {t('editor.saveAndClose')}
                </button>
            </div>
        </div>
    );
};

export default StructureEditor;
