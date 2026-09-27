import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { resolveTimeRange, type TimeRangePreset } from "@jevai/shared";
import type { AppContext } from "../context.ts";

export const TIME_RANGE_PRESETS = ["today", "7d", "30d", "month", "year", "custom"] as const;

export type QueryLike = URLSearchParams | Record<string, string | undefined>;

function queryValue(query: QueryLike, key: string): string | undefined {
   return query instanceof URLSearchParams ? query.get(key) ?? undefined : query[key];
}

export function parseTimeRange(query: QueryLike): ReturnType<typeof resolveTimeRange> {
   const raw = (queryValue(query, "range") ?? "7d") as TimeRangePreset;
   const preset: TimeRangePreset = (TIME_RANGE_PRESETS as readonly string[]).includes(raw)
      ? raw
       : "7d";
   return resolveTimeRange(preset, {
      from: queryValue(query, "from"),
      to: queryValue(query, "to"),
        });
}

export function json<T>(c: Context, data: T, status: ContentfulStatusCode = 200): Response {
   return c.json(data as never, status);
}

export function errorResponse(
   c: Context,
   status: ContentfulStatusCode,
   message: string,
   details?: unknown,
): Response {
   return c.json(
       { success: false, error: { message, ...(details !== undefined ? { details } : {}) } } as never,
      status,
      );
}

export function app(c: Context): AppContext {
   const value = c.get("app");
   if (!value) throw new Error("app context missing");
   return value as AppContext;
}

export function pagination(query: URLSearchParams): { limit: number; offset: number } {
   const limit = clampInt(query.get("limit"), 50, 1, 500);
   const offset = clampInt(query.get("offset"), 0, 0, 1_000_000);
   return { limit, offset };
}

export function clampInt(
   raw: string | null,
   fallback: number,
   min: number,
   max: number,
): number {
   if (raw === null) return fallback;
   const parsed = Number.parseInt(raw, 10);
   if (!Number.isFinite(parsed)) return fallback;
   return Math.min(Math.max(parsed, min), max);
}
