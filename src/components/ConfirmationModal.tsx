import React, { useState, useEffect, useId, useRef } from 'react';
import { useSettings } from '../i18n/useSettings';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    checkboxLabel?: string;
    confirmButtonText: string;
    isDestructive?: boolean;
    // Optional failure text shown in place of nothing when the confirmed
    // action rejects — keeps the modal open for a retry.
    error?: string | null;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    checkboxLabel,
    confirmButtonText,
    isDestructive = false,
    error = null
}) => {
    const { t } = useSettings();
    const [hasConfirmed, setHasConfirmed] = useState(false);
    const titleId = useId();
    const checkboxId = useId();
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            setHasConfirmed(false);
            panelRef.current?.focus();
        }
    }, [isOpen]);

    // Escape closes the dialog for keyboard users.
    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const disabled = checkboxLabel ? !hasConfirmed : false;

    return (
        <div className="fixed inset-0 bg-ink/30 flex items-center justify-center p-4 z-50">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                ref={panelRef}
                tabIndex={-1}
                className="bg-surface rounded p-6 max-w-sm w-full border border-line text-left outline-none"
            >
                <h3 id={titleId} className="text-base font-semibold mb-3 text-ink">{title}</h3>
                <p className="text-sm text-ink-soft mb-5">
                    {message}
                </p>

                {checkboxLabel && (
                    <label htmlFor={checkboxId} className="flex items-center gap-2 mb-5 text-sm text-ink-soft select-none cursor-pointer">
                        <input
                            type="checkbox"
                            id={checkboxId}
                            checked={hasConfirmed}
                            onChange={(e) => setHasConfirmed(e.target.checked)}
                            className="w-4 h-4 accent-accent"
                        />
                        {checkboxLabel}
                    </label>
                )}

                {error && <p className="text-xs text-danger mb-4">{error}</p>}

                <div className="flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded border border-line bg-surface text-ink text-sm font-medium hover:bg-surface-sunken transition-colors"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={disabled}
                        className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                            disabled
                                ? 'bg-line text-ink-faint cursor-not-allowed'
                                : isDestructive
                                    ? 'bg-surface border border-line text-danger hover:bg-danger-soft'
                                    : 'bg-accent text-white hover:bg-accent-600'
                        }`}
                    >
                        {confirmButtonText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
