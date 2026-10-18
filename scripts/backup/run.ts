import { runBackup } from './backup';

runBackup().then((result) => {
  console.log(`Database backup uploaded: ${result.key}`);
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Database backup failed');
  process.exitCode = 1;
});
