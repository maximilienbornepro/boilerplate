import './ScoreBlock.css';

export interface ScoreMetric {
  label: string;
  value: number;
  max?: number;
}

export interface ScoreBlockProps {
  title?: string;
  before: number;
  after: number;
  metrics?: ScoreMetric[];
  missingItems?: string[];
  className?: string;
}

function getScoreClass(score: number): string {
  if (score >= 75) return 'shared-score--good';
  if (score >= 50) return 'shared-score--medium';
  return 'shared-score--bad';
}

export function ScoreBlock({ title, before, after, metrics, missingItems, className }: ScoreBlockProps) {
  const delta = after - before;
  return (
    <div className={`shared-score-block ${className || ''}`}>
      {title && <div className="shared-score-header">{title}</div>}
      <div className="shared-score-row">
        <div className="shared-score-side">
          <div className="shared-score-label">Avant</div>
          <div className={`shared-score-value ${getScoreClass(before)}`}>{before}%</div>
        </div>
        <div className="shared-score-arrow">{'\u2192'}</div>
        <div className="shared-score-side">
          <div className="shared-score-label">Apres</div>
          <div className={`shared-score-value ${getScoreClass(after)}`}>{after}%</div>
        </div>
        <div className={`shared-score-delta ${delta >= 0 ? 'positive' : 'negative'}`}>
          {delta >= 0 ? '+' : ''}{delta}
        </div>
      </div>
      {metrics && metrics.length > 0 && (
        <div className="shared-score-metrics">
          {metrics.map((m, i) => (
            <div key={i} className="shared-score-metric">
              <span className="shared-score-metric-label">{m.label}</span>
              <div className="shared-score-metric-bar">
                <div className={`shared-score-metric-fill ${getScoreClass(m.value)}`} style={{ width: `${m.value}%` }} />
              </div>
              <span className="shared-score-metric-value">{m.value}%</span>
            </div>
          ))}
        </div>
      )}
      {missingItems && missingItems.length > 0 && (
        <div className="shared-score-missing">
          Manquants : {missingItems.map(k => `"${k}"`).join(', ')}
        </div>
      )}
    </div>
  );
}
