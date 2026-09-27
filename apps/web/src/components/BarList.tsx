export interface BarItem {
   label: string;
   value: number;
   sub?: string;
}

export function BarList({ items, emptyText = "No data" }: { items: BarItem[]; emptyText?: string }) {
   if (items.length === 0) return <div className="chart-empty">{emptyText}</div>;
   const max = Math.max(1, ...items.map((item) => item.value));
   return (
      		<div className="barlist">
         	{items.map((item) => (
            			<div className="bar-row" key={item.label}>
                  			<span className="bar-name" title={item.label}>{item.label}</span>
                  			<div className="bar-track">
                     			<div
                        		className="bar-fill"
                        		style={{ width: `${Math.max(1, (item.value / max) * 100)}%` }}
                     			/>
                  			</div>
                  			<span className="bar-value">
                     			{item.sub ?? item.value.toLocaleString()}
                  			</span>
            			</div>
            			))}
         		</div>
         		);
         		}
