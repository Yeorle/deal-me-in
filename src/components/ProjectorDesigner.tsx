import React from 'react';
import { useSettings } from '../i18n/useSettings';
import { ProjectorTheme } from '../types';
import { mediaUrl } from '../utils/media';
import logo from '../assets/logo.png';

const fileInputClass =
    'block w-full text-sm text-ink-soft file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-line file:text-xs file:font-medium file:bg-surface file:text-ink hover:file:bg-surface-sunken file:transition-colors file:cursor-pointer';

const labelClass = 'block text-micro uppercase text-ink-muted mb-1.5';

const Toggle: React.FC<{ on: boolean; onChange: (value: boolean) => void }> = ({ on, onChange }) => (
    <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-line-strong'}`}
    >
        <span
            className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                on ? 'translate-x-4' : 'translate-x-0'
            }`}
        />
    </button>
);

const ProjectorDesigner: React.FC = () => {
    const { t, projector, setProjectorTheme } = useSettings();

    const update = (patch: Partial<ProjectorTheme>) => {
        setProjectorTheme({ ...projector, ...patch });
    };

    const handleImagePick = async (
        e: React.ChangeEvent<HTMLInputElement>,
        kind: 'background' | 'logo',
    ) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const sourcePath = window.api.getPathForFile(file);
        if (!sourcePath) return;
        const importedPath = await window.api.importProjectorImage(sourcePath);
        if (kind === 'background') {
            update({ backgroundImage: importedPath, backgroundType: 'image' });
        } else {
            update({ logoPath: importedPath });
        }
    };

    const previewBackground = projector.backgroundType === 'image' && projector.backgroundImage
        ? `center / cover no-repeat url("${mediaUrl(projector.backgroundImage)}")`
        : projector.backgroundColor;
    const previewLogo = projector.logoPath ? mediaUrl(projector.logoPath) : logo;
    const mutedColor = `color-mix(in srgb, ${projector.textColor} 60%, transparent)`;

    const previewTextStyle: React.CSSProperties = {};
    if (projector.textShadow) {
        previewTextStyle.textShadow = `0 0 ${projector.textShadowBlur}px ${projector.textShadowColor}`;
    }
    if (projector.textOutline) {
        previewTextStyle.WebkitTextStroke = `${projector.textOutlineWidth}px ${projector.textOutlineColor}`;
        previewTextStyle.paintOrder = 'stroke fill';
    }

    const backgroundTypes: { value: ProjectorTheme['backgroundType']; label: string }[] = [
        { value: 'color', label: t('projectorDesigner.typeColor') },
        { value: 'image', label: t('projectorDesigner.typeImage') },
    ];

    return (
        <div className="px-10 py-10 w-full max-w-3xl mx-auto">
            <h2 className="text-xl font-semibold tracking-tight mb-8">{t('projectorDesigner.title')}</h2>

            {/* Background */}
            <section className="bg-surface border border-line rounded p-5 mb-5">
                <h3 className="text-sm font-medium text-ink mb-1">{t('projectorDesigner.background')}</h3>
                <p className="text-xs text-ink-muted mb-4">{t('projectorDesigner.backgroundDesc')}</p>

                <div className="flex flex-wrap gap-2 mb-4">
                    {backgroundTypes.map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => update({ backgroundType: opt.value })}
                            className={`px-4 py-2 rounded text-sm font-medium border transition-colors ${
                                projector.backgroundType === opt.value
                                    ? 'bg-accent text-white border-accent'
                                    : 'bg-surface text-ink border-line hover:bg-surface-sunken'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>

                {projector.backgroundType === 'color' ? (
                    <div>
                        <label className={labelClass}>{t('projectorDesigner.backgroundColor')}</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                value={projector.backgroundColor}
                                onChange={e => update({ backgroundColor: e.target.value })}
                                className="h-9 w-14 rounded border border-line bg-surface cursor-pointer p-0.5"
                            />
                            <span className="text-sm text-ink-muted tabular uppercase">{projector.backgroundColor}</span>
                        </div>
                    </div>
                ) : (
                    <div>
                        <label className={labelClass}>{t('projectorDesigner.backgroundImage')}</label>
                        <div className="flex items-center gap-4">
                            <input
                                type="file"
                                accept="image/*"
                                onChange={e => handleImagePick(e, 'background')}
                                className={fileInputClass}
                            />
                            {projector.backgroundImage && (
                                <img
                                    src={mediaUrl(projector.backgroundImage)}
                                    alt=""
                                    className="h-12 w-20 shrink-0 object-cover rounded border border-line"
                                />
                            )}
                        </div>
                    </div>
                )}
            </section>

            {/* Text color */}
            <section className="bg-surface border border-line rounded p-5 mb-5">
                <h3 className="text-sm font-medium text-ink mb-1">{t('projectorDesigner.textColor')}</h3>
                <p className="text-xs text-ink-muted mb-4">{t('projectorDesigner.textColorDesc')}</p>
                <div className="flex items-center gap-3">
                    <input
                        type="color"
                        value={projector.textColor}
                        onChange={e => update({ textColor: e.target.value })}
                        className="h-9 w-14 rounded border border-line bg-surface cursor-pointer p-0.5"
                    />
                    <span className="text-sm text-ink-muted tabular uppercase">{projector.textColor}</span>
                </div>
            </section>

            {/* Logo */}
            <section className="bg-surface border border-line rounded p-5 mb-5">
                <h3 className="text-sm font-medium text-ink mb-1">{t('projectorDesigner.logo')}</h3>
                <p className="text-xs text-ink-muted mb-4">{t('projectorDesigner.logoDesc')}</p>
                <div className="flex items-center gap-4">
                    <img
                        src={previewLogo}
                        alt="Logo"
                        className="h-12 w-12 shrink-0 object-contain rounded border border-line bg-surface-sunken"
                    />
                    <input
                        type="file"
                        accept="image/*"
                        onChange={e => handleImagePick(e, 'logo')}
                        className={fileInputClass}
                    />
                    {projector.logoPath && (
                        <button
                            onClick={() => update({ logoPath: null })}
                            className="shrink-0 px-3 py-1.5 rounded text-xs font-medium border border-line bg-surface text-ink hover:bg-surface-sunken transition-colors"
                        >
                            {t('projectorDesigner.resetLogo')}
                        </button>
                    )}
                </div>
            </section>

            {/* Text shadow */}
            <section className="bg-surface border border-line rounded p-5 mb-5">
                <div className="flex items-start justify-between gap-4 mb-1">
                    <h3 className="text-sm font-medium text-ink">{t('projectorDesigner.textShadow')}</h3>
                    <Toggle on={projector.textShadow} onChange={v => update({ textShadow: v })} />
                </div>
                <p className="text-xs text-ink-muted mb-4">{t('projectorDesigner.textShadowDesc')}</p>
                {projector.textShadow && (
                    <div className="flex flex-wrap items-end gap-6">
                        <div>
                            <label className={labelClass}>{t('projectorDesigner.color')}</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="color"
                                    value={projector.textShadowColor}
                                    onChange={e => update({ textShadowColor: e.target.value })}
                                    className="h-9 w-14 rounded border border-line bg-surface cursor-pointer p-0.5"
                                />
                                <span className="text-sm text-ink-muted tabular uppercase">{projector.textShadowColor}</span>
                            </div>
                        </div>
                        <div className="flex-1 min-w-[12rem]">
                            <label className={labelClass}>{t('projectorDesigner.strength')} — {projector.textShadowBlur}px</label>
                            <input
                                type="range"
                                min={0}
                                max={40}
                                step={1}
                                value={projector.textShadowBlur}
                                onChange={e => update({ textShadowBlur: Number(e.target.value) })}
                                className="w-full accent-accent cursor-pointer"
                            />
                        </div>
                    </div>
                )}
            </section>

            {/* Text outline */}
            <section className="bg-surface border border-line rounded p-5 mb-5">
                <div className="flex items-start justify-between gap-4 mb-1">
                    <h3 className="text-sm font-medium text-ink">{t('projectorDesigner.textOutline')}</h3>
                    <Toggle on={projector.textOutline} onChange={v => update({ textOutline: v })} />
                </div>
                <p className="text-xs text-ink-muted mb-4">{t('projectorDesigner.textOutlineDesc')}</p>
                {projector.textOutline && (
                    <div className="flex flex-wrap items-end gap-6">
                        <div>
                            <label className={labelClass}>{t('projectorDesigner.color')}</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="color"
                                    value={projector.textOutlineColor}
                                    onChange={e => update({ textOutlineColor: e.target.value })}
                                    className="h-9 w-14 rounded border border-line bg-surface cursor-pointer p-0.5"
                                />
                                <span className="text-sm text-ink-muted tabular uppercase">{projector.textOutlineColor}</span>
                            </div>
                        </div>
                        <div className="flex-1 min-w-[12rem]">
                            <label className={labelClass}>{t('projectorDesigner.width')} — {projector.textOutlineWidth}px</label>
                            <input
                                type="range"
                                min={0}
                                max={10}
                                step={0.5}
                                value={projector.textOutlineWidth}
                                onChange={e => update({ textOutlineWidth: Number(e.target.value) })}
                                className="w-full accent-accent cursor-pointer"
                            />
                        </div>
                    </div>
                )}
            </section>

            {/* Live preview */}
            <section className="bg-surface border border-line rounded p-5">
                <h3 className="text-sm font-medium text-ink mb-1">{t('projectorDesigner.preview')}</h3>
                <p className="text-xs text-ink-muted mb-4">{t('projectorDesigner.previewDesc')}</p>
                <div className="rounded border border-line overflow-hidden">
                    <div
                        className="aspect-video w-full flex items-center justify-between px-8"
                        style={{ background: previewBackground, color: projector.textColor }}
                    >
                        <img src={previewLogo} alt="Logo" className="h-16 w-16 object-contain" />
                        <div className="flex flex-col items-center">
                            <div
                                className="text-xs uppercase tracking-[0.25em] mb-1"
                                style={{ color: mutedColor, ...previewTextStyle }}
                            >
                                {t('projector.level')} 4
                            </div>
                            <div className="text-5xl font-medium tabular leading-none" style={previewTextStyle}>12:34</div>
                            <div
                                className="text-xs uppercase tracking-[0.25em] mt-2"
                                style={{ color: mutedColor, ...previewTextStyle }}
                            >
                                {t('projector.smallBlind')} 100 / 200
                            </div>
                        </div>
                        <div className="h-16 w-16" />
                    </div>
                </div>
            </section>
        </div>
    );
};

export default ProjectorDesigner;
