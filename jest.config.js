/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testPathIgnorePatterns: [
    '<rootDir>/__tests__/helpers/',
    '<rootDir>/__tests__/e2e/',        // Playwright — girano via `npm run test:e2e`
    '<rootDir>/__tests__/e2e-local/',  // Playwright locale
  ],
  moduleNameMapper: {
    // Match tsconfig.json paths: "@/*" → project root. Previously this was
    // "<rootDir>/app/$1" which silently masked any test that pulled in a
    // component using "@/lib/…" (e.g. Button → @/lib/utils).
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        module: 'commonjs',
        moduleResolution: 'node',
        resolveJsonModule: true,
        allowJs: true,
        noEmit: true,
        strict: false,
      },
    }],
  },
};
