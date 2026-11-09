import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globalSetup: ['./global-setup.ts'], testTimeout: 60_000, hookTimeout: 600_000, fileParallelism: false, reporters: ['verbose'] } });
