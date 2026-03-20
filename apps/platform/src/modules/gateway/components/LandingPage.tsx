import { APPS, CATEGORIES } from '../constants';
import { useAuth } from '../context/AuthContext';

interface LandingPageProps {
  onNavigate?: (path: string) => void;
}

const ICONS: Record<string, JSX.Element> = {
  'products': (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
};

export function LandingPage({ onNavigate }: LandingPageProps = {}) {
  const { user } = useAuth();

  // Filter apps based on user permissions
  const availableApps = APPS.filter(app => user?.permissions?.includes(app.id));

  // Group apps by category
  const appsByCategory = CATEGORIES.map(category => ({
    ...category,
    apps: availableApps.filter(app => app.category === category.id),
  })).filter(category => category.apps.length > 0);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (onNavigate) {
      e.preventDefault();
      onNavigate(`${path}/`);
    }
  };

  return (
    <div className="landing">
      <h1 className="landing-title">Boilerplate Platform</h1>
      <p className="landing-subtitle">
        Plateforme de gestion avec authentification JWT et design system intégré
      </p>

      {availableApps.length === 0 ? (
        <div className="no-apps-message">
          <p>Aucune application disponible.</p>
          <p>Contactez un administrateur pour obtenir les droits d'accès.</p>
        </div>
      ) : (
        <div className="apps-categories">
          {appsByCategory.map(category => (
            <section key={category.id} className="apps-category">
              <div className="category-header">
                <span className="category-icon">{category.icon}</span>
                <div className="category-info">
                  <h2 className="category-name">{category.name}</h2>
                  <p className="category-description">{category.description}</p>
                </div>
              </div>
              <div className="apps-grid">
                {category.apps.map(app => (
                  <a
                    key={app.id}
                    className="app-card"
                    href={`${app.path}/`}
                    onClick={(e) => handleClick(e, app.path)}
                  >
                    <div className="app-card-header">
                      <div
                        className="app-card-icon"
                        style={{
                          background: `linear-gradient(135deg, ${app.color} 0%, ${app.gradientEnd} 100%)`,
                        }}
                      >
                        {ICONS[app.id] || <span>📦</span>}
                      </div>
                      <div className="app-card-name">{app.name}</div>
                    </div>
                    <p className="app-card-description">{app.description}</p>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
