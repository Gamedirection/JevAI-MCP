import type { TimeRangePreset } from "./settings.ts";

export interface TimeRange {
   from: string;
   to: string;
   bucketSeconds: number;
   label: string;
}

function iso(d: Date): string {
   return d.toISOString();
}

function startOfDayUTC(d: Date): Date {
   return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function pickBucket(spanMs: number): number {
   const hours = spanMs / 3_600_000;
   if (hours <= 6) return 60;
   if (hours <= 24) return 300;
   if (hours <= 72) return 1_800;
   if (hours <= 24 * 14) return 3_600;
   if (hours <= 24 * 45) return 21_600;
   if (hours <= 24 * 120) return 86_400;
   return 604_800;
}

export function resolveTimeRange(
   preset: TimeRangePreset,
   options: { from?: string; to?: string; now?: Date } = {},
): TimeRange {
   const now = options.now ?? new Date();
   let from: Date;
   let to: Date = now;
   let label: string;

   switch (preset) {
      case "today": {
         from = startOfDayUTC(now);
         label = "Today";
         break;
       }
      case "7d":
         from = new Date(now.getTime() - 7 * 86_400_000);
         label = "Last 7 days";
         break;
      case "30d":
         from = new Date(now.getTime() - 30 * 86_400_000);
         label = "Last 30 days";
         break;
      case "month": {
         from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
         label = "This month";
         break;
      }
      case "year": {
         from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
         label = "This year";
         break;
      }
      case "custom":
      default: {
         from = options.from ? new Date(options.from) : new Date(now.getTime() - 7 * 86_400_000);
         if (Number.isNaN(from.getTime())) from = new Date(now.getTime() - 7 * 86_400_000);
         if (options.to) {
               const parsedTo = new Date(options.to);
               if (!Number.isNaN(parsedTo.getTime())) {
                     to = new Date(parsedTo.getTime() < 1e11 ? parsedTo.getTime() * 1000 : parsedTo.getTime());
                     if (to.getTime() <= from.getTime()) {
                           to = new Date(from.getTime() + 86_400_000 - 1000);
                              }
                       }
                  }
         label = "Custom";
         break;
         }
      }

   const spanMs = Math.max(to.getTime() - from.getTime(), 1_000);
   return {
      from: iso(from),
      to: iso(to),
      bucketSeconds: pickBucket(spanMs),
      label,
      };
}
