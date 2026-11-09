import { EnvValidationError, validateEnv, type Env } from './config/env';
import { loadEnvFiles } from './config/load-env';

/**
 * Loads `.env` files and validates configuration before Nest starts. On invalid config it prints
 * a readable message and exits with code 1 (fail fast, OPS-10).
 */
export function bootstrapEnv(processName: string): Env {
  loadEnvFiles();
  try {
    return validateEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`[${processName}] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
