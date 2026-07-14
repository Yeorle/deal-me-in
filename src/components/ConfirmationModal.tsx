import React, { useState, useEffect } from 'react';
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
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    checkboxLabel,
    confirmButtonText,
    isDestructive = false
}) => {
    const { t } = useSettings();
    const [hasConfirmed, setHasConfirmed] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setHasConfirmed(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const disabled = checkboxLabel ? !hasConfirmed : false;

    return (
        <div className="fixed inset-0 bg-ink/30 flex items-center justify-center p-4 z-50">
            <div className="bg-surface rounded p-6 max-w-sm w-full border border-line text-left">
                <h3 className="text-base font-semibold mb-3 text-ink">{title}</h3>
                <p className="text-sm text-ink-soft mb-5">
                    {message}
                </p>

                {checkboxLabel && (
                    <label htmlFor="confirmationCheckbox" className="flex items-center gap-2 mb-5 text-sm text-ink-soft select-none cursor-pointer">
                        <input
                            type="checkbox"
                            id="confirmationCheckbox"
                            checked={hasConfirmed}
                            onChange={(e) => setHasConfirmed(e.target.checked)}
                            className="w-4 h-4 accent-accent"
                        />
                        {checkboxLabel}
                    </label>
                )}

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
