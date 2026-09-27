export interface DonutSlice {
   label: string;
   value: number;
   color: string;
}

export function DonutChart({
   slices,
   total,
   centerLabel,
   size = 150,
}: {
   slices: DonutSlice[];
   total?: number;
   centerLabel?: string;
   size?: number;
}) {
   const sum = total ?? slices.reduce((accumulator, slice) => accumulator + slice.value, 0);
   if (sum <= 0) {
      return <div className="chart-empty">No data</div>;
          }
   const thickness = size * 0.16;
   const radius = size / 2 - thickness / 2;
   const circumference = 2 * Math.PI * radius;
   let offsetFraction = 0;

   return (
      	<div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
         	<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribution chart">
             	<g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
                		<circle
                   	cx={size / 2}
                   	cy={size / 2}
                   	r={radius}
                   	fill="none"
                   	stroke="var(--bg)"
                   	strokeWidth={thickness}
                 		/>
                 	{slices.map((slice) => {
                       	const fraction = slice.value / sum;
                       	const dashArray = `${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}`;
                       	const dashOffset = (-offsetFraction * circumference).toFixed(2);
                       	offsetFraction += fraction;
                       	return (
                          			<circle
                             		key={slice.label}
                             		cx={size / 2}
                             		cy={size / 2}
                             		r={radius}
                             		fill="none"
                             		stroke={slice.color}
                             		strokeWidth={thickness}
                             		strokeDasharray={dashArray}
                             		strokeDashoffset={dashOffset}
                         			/>
                         			);
                          	})}
             	</g>
             	{centerLabel !== undefined && (
                		<text
                   	x="50%"
                   	y="50%"
                   	dominantBaseline="central"
                   	textAnchor="middle"
                   	fill="var(--text)"
                   	fontSize={size * 0.16}
                   	fontWeight={650}
                 		>
                    	{centerLabel}
                 		</text>
                       	)}
         	</svg>
         	<div className="barlist" style={{ gap: 4 }}>
             	{slices.map((slice) => (
                		<div key={slice.label} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    	<span className="dot" style={{ background: slice.color, width: 8, height: 8, borderRadius: 2 }} />
                    	<span>{slice.label}</span>
                    	<span className="muted">{slice.value.toLocaleString()}</span>
                 		</div>
                       	))}
         	</div>
         	</div>
         	);
         	}
