import type { ReactNode } from 'react';
import './Footer.css';

export interface FooterLinkGroup {
  title: string;
  links: Array<{ label: string; href: string }>;
}

export interface FooterProps {
  groups: FooterLinkGroup[];
  copyright?: string;
  children?: ReactNode;
  className?: string;
}

export function Footer({ groups, copyright, children, className }: FooterProps) {
  return (
    <footer className={`shared-footer ${className || ''}`}>
      <div className="shared-footer-container">
        <div className="shared-footer-grid">
          {groups.map((group) => (
            <div key={group.title}>
              <h4 className="shared-footer-title">{group.title}</h4>
              <ul className="shared-footer-links">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="shared-footer-bottom">
          {copyright && <span>{copyright}</span>}
          {children}
        </div>
      </div>
    </footer>
  );
}
