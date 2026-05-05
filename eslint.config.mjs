// AD-217: ESLint flat config — `next lint` was deprecated in Next 16, so we
// run ESLint directly via `npm run lint` (`eslint .`) and keep the
// next/core-web-vitals + next/typescript rule set as the baseline.
//
// The override block below relaxes a few rules that fire heavily on
// pre-existing code so CI starts green; tightening them back is its own
// follow-up ticket. Genuine future regressions still show up because the
// lint stage now actually runs in CI (was a stub before this branch).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextCoreWebVitals = require('eslint-config-next/core-web-vitals');
const nextTypescript = require('eslint-config-next/typescript');

export default [
    {
        ignores: [
            '.next/**',
            'node_modules/**',
            'public/**',
            'coverage/**',
            '.adhdev/**',
        ],
    },
    ...nextCoreWebVitals,
    ...nextTypescript,
    {
        rules: {
            // Pre-existing `setState` inside effect-body — pattern is in many
            // components; treat as warn so CI doesn't fail until the cleanup
            // ticket lands.
            'react-hooks/set-state-in-effect': 'warn',
            'react-hooks/immutability': 'warn',
            'react-hooks/refs': 'warn',
            // Apostrophes in JSX copy. Treat as warn.
            'react/no-unescaped-entities': 'warn',
            // `any` is used in a few legacy spots; warn rather than fail.
            '@typescript-eslint/no-explicit-any': 'warn',
            // Underscore-prefixed unused bindings are intentional placeholders.
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                destructuredArrayIgnorePattern: '^_',
            }],
        },
    },
];
