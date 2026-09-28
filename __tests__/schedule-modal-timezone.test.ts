// ScheduleModal con il telefono fuori dall'ora italiana (fase 1b).
// process.env.TZ dentro jest non cambia il fuso del processo (l'ambiente di
// test ne ha una copia): per riprodurre davvero un utente a Lisbona si lancia
// la suite in __tests__/helpers/schedule-modal-timezone.inner.tsx in un
// processo figlio con TZ=Europe/Lisbon. (helpers/ è escluso dalla run normale.)
import { spawnSync } from 'child_process';
import path from 'path';

jest.setTimeout(120_000);

test('weekly/monthly rules and times follow Rome for a phone set to Europe/Lisbon', () => {
  const root = path.resolve(__dirname, '..');
  const jestBin = require.resolve('jest/bin/jest');
  const r = spawnSync(process.execPath, [
    jestBin,
    '--testPathIgnorePatterns', '/e2e/',
    '--runTestsByPath', path.join('__tests__', 'helpers', 'schedule-modal-timezone.inner.tsx'),
  ], { cwd: root, env: { ...process.env, TZ: 'Europe/Lisbon' }, encoding: 'utf8' });
  const out = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0) throw new Error(out.slice(-4000));
  expect(out).toMatch(/Tests:\s+3 passed, 3 total/);
});
