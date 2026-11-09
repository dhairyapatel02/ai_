import { Logger } from '@nestjs/common';

// Deterministic dates: period math in GenerateService uses server-local time (BUG-06).
process.env.TZ = 'UTC';

// Keep test output readable; assertions cover behaviour, not log lines.
Logger.overrideLogger(false);
