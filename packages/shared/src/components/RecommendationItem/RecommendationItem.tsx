import './RecommendationItem.css';

export interface RecommendationItemProps {
  priority: 'critique' | 'important' | 'bonus';
  type: string;
  action: string;
  example?: string;
  keywords?: string[];
  onApply?: () => void;
  className?: string;
}

const TYPE_LABELS: Record<string, string> = {
  add: 'AJOUT',
  replace: 'REMPLACEMENT',
  repeat: 'REPETITION',
};

export function RecommendationItem({ priority, type, action, example, keywords, onApply, className }: RecommendationItemProps) {
  return (
    <div className={`shared-reco-item shared-reco-priority-${priority} ${className || ''}`}>
      <div className="shared-reco-title">
        <span className="shared-reco-badge">{priority.toUpperCase()}</span>
        <span className={`shared-reco-type shared-reco-type-${type}`}>{TYPE_LABELS[type] || type.toUpperCase()}</span>
        <span className="shared-reco-action">{action}</span>
      </div>
      {example && <div className="shared-reco-example">{example}</div>}
      {keywords && keywords.length > 0 && (
        <div className="shared-reco-keywords">
          {keywords.map(k => <span key={k} className="shared-reco-keyword">"{k}"</span>)}
        </div>
      )}
      {onApply && (
        <button className="shared-reco-apply-btn" onClick={onApply} type="button">
          Appliquer
        </button>
      )}
    </div>
  );
}
