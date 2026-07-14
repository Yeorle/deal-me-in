import React from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import PlayerManagement from './components/PlayerManagement';
import PlayerProfile from './components/PlayerProfile';
import StructureEditor from './components/StructureEditor';
import StructureList from './components/StructureList';
import ControlPanel from './components/ControlPanel';
import TournamentHistory from './components/TournamentHistory';
import TournamentResultsView from './components/TournamentResultsView';
import ProjectorView from './components/ProjectorView';
import ProjectorDesigner from './components/ProjectorDesigner';
import Settings from './components/Settings';
import SoundCuePlayer from './utils/SoundCuePlayer';
import { SettingsProvider } from './i18n/SettingsContext';
import { useSettings } from './i18n/useSettings';
import './App.css';

const navLinkClass = (active: boolean) =>
    `px-3 py-2 rounded text-sm transition-colors ${
        active
            ? 'bg-accent text-white'
            : 'text-ink hover:bg-line-soft'
    }`;

const AppContent: React.FC = () => {
    const location = useLocation();
    const { t } = useSettings();
    const isStructureEditor = location.pathname === '/structure-editor' || location.pathname.includes('structure-editor');
    const isProjector = location.pathname === '/projector';

    return (
        <div className="flex h-screen bg-surface-sunken text-ink font-sans">
            {!isStructureEditor && !isProjector && (
                <nav className="w-56 bg-surface border-r border-line flex flex-col">
                    <div className="px-5 py-6 border-b border-line">
                        <h1 className="text-base font-semibold tracking-tight">{t('nav.appName')}</h1>
                    </div>

                    <div className="flex flex-col gap-1 p-3">
                        <Link to="/" className={navLinkClass(location.pathname === '/')}>
                            {t('nav.controlPanel')}
                        </Link>
                        <Link to="/players" className={navLinkClass(location.pathname.startsWith('/players'))}>
                            {t('nav.players')}
                        </Link>
                        <Link to="/history" className={navLinkClass(location.pathname.startsWith('/history'))}>
                            {t('nav.history')}
                        </Link>
                        <Link to="/structure" className={navLinkClass(location.pathname === '/structure')}>
                            {t('nav.structure')}
                        </Link>
                        <Link to="/settings" className={navLinkClass(location.pathname === '/settings')}>
                            {t('nav.settings')}
                        </Link>
                        <Link to="/projector-designer" className={navLinkClass(location.pathname === '/projector-designer')}>
                            {t('nav.projectorDesigner')}
                        </Link>
                    </div>

                    <div className="mt-auto px-5 py-4 border-t border-line text-xs text-ink-faint">
                        v{__APP_VERSION__}
                    </div>
                </nav>
            )}

            <main className="flex-1 overflow-auto bg-surface-sunken text-ink relative">
                <Routes>
                    <Route path="/" element={<ControlPanel />} />
                    <Route path="/players" element={<PlayerManagement />} />
                    <Route path="/players/:id" element={<PlayerProfile />} />
                    <Route path="/history" element={<TournamentHistory />} />
                    <Route path="/history/:id" element={<TournamentResultsView />} />
                    <Route path="/structure" element={<StructureList />} />
                    <Route path="/structure-editor" element={<StructureEditor />} />
                    <Route path="/projector" element={<ProjectorView />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/projector-designer" element={<ProjectorDesigner />} />
                </Routes>
            </main>
        </div>
    );
};

const App: React.FC = () => {
    return (
        <SettingsProvider>
            <SoundCuePlayer />
            <HashRouter>
                <AppContent />
            </HashRouter>
        </SettingsProvider>
    );
};

export default App;
