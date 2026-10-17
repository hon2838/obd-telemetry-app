import React from 'react';

interface MetricSummaryProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  subtext?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
  testId?: string;
  valueColor?: string;
}

export default function MetricSummary({
  label,
  value,
  unit,
  subtext,
  icon,
  badge,
  className = '',
  testId,
  valueColor
}: MetricSummaryProps) {
  return (
    <section className={`glass-panel metric-summary-card ${className}`} data-testid={testId}>
      <div className="metric-summary-header">
        <span className="metric-summary-label">{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {badge}
          {icon && <span className="metric-summary-icon" aria-hidden="true">{icon}</span>}
        </div>
      </div>
      <div className="metric-summary-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
        {unit && <small className="metric-summary-unit">{unit}</small>}
      </div>
      {subtext && <div className="metric-summary-subtext">{subtext}</div>}
    </section>
  );
}
