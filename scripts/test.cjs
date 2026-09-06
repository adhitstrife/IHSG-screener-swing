const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const compile = spawnSync(process.execPath, [
  require.resolve('typescript/bin/tsc'), '--outDir', '.test-build', '--module', 'commonjs',
  '--target', 'es2022', '--skipLibCheck', '--strict', '--esModuleInterop',
  'src/types/pdf-parse-worker.d.ts', 'src/lib/market-data.ts', 'src/lib/swing-strategy.ts', 'src/lib/swing-backtest.ts', 'src/lib/screener.ts', 'src/lib/yahoo-finance.ts', 'src/lib/yahoo-data.ts', 'src/lib/stock-analysis.ts', 'src/lib/screener-storage.ts', 'src/lib/dividend-parser.ts', 'src/lib/dividend-source.ts', 'src/lib/dividend-storage.ts',
], { cwd: root, stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);
const tests = spawnSync(process.execPath, ['--test', 'tests/swing.test.cjs', 'tests/provider.test.cjs', 'tests/analysis.test.cjs', 'tests/yahoo.test.cjs', 'tests/universe.test.cjs', 'tests/storage.test.cjs', 'tests/pages.test.cjs', 'tests/dividends.test.cjs'], { cwd: root, stdio: 'inherit' });
process.exit(tests.status ?? 1);



