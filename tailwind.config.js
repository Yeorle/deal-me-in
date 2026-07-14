/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                accent: {
                    50: 'var(--color-accent-50)',
                    100: 'var(--color-accent-100)',
                    200: 'var(--color-accent-200)',
                    DEFAULT: 'var(--color-accent-500)',
                    600: 'var(--color-accent-600)',
                    700: 'var(--color-accent-700)',
                },
                ink: {
                    DEFAULT: '#1a1a1a',
                    soft: '#3d3d3d',
                    muted: '#6b6b6b',
                    faint: '#9a9a9a',
                },
                line: {
                    DEFAULT: '#ebebeb',
                    soft: '#f0f0f0',
                    strong: '#dcdcdc',
                },
                surface: {
                    DEFAULT: '#ffffff',
                    sunken: '#f5f5f5',
                    raised: '#fafafa',
                    muted: '#ebebeb',
                },
                danger: {
                    DEFAULT: '#a04545',
                    soft: '#f4e7e7',
                },
            },
            fontFamily: {
                sans: ['"DM Sans"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
            },
            fontSize: {
                'micro': ['11px', { lineHeight: '16px', letterSpacing: '0.04em' }],
            },
            borderRadius: {
                DEFAULT: '4px',
            },
        },
    },
    plugins: [],
}
