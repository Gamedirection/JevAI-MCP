const SECRET_KEY_PATTERN =
   /(api[_-]?key|apikey|authorization|password|secret|token|access[_-]?key)/i;

const RAW_KEY_PATTERN = /\b(dk-[A-Za-z0-9_-]{6,}|jv_(?:live|test)_[A-Za-z0-9_-]{6,})\b/g;

export function maskSecret(value: string): string {
   const trimmed = value.trim();
   if (trimmed.length <= 8) return "*".repeat(Math.max(trimmed.length, 4));
   return `${trimmed.slice(0, trimmed.startsWith("dk-") ? 3 : 4)}${"*".repeat(24)}${trimmed.slice(-4)}`;
}

export function redactText(value: string): string {
   return value.replace(RAW_KEY_PATTERN, (match) => maskSecret(match));
}

export function redactValue<T>(value: T): T {
   if (value === null || value === undefined) return value;
   if (typeof value === "string") return redactText(value) as T;
   if (Array.isArray(value)) {
      return value.map((entry) => redactValue(entry)) as unknown as T;
   }
   if (typeof value === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
         if (SECRET_KEY_PATTERN.test(key)) {
            output[key] = typeof entry === "string" && entry.length > 0
               ? maskSecret(entry)
               : "[redacted]";
           } else {
            output[key] = redactValue(entry);
           }
        }
      return output as T;
    }
   return value;
}

export function truncateText(value: string, maxChars: number): string {
   if (value.length <= maxChars) return value;
   return `${value.slice(0, maxChars)}…[truncated]`;
}
