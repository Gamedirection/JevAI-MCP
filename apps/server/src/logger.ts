import { type LogComponent, type LogLevel, redactValue } from "@jevai/shared";
import type { LogRepository } from "@jevai/database";

export interface Logger {
   debug(message: string, context?: Record<string, unknown>): void;
   info(message: string, context?: Record<string, unknown>): void;
   warn(message: string, context?: Record<string, unknown>): void;
   error(message: string, context?: Record<string, unknown>): void;
   setLevel(level: LogLevel): void;
   getLevel(): LogLevel;
}

export const LEVEL_WEIGHT: Record<LogLevel, number> = {
   debug: 10,
   info: 20,
   warn: 30,
   error: 40,
};

interface BufferedEntry {
   timestamp: string;
   level: LogLevel;
   component: LogComponent;
   message: string;
   context: Record<string, unknown> | null;
}

export class BufferedLogSink {
   private buffer: BufferedEntry[] = [];
   private timer: NodeJS.Timeout | undefined;
   writesBlocked = false;

   constructor(
      private readonly logs: LogRepository,
      private readonly flushIntervalMs = 1_000,
      ) {}

   write(
      level: LogLevel,
      component: LogComponent,
      message: string,
      context?: Record<string, unknown>,
    ): void {
      if (this.writesBlocked) return;
      if (this.buffer.length >= 500) this.flush();
      this.buffer.push({
         timestamp: new Date().toISOString(),
         level,
         component,
         message,
         context: context ? redactValue(context) : null,
            });
      if (!this.timer) {
         this.timer = setTimeout(() => {
               this.timer = undefined;
               this.flush();
                   }, this.flushIntervalMs);
         this.timer.unref?.();
             }
         }

   flush(): void {
      if (this.buffer.length === 0) return;
      const batch = this.buffer;
      this.buffer = [];
      this.writesBlocked = true;
      try {
               this.logs.insertMany(batch);
                  } catch {
          // never let log persistence crash the service
                  } finally {
         this.writesBlocked = false;
             }
          }

   close(): void {
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      this.flush();
        }
}

class SinkLogger implements Logger {
   private level: LogLevel;

   constructor(
      private readonly component: LogComponent,
      level: LogLevel,
      private readonly sink: BufferedLogSink | null,
      private readonly consoleEnabled: boolean,
       ) {
      this.level = level;
         }

   private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
      if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return;
      const safeContext = context ? redactValue(context) : undefined;
      if (this.consoleEnabled) {
         const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} [${this.component}] ${message}`;
         const method = level === "debug" ? "debug" : level === "info" ? "log" : level;
                  console[method](line, safeContext ?? "");
             }
      this.sink?.write(level, this.component, message, safeContext);
         }

   debug(message: string, context?: Record<string, unknown>): void { this.log("debug", message, context); }
   info(message: string, context?: Record<string, unknown>): void { this.log("info", message, context); }
   warn(message: string, context?: Record<string, unknown>): void { this.log("warn", message, context); }
   error(message: string, context?: Record<string, unknown>): void { this.log("error", message, context); }

   setLevel(level: LogLevel): void { this.level = level; }
   getLevel(): LogLevel { return this.level; }
}

export interface LoggerFactory {
   get(component: LogComponent): Logger;
   setLevel(level: LogLevel): void;
   close(): void;
   sink: BufferedLogSink | null;
}

export function createLoggerFactory(
   initialLevel: LogLevel,
   logs: LogRepository | null,
   options: { console?: boolean; db?: boolean } = {},
): LoggerFactory {
   const consoleEnabled = options.console ?? true;
   const sink = options.db === false || !logs ? null : new BufferedLogSink(logs);
   const loggers = new Map<LogComponent, SinkLogger>();

   return {
      sink,
      get(component: LogComponent): Logger {
         let logger = loggers.get(component);
         if (!logger) {
                  logger = new SinkLogger(component, initialLevel, sink, consoleEnabled);
                  loggers.set(component, logger);
                     }
         return logger;
             },
      setLevel(level: LogLevel): void {
         for (const logger of loggers.values()) logger.setLevel(level);
             },
      close(): void {
         sink?.close();
             },
        };
}
