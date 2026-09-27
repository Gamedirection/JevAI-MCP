export function formatNumber(value: number | null | undefined): string {
   if (value === null || value === undefined) return "-";
   return value.toLocaleString("en-US");
}

export function formatDuration(ms: number | null | undefined): string {
   if (ms === null || ms === undefined) return "-";
   if (ms < 1000) return `${Math.round(ms)} ms`;
   return `${(ms / 1000).toFixed(2)} s`;
}

export function formatPercent(value: number | null | undefined): string {
   if (value === null || value === undefined) return "-";
   return `${value.toFixed(1)}%`;
}

export function formatBytes(bytes: number | null | undefined): string {
   if (bytes === null || bytes === undefined) return "-";
   const units = ["B", "KB", "MB", "GB", "TB"];
   let value = bytes;
   let unit = 0;
   while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
   return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatUptime(totalSeconds: number | null | undefined): string {
   if (totalSeconds === null || totalSeconds === undefined) return "-";
   const days = Math.floor(totalSeconds / 86_400);
   const hours = Math.floor((totalSeconds % 86_400) / 3_600);
   const minutes = Math.floor((totalSeconds % 3_600) / 60);
   const parts: string[] = [];
   if (days > 0) parts.push(`${days}d`);
   if (hours > 0 || days > 0) parts.push(`${hours}h`);
   parts.push(`${minutes}m`);
   return parts.join(" ");
}

export function formatDateTime(iso: string | null | undefined): string {
   if (!iso) return "-";
   const date = new Date(iso);
   if (Number.isNaN(date.getTime())) return iso;
   return date.toLocaleString("en-US", {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
         });
}

export function formatRelative(iso: string | null | undefined): string {
   if (!iso) return "never";
   const time = new Date(iso).getTime();
   if (Number.isNaN(time)) return "-";
   const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
   if (seconds < 60) return `${seconds}s ago`;
   if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
   if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
   return `${Math.floor(seconds / 86_400)}d ago`;
}

export function bucketLabel(bucket: string, bucketSeconds: number): string {
   const date = new Date(bucket);
   if (Number.isNaN(date.getTime())) return bucket;
   if (bucketSeconds >= 86_400) {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
   return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
