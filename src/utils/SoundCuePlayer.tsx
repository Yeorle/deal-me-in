import { useEffect, useRef } from 'react';
import levelWarning from '../assets/sounds/level-warning.mp3';
import levelStart from '../assets/sounds/level-start.mp3';
import breakStart from '../assets/sounds/break-start.mp3';
import eliminate from '../assets/sounds/eliminate.mp3';

// Maps the `sound-cue` payloads emitted by the main process (see
// TournamentManager.emitSoundCue) to their audio files.
const CUE_SOURCES: Record<string, string> = {
    'level-warning': levelWarning,
    'level-start': levelStart,
    'break-start': breakStart,
    'eliminate': eliminate,
};

/**
 * Plays tournament sound effects. The main process sends `sound-cue` to a single
 * window (the main control window), so mounting this once at the app root is
 * enough — it never double-plays across windows.
 */
const SoundCuePlayer: React.FC = () => {
    // Cache one Audio element per cue so the file is fetched/decoded once.
    const audioCache = useRef<Record<string, HTMLAudioElement>>({});

    useEffect(() => {
        const unsubscribe = window.api.onSoundCue((cue: string) => {
            const src = CUE_SOURCES[cue];
            if (!src) return;

            let audio = audioCache.current[cue];
            if (!audio) {
                audio = new Audio(src);
                audioCache.current[cue] = audio;
            }
            audio.currentTime = 0;
            // Autoplay can reject (e.g. empty placeholder file, or before any
            // user gesture); swallow it so a missing sound never breaks the app.
            audio.play().catch(() => { /* no-op */ });
        });

        return unsubscribe;
    }, []);

    return null;
};

export default SoundCuePlayer;
