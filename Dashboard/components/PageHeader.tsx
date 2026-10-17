import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, badge, action }: PageHeaderProps) {
  return (
    <div className="workspace-pagehead">
      <div className="workspace-pagehead-main">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h1 className="workspace-pagehead-title">{title}</h1>
          {badge && <div className="workspace-pagehead-badge">{badge}</div>}
        </div>
        {subtitle && <p className="workspace-pagehead-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="workspace-pagehead-action">{action}</div>}
    </div>
  );
}
