import { Card, Badge, Button, Hero, StatCounter, Footer, SectionTitle } from '@boilerplate/shared/components';
import './LandingDemo.css';

const features = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    title: 'Ultra Rapide',
    description: 'Performance optimisée pour une expérience fluide et réactive en toutes circonstances.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: 'Sécurisé',
    description: 'Vos données sont protégées avec les dernières technologies de chiffrement.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: 'Collaboration',
    description: "Travaillez en équipe de manière efficace avec des outils de collaboration intégrés.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r="2.5" />
        <path d="M17 2H7a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5V7a5 5 0 0 0-5-5z" />
      </svg>
    ),
    title: 'Personnalisable',
    description: "Adaptez l'interface à vos besoins avec des options de personnalisation avancées.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    title: 'API Complète',
    description: 'Intégrez facilement avec vos outils existants grâce à notre API documentée.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      </svg>
    ),
    title: 'Évolutif',
    description: "Grandissez sans limites avec une infrastructure qui s'adapte à vos besoins.",
  },
];

const footerGroups = [
  { title: 'Produit', links: [
    { label: 'Fonctionnalités', href: '#' },
    { label: 'Tarifs', href: '#' },
    { label: 'Témoignages', href: '#' },
    { label: 'FAQ', href: '#' },
  ]},
  { title: 'Entreprise', links: [
    { label: 'À propos', href: '#' },
    { label: 'Blog', href: '#' },
    { label: 'Carrières', href: '#' },
    { label: 'Contact', href: '#' },
  ]},
  { title: 'Ressources', links: [
    { label: 'Documentation', href: '#' },
    { label: 'Guides', href: '#' },
    { label: 'API', href: '#' },
    { label: 'Support', href: '#' },
  ]},
  { title: 'Légal', links: [
    { label: 'Confidentialité', href: '#' },
    { label: 'Conditions', href: '#' },
    { label: 'Cookies', href: '#' },
    { label: 'Licences', href: '#' },
  ]},
];

export function LandingDemo() {
  return (
    <div className="landing-page">
      {/* ── Hero ── */}
      <Hero
        title="Transformez vos idées en réalité"
        subtitle="Une solution innovante pour accélérer votre productivité et donner vie à vos projets. Simple, rapide et puissant."
        badge={<Badge type="accent">Nouvelle plateforme disponible</Badge>}
        actions={
          <>
            <Button variant="primary">Commencer gratuitement →</Button>
            <Button variant="secondary">En savoir plus</Button>
          </>
        }
        image={{
          src: 'https://images.unsplash.com/photo-1683701251422-912fe98f2b5e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=800',
          alt: 'Workspace moderne',
        }}
      >
        <StatCounter
          items={[
            { value: '10k+', label: 'Utilisateurs' },
            { value: '99.9%', label: 'Uptime' },
            { value: '24/7', label: 'Support' },
          ]}
        />
      </Hero>

      {/* ── Features ── */}
      <section className="landing-section">
        <div className="landing-container">
          <div className="landing-section-header">
            <SectionTitle>Tout ce dont vous avez besoin</SectionTitle>
            <p className="landing-section-subtitle">
              Des fonctionnalités puissantes conçues pour simplifier votre workflow et améliorer votre productivité.
            </p>
          </div>

          <div className="landing-features-grid">
            {features.map((feature) => (
              <Card key={feature.title} variant="interactive" className="landing-feature-card">
                <div className="landing-feature-icon">{feature.icon}</div>
                <h3 className="landing-feature-title">{feature.title}</h3>
                <p className="landing-feature-desc">{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="landing-section">
        <div className="landing-container">
          <Card className="landing-cta">
            <h2 className="landing-cta-title">Prêt à commencer votre voyage ?</h2>
            <p className="landing-section-subtitle">
              Rejoignez des milliers d'utilisateurs qui ont déjà transformé leur façon de travailler.
              Essayez gratuitement pendant 14 jours, sans carte de crédit.
            </p>
            <div className="landing-cta-actions">
              <Button variant="primary">Démarrer maintenant →</Button>
              <Button variant="secondary">Planifier une démo</Button>
            </div>
            <div className="landing-cta-trust">
              <Badge type="accent">14 jours gratuit</Badge>
              <Badge type="accent">Sans engagement</Badge>
              <Badge type="accent">Assistance 24/7</Badge>
            </div>
          </Card>
        </div>
      </section>

      {/* ── Footer ── */}
      <Footer
        groups={footerGroups}
        copyright="© 2026 Boilerplate. Tous droits réservés."
      />
    </div>
  );
}
