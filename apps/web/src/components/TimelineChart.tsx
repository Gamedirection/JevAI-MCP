import { bucketLabel } from "../lib/format.ts";
import { useElementWidth } from "../lib/useElementWidth.ts";

export interface TimelinePoint {
   bucket: string;
   success: number;
   failed: number;
   avgDurationMs: number | null;
   inputTokens: number;
}

const HEIGHT = 200;
const PAD = { top: 10, right: 46, bottom: 22, left: 40 };

export function TimelineChart({
   points,
   bucketSeconds,
   metric = "count",
}: {
   points: TimelinePoint[];
   bucketSeconds: number;
   metric?: "count" | "duration";
}) {
   const [containerRef, containerWidth] = useElementWidth<HTMLDivElement>();
   const width = Math.max(containerWidth, 280);

   if (points.length === 0) {
      return (
         	<div className="chart-empty" ref={containerRef}>
             	No data in this time range.
         	</div>
            	);
       	}

   const maxCount = Math.max(1, ...points.map((point) => point.success + point.failed));
   const maxDuration = Math.max(1, ...points.map((point) => point.avgDurationMs ?? 0));
   const innerWidth = width - PAD.left - PAD.right;
   const innerHeight = HEIGHT - PAD.top - PAD.bottom;
   const slot = innerWidth / points.length;
   const barWidth = Math.max(2, Math.min(28, slot * 0.7));

   const yForCount = (value: number) =>
      PAD.top + innerHeight - (value / maxCount) * innerHeight;
   const yForDuration = (value: number) =>
      PAD.top + innerHeight - (value / maxDuration) * innerHeight;

   const durationLine = points
      .map((point, index) => {
         if (point.avgDurationMs === null) return null;
         const x = PAD.left + slot * index + slot / 2;
         const y = yForDuration(point.avgDurationMs);
         return `${index === 0 || points[index - 1]?.avgDurationMs === null ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
             })
      .filter((segment): segment is string => segment !== null)
      .join(" ");

   const labelEvery = Math.max(1, Math.ceil(points.length / 8));

   return (
      	<div ref={containerRef} style={{ width: "100%" }}>
         	<svg
             	width={width}
             	height={HEIGHT}
             	viewBox={`0 0 ${width} ${HEIGHT}`}
             	role="img"
             	aria-label="Request timeline chart"
                	>
             	{[0, 0.5, 1].map((fraction) => {
                   	const y = PAD.top + innerHeight * (1 - fraction);
                   	return (
                      		<g key={fraction}>
                         		<line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} className="chart-grid-line" />
                         		<text x={PAD.left - 6} y={y + 3} textAnchor="end" className="chart-text">
                            	{metric === "duration"
                                 	? Math.round(maxDuration * fraction).toLocaleString()
                                 	: Math.round(maxCount * fraction).toLocaleString()}
                            	</text>
                         	</g>
                         	);
                       	})}
             	{points.map((point, index) => {
                   	const x = PAD.left + slot * index + (slot - barWidth) / 2;
                   	const total = point.success + point.failed;
                   	const successHeight = (point.success / maxCount) * innerHeight;
                   	const failedHeight = (point.failed / maxCount) * innerHeight;
                   	return (
                      		<g key={point.bucket}>
                         		{total > 0 && (
                            		<>
                               	<rect
                                 		x={x}
                                 		y={yForCount(point.success)}
                                 		width={barWidth}
                                 		height={Math.max(successHeight, point.success > 0 ? 1 : 0)}
                                 		fill="var(--green)"
                                 		rx={2}
                                    	/>
                               	<rect
                                 		x={x}
                                 		y={yForCount(total)}
                                 		width={barWidth}
                                 		height={Math.max(failedHeight, point.failed > 0 ? 1 : 0)}
                                 		fill="var(--red)"
                                 		rx={2}
                                    	/>
                               	</>
                                    	)}
                         		{index % labelEvery === 0 && (
                            		<text
                                 		x={PAD.left + slot * index + slot / 2}
                                 		y={HEIGHT - 8}
                                 		textAnchor="middle"
                                 		className="chart-text"
                                    	>
                                 	{bucketLabel(point.bucket, bucketSeconds)}
                                 	</text>
                                    	)}
                         	</g>
                         	);
                       	})}
             	{metric === "duration" && durationLine && (
                	<path d={durationLine} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
                      	)}
         	</svg>
         	<div className="legend">
             	<span><span className="dot" style={{ background: "var(--green)" }} />success</span>
             	<span><span className="dot" style={{ background: "var(--red)" }} />failed</span>
             	{metric === "duration" && (
                	<span><span className="dot" style={{ background: "var(--accent)" }} />avg duration (ms, right scale)</span>
                      	)}
         	</div>
      	</div>
      	);
      	}

export function Sparkline({ values, color = "var(--accent)" }: { values: number[]; color?: string }) {
   if (values.length < 2) return <div className="chart-empty">Not enough data</div>;
   const max = Math.max(1, ...values);
   const width = 160;
   const height = 36;
   const points = values
      .map((value, index) => {
         const x = (index / (values.length - 1)) * width;
         const y = height - (value / max) * (height - 4) - 2;
         return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
             })
      .join(" ");
   return (
      	<svg width={width} height={height} role="img" aria-label="Trend sparkline">
         	<path d={points} fill="none" stroke={color} strokeWidth={1.5} />
      	</svg>
      	);
      	}
