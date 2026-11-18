import type { Context } from 'hono';
import { LoggerMiddleware } from 'hono/logger';

/**
 * Structured logging middleware for the Paw API (Req 9, Task 49)
 *
 * Logs in JSON format with the following fields:
 * - timestamp (ISO 8601)
 * - method (GET, POST, etc.)
 * - path (request URI path)
 * - status (HTTP status code)
 * - duration (ms)
 * - modelCall (boolean: whether this request made a model call)
 *
 * Never logs:
 * - wish text or curse content (Req 9.2)
 * - IP address (Req 9.2)
 * - full prompt or model response (Req 6.5)
 * - API key or any secret (Req 6.5)
 */

interface LogEntry {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  modelCall: boolean;
}

export function createStructuredLogger(): LoggerMiddleware {
  return async (message: string, next) => {
    const startTime = Date.now();

    // Mark that a model call will happen if this is grant or bind
    const hasModelCall = message.includes('/api/grant') || message.includes('/api/bind');

    try {
      await next();
    } finally {
      const duration = Date.now() - startTime;

      // Parse the Hono logger message to extract relevant info
      // Hono logger format: "method path status duration"
      const parts = message.split(' ');
      const method = parts[0] || 'UNKNOWN';
      const path = parts[1] || '/';
      const status = parseInt(parts[2] || '0', 10);

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        method,
        path,
        status,
        duration,
        modelCall: hasModelCall,
      };

      // In production, only log at INFO level or if there's an error
      if (status >= 400 || process.env.NODE_ENV === 'development') {
        console.log(JSON.stringify(logEntry));
      }
    }
  };
}

/**
 * Attach model-call metadata to a request context so the logger can track it.
 * (Task 50)
 */
export function markModelCallInContext(c: Context): void {
  c.set('modelCall', true);
}
