import { AccentName } from '../types';

export interface AccentPalette {
    50: string;
    100: string;
    200: string;
    500: string;
    600: string;
    700: string;
}

export const accentPalettes: Record<AccentName, AccentPalette> = {
    moss: {
        50: '#f3f5ec',
        100: '#e6ead4',
        200: '#cdd4a9',
        500: '#7e8c54',
        600: '#6e7c47',
        700: '#5a6539',
    },
    slate: {
        50: '#eef2f6',
        100: '#d9e2ec',
        200: '#bcccdc',
        500: '#486581',
        600: '#3d566b',
        700: '#2d4054',
    },
    terracotta: {
        50: '#fbf2ee',
        100: '#f5d9c8',
        200: '#ecbb9f',
        500: '#b66a40',
        600: '#9c5732',
        700: '#7a4321',
    },
    plum: {
        50: '#f4eef4',
        100: '#e2cee2',
        200: '#c89dc8',
        500: '#7a4f7a',
        600: '#66416a',
        700: '#4d3050',
    },
    charcoal: {
        50: '#f0f0f1',
        100: '#d8d8db',
        200: '#b0b0b6',
        500: '#4a4a52',
        600: '#3a3a40',
        700: '#2a2a30',
    },
};

export function applyAccent(name: AccentName) {
    const palette = accentPalettes[name];
    const root = document.documentElement;
    root.style.setProperty('--color-accent-50', palette[50]);
    root.style.setProperty('--color-accent-100', palette[100]);
    root.style.setProperty('--color-accent-200', palette[200]);
    root.style.setProperty('--color-accent-500', palette[500]);
    root.style.setProperty('--color-accent-600', palette[600]);
    root.style.setProperty('--color-accent-700', palette[700]);
}
