import type { ReactNode } from 'react';
import './Hero.css';

export interface HeroProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  image?: { src: string; alt: string };
  children?: ReactNode;
  className?: string;
}

export function Hero({ title, subtitle, badge, actions, image, children, className }: HeroProps) {
  return (
    <section className={`shared-hero ${className || ''}`}>
      <div className="shared-hero-bg" />
      <div className="shared-hero-container">
        <div className={`shared-hero-grid ${image ? '' : 'shared-hero-grid--centered'}`}>
          <div className="shared-hero-content">
            {badge && <div className="shared-hero-badge">{badge}</div>}
            <h1 className="shared-hero-title">{title}</h1>
            {subtitle && <p className="shared-hero-subtitle">{subtitle}</p>}
            {actions && <div className="shared-hero-actions">{actions}</div>}
            {children}
          </div>
          {image && (
            <div className="shared-hero-image">
              <img src={image.src} alt={image.alt} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
