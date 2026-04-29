/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
        './src/components/**/*.{js,ts,jsx,tsx,mdx}',
        './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                vd: {
                    bg: {
                        primary: 'rgb(var(--vd-bg-primary) / <alpha-value>)',
                        secondary: 'rgb(var(--vd-bg-secondary) / <alpha-value>)',
                        tertiary: 'rgb(var(--vd-bg-tertiary) / <alpha-value>)',
                        hover: 'rgb(var(--vd-bg-hover) / <alpha-value>)',
                        input: 'rgb(var(--vd-bg-input) / <alpha-value>)',
                    },
                    accent: {
                        gold: '#F5B97F',
                        'gold-light': '#F9D0A3',
                        'gold-dim': '#D09558',
                        'gold-muted': 'rgba(245, 185, 127, 0.12)',
                        'gold-glow': 'rgba(245, 185, 127, 0.25)',
                    },
                    text: {
                        primary: 'rgb(var(--vd-text-primary) / <alpha-value>)',
                        secondary: 'rgb(var(--vd-text-secondary) / <alpha-value>)',
                        tertiary: 'rgb(var(--vd-text-tertiary) / <alpha-value>)',
                        inverse: 'rgb(var(--vd-text-inverse) / <alpha-value>)',
                    },
                    border: {
                        DEFAULT: 'rgb(var(--vd-border) / <alpha-value>)',
                        light: 'rgb(var(--vd-border-light) / <alpha-value>)',
                        focus: '#F5B97F',
                    },
                    status: {
                        success: '#34D399',
                        error: '#F87171',
                        warning: '#FBBF24',
                        info: '#60A5FA',
                    },
                },
            },
            fontFamily: {
                sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'sans-serif'],
            },
            borderRadius: {
                card: '10px',
                panel: '14px',
                modal: '18px',
            },
            backgroundImage: {
                'gold-gradient': 'linear-gradient(135deg, #F5B97F 0%, #F9D0A3 50%, #F5B97F 100%)',
                'gold-gradient-hover': 'linear-gradient(135deg, #F9D0A3 0%, #FCE0BE 50%, #F9D0A3 100%)',
            },
            boxShadow: {
                'gold-sm': '0 2px 8px rgba(245, 185, 127, 0.15)',
                'gold-md': '0 4px 16px rgba(245, 185, 127, 0.2)',
                'gold-lg': '0 8px 32px rgba(245, 185, 127, 0.25)',
                'card': '0 1px 3px rgba(0, 0, 0, 0.4)',
                'card-hover': '0 4px 16px rgba(0, 0, 0, 0.5)',
                'panel': '0 8px 32px rgba(0, 0, 0, 0.6)',
            },
        },
    },
    plugins: [],
};
