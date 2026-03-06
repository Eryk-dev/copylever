import { useEffect, useRef } from 'react';

interface Props {
  onNavigateToLogin: () => void;
  onNavigateToSignup: () => void;
}

export default function LandingPage({ onNavigateToLogin, onNavigateToSignup }: Props) {
  const revealRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('lp-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const setRevealRef = (i: number) => (el: HTMLElement | null) => {
    revealRefs.current[i] = el;
  };

  return (
    <div className="lp-page" style={s.page}>
      <style>{css}</style>

      {/* Nav */}
      <nav style={s.nav}>
        <div className="lp-nav" style={s.navInner}>
          <img src="/logo-lever.svg" alt="Lever Talents" className="lp-logo-img" style={s.logo} />
          <div style={s.navRight}>
            <button className="lp-link" onClick={onNavigateToLogin} style={s.navLink}>Entrar</button>
            <button className="lp-cta lp-cta-primary" onClick={onNavigateToSignup} style={s.navCta}>Começar</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section style={s.hero}>
        <div className="lp-atmosphere" style={s.heroAtmosphere} aria-hidden="true" />
        <div className="lp-hero-inner" style={s.heroInner}>
          <div className="lp-hero-text" style={s.heroText}>
            <span className="lp-eyebrow" style={s.heroEyebrow}>Para sellers do Mercado Livre</span>
            <h1 className="lp-h1" style={s.h1}>{'Copie anúncios\nentre contas'}</h1>
            <p className="lp-sub" style={s.heroSub}>
              Fotos, atributos, variações e compatibilidades veiculares.
              De uma conta para várias, em segundos.
            </p>
            <div style={s.heroDivider} />
            <div className="lp-ctas" style={s.heroCtas}>
              <button className="lp-cta lp-cta-primary" onClick={onNavigateToSignup} style={s.ctaPrimary}>Começar agora</button>
              <button className="lp-link" onClick={onNavigateToLogin} style={s.ctaSecondary}>Já tenho conta</button>
            </div>
          </div>

          {/* Terminal */}
          <div className="lp-terminal" style={s.terminal}>
            <div className="lp-term-bar" style={s.termBar}>
              <div style={s.termDots}>
                <span style={{ ...s.termDot, background: '#ff5f57' }} />
                <span style={{ ...s.termDot, background: '#febc2e' }} />
                <span style={{ ...s.termDot, background: '#28c840' }} />
              </div>
              <span style={s.termTitle}>Copy Anuncios</span>
              <div style={{ width: 48 }} />
            </div>
            <div style={s.termBody}>
              <div className="lp-op-header" style={s.opHeader}>
                <span style={s.opFrom}>loja_principal</span>
                <span style={s.opArrow}>{'\u2192'}</span>
                <span style={s.opTo}>loja_sul, loja_norte, loja_sp</span>
                <span className="lp-cursor" style={s.cursor}>{'\u258B'}</span>
              </div>

              <div style={s.logEntries}>
                {logs.map((item) => (
                  <div key={item.id} className="lp-log-entry" style={s.logEntry}>
                    <div style={s.logMain}>
                      <span className="lp-check" style={s.logCheck}>{'\u2713'}</span>
                      <div style={s.logInfo}>
                        <div style={s.logTitleRow}>
                          <span style={s.logId}>{item.id}</span>
                          <span style={s.logTitle}>{item.title}</span>
                        </div>
                        <span style={s.logMeta}>{item.meta}</span>
                      </div>
                    </div>
                    <span style={s.logTime}>{item.time}</span>
                  </div>
                ))}
              </div>

              <div className="lp-summary" style={s.summaryBar}>
                <div style={s.summaryLeft}>
                  <span style={s.summaryDone}>4/4 copiados</span>
                  <span style={s.summaryDetail}>{'\u00d7 3 destinos = 12 anúncios criados'}</span>
                </div>
                <span style={s.summaryBadge}>{'Concluído'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quote */}
      <section ref={setRevealRef(0)} className="lp-reveal" style={s.proofSection}>
        <div className="lp-section" style={s.sectionInner}>
          <span style={s.quoteDecor}>{'\u201C'}</span>
          <blockquote className="lp-quote" style={s.quote}>
            Eu copiava anúncio por anúncio, levava o dia inteiro.
            Agora copio 50 de uma vez e saio pra almoçar.
          </blockquote>
          <p style={s.quoteAuthor}>{'\u2014 Vendedor de autopeças, 4 contas no Mercado Livre'}</p>
        </div>
      </section>

      {/* What gets copied */}
      <section ref={setRevealRef(1)} className="lp-reveal" style={s.section}>
        <div className="lp-section" style={s.sectionInner}>
          <h2 className="lp-h2" style={s.h2}>O que é copiado</h2>
          <div className="lp-grid" style={s.specGrid}>
            {specs.map((item) => (
              <div key={item.label} style={s.specItem}>
                <span style={s.specLabel}>{item.label}</span>
                <span style={s.specDetail}>{item.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section ref={setRevealRef(2)} className="lp-reveal" style={s.pricingSection}>
        <div className="lp-section" style={{ ...s.sectionInner, maxWidth: 480 }}>
          <div style={s.priceCard}>
            <span style={s.pricePlan}>{'Plano único'}</span>
            <div style={s.priceRow}>
              <span style={s.priceCurrency}>R$</span>
              <span style={s.priceNumber}>349</span>
              <span style={s.priceCents}>,90</span>
              <span style={s.pricePeriod}>{'/mês'}</span>
            </div>
            <div style={s.priceDivider} />
            <ul style={s.priceList}>
              {features.map((f) => (
                <li key={f} style={s.priceItem}>
                  <span style={s.priceItemCheck}>{'\u2713'}</span>
                  {f}
                </li>
              ))}
            </ul>
            <button className="lp-cta lp-cta-primary" onClick={onNavigateToSignup} style={s.priceCta}>{'Começar agora'}</button>
            <p style={s.priceNote}>Sem contrato. Cancele quando quiser.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={s.footer}>
        <div className="lp-nav" style={s.footerInner}>
          <img src="/logo-lever.svg" alt="Lever Talents" className="lp-logo-img" style={s.footerLogo} />
          <span style={s.footerCopy}>{'\u00a9'} {new Date().getFullYear()}</span>
          <button className="lp-link" onClick={onNavigateToLogin} style={s.footerLink}>Entrar</button>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */
const logs = [
  { id: 'MLB2847361590', title: 'Kit Amortecedor Dianteiro Corsa', meta: '12 fotos \u00b7 8 atributos \u00b7 47 compat.', time: '3.2s' },
  { id: 'MLB1938475610', title: 'Pastilha Freio Cerâmica HB20', meta: '8 fotos \u00b7 12 atributos \u00b7 31 compat.', time: '2.8s' },
  { id: 'MLB7261940382', title: 'Filtro Óleo Motor Civic 2.0', meta: '6 fotos \u00b7 10 atributos', time: '1.9s' },
  { id: 'MLB4829173650', title: 'Bobina Ignição Golf TSI', meta: '4 fotos \u00b7 9 atributos \u00b7 23 compat.', time: '2.1s' },
];

const specs = [
  { label: 'Fotos', detail: 'Todas as imagens, na ordem original' },
  { label: 'Atributos', detail: 'Marca, modelo, cor, material \u2014 tudo que o ML exige' },
  { label: 'Variações', detail: 'Cada SKU com preço e estoque próprios' },
  { label: 'Compatibilidades', detail: 'Tabela veicular completa \u2014 Honda Civic 2015, Golf TSI...' },
  { label: 'Dimensões', detail: 'Peso e medidas do pacote, personalizáveis por destino' },
  { label: 'Descrição', detail: 'Texto completo, sem truncamento' },
];

const features = [
  'Cópias ilimitadas',
  'Compatibilidades veiculares',
  'Múltiplas contas do Mercado Livre',
  'Usuários e permissões por conta',
  'Suporte por email',
];

/* ------------------------------------------------------------------ */
/* CSS — theme tokens + animations                                     */
/* ------------------------------------------------------------------ */
const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap');

  /* ---- Dark only ---- */
  .lp-page {
    --lp-bg: #0a0a0a;
    --lp-bg-raised: #111111;
    --lp-bg-inset: #0c0c0c;
    --lp-bg-pricing: #080808;
    --lp-ink: #f0f0f0;
    --lp-ink-2: #cccccc;
    --lp-ink-3: #777777;
    --lp-ink-4: #555555;
    --lp-ink-5: #3a3a3a;
    --lp-line: rgba(255,255,255,0.06);
    --lp-line-subtle: rgba(255,255,255,0.04);
    --lp-cta-bg: #e8e8e8;
    --lp-cta-ink: #0a0a0a;
    --lp-cta-glow: rgba(232,232,232,0.1);
    --lp-nav-bg: rgba(10,10,10,0.82);
    --lp-green: #34d399;
    --lp-green-bg: rgba(52,211,153,0.04);
    --lp-green-line: rgba(52,211,153,0.08);
    --lp-green-badge: rgba(52,211,153,0.08);
    --lp-quote-mark: rgba(255,255,255,0.06);
    --lp-grain-opacity: 0.03;
    --lp-terminal-shadow: 0 0 80px rgba(52,211,153,0.03), 0 40px 100px rgba(0,0,0,0.5);
  }

  /* Logo invert (always dark) */
  .lp-logo-img { filter: invert(1); }

  /* Atmosphere gradient */
  .lp-atmosphere {
    background: radial-gradient(ellipse 70% 50% at 25% 0%, rgba(255,255,255,0.03) 0%, transparent 60%);
  }

  /* Film grain */
  .lp-page::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    pointer-events: none;
    z-index: 50;
    opacity: var(--lp-grain-opacity);
  }

  /* ---- Animations ---- */
  @keyframes lp-in {
    from { opacity: 0; transform: translateY(24px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes lp-entry-in {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes lp-check-pop {
    0% { opacity: 0; transform: scale(0); }
    60% { transform: scale(1.3); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes lp-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes lp-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  /* Hero entrance */
  .lp-hero-text {
    animation: lp-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .lp-terminal {
    animation: lp-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both;
  }

  /* Terminal stagger */
  .lp-op-header {
    opacity: 0;
    animation: lp-fade 0.4s ease-out 0.4s both;
  }
  .lp-log-entry {
    opacity: 0;
    animation: lp-entry-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .lp-log-entry:nth-child(1) { animation-delay: 0.7s; }
  .lp-log-entry:nth-child(2) { animation-delay: 1.1s; }
  .lp-log-entry:nth-child(3) { animation-delay: 1.45s; }
  .lp-log-entry:nth-child(4) { animation-delay: 1.75s; }

  .lp-log-entry .lp-check {
    opacity: 0;
    animation: lp-check-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  .lp-log-entry:nth-child(1) .lp-check { animation-delay: 0.9s; }
  .lp-log-entry:nth-child(2) .lp-check { animation-delay: 1.3s; }
  .lp-log-entry:nth-child(3) .lp-check { animation-delay: 1.65s; }
  .lp-log-entry:nth-child(4) .lp-check { animation-delay: 1.95s; }

  .lp-summary {
    opacity: 0;
    animation: lp-fade 0.5s ease-out 2.2s both;
  }
  .lp-cursor {
    animation: lp-blink 1.2s step-end infinite;
  }

  /* Scroll reveal */
  .lp-reveal {
    opacity: 0;
    transform: translateY(32px);
    transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .lp-reveal.lp-visible {
    opacity: 1;
    transform: translateY(0);
  }

  /* Buttons */
  .lp-cta {
    transition: background 0.2s, transform 0.1s, opacity 0.2s, box-shadow 0.2s;
  }
  .lp-cta:hover { opacity: 0.88; }
  .lp-cta:active { transform: scale(0.97); }
  .lp-cta-primary:hover {
    box-shadow: 0 0 28px var(--lp-cta-glow);
    opacity: 1 !important;
  }

  .lp-link {
    transition: color 0.2s;
  }
  .lp-link:hover { color: var(--lp-ink) !important; }

  /* ---- Responsive ---- */
  @media (max-width: 960px) {
    .lp-hero-inner {
      flex-direction: column !important;
      gap: 56px !important;
    }
    .lp-hero-text { max-width: 100% !important; }
    .lp-terminal { max-width: 100% !important; }
    .lp-h1 { font-size: 48px !important; }
  }

  @media (max-width: 640px) {
    .lp-h1 { font-size: 38px !important; }
    .lp-sub { font-size: 15px !important; }
    .lp-nav, .lp-section { padding-left: 20px !important; padding-right: 20px !important; }
    .lp-ctas { flex-direction: column !important; align-items: stretch !important; }
    .lp-grid { grid-template-columns: 1fr !important; }
    .lp-h2 { font-size: 24px !important; }
    .lp-quote { font-size: 22px !important; }
    .lp-eyebrow { font-size: 11px !important; }
  }
`;

/* ------------------------------------------------------------------ */
/* Styles — all colors use CSS variables for light/dark                */
/* ------------------------------------------------------------------ */
const s: Record<string, React.CSSProperties> = {
  page: {
    background: 'var(--lp-bg)',
    color: 'var(--lp-ink)',
    minHeight: '100vh',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    WebkitFontSmoothing: 'antialiased',
    overflowX: 'hidden',
    position: 'relative',
  },

  // Nav
  nav: {
    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
    background: 'var(--lp-nav-bg)',
    backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
    borderBottom: '1px solid var(--lp-line-subtle)',
  },
  navInner: {
    maxWidth: 1200, margin: '0 auto', padding: '0 40px',
    height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  logo: { height: 32, display: 'block' },
  navRight: { display: 'flex', alignItems: 'center', gap: 20 },
  navLink: {
    background: 'none', border: 'none', color: 'var(--lp-ink-4)', fontSize: 13, fontWeight: 400,
    cursor: 'pointer', padding: 0, fontFamily: 'inherit',
  },
  navCta: {
    background: 'var(--lp-cta-bg)', color: 'var(--lp-cta-ink)', border: 'none',
    fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 6,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Hero
  hero: {
    position: 'relative',
    paddingTop: 148, paddingBottom: 108,
  },
  heroAtmosphere: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '100%',
    pointerEvents: 'none',
  },
  heroInner: {
    position: 'relative', zIndex: 1,
    maxWidth: 1200, margin: '0 auto', padding: '0 40px',
    display: 'flex', alignItems: 'flex-start', gap: 80,
  },
  heroText: {
    flex: '0 0 auto', maxWidth: 440, paddingTop: 28,
    display: 'flex', flexDirection: 'column', gap: 24,
  },
  heroEyebrow: {
    fontSize: 12, fontWeight: 500, color: 'var(--lp-ink-4)', letterSpacing: '0.04em',
    border: '1px solid var(--lp-line)', padding: '5px 14px',
    borderRadius: 100, width: 'fit-content',
  },
  h1: {
    fontSize: 68, fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.02em',
    color: 'var(--lp-ink)', margin: 0, whiteSpace: 'pre-line' as const,
    fontFamily: "'DM Serif Display', Georgia, 'Times New Roman', serif",
    fontStyle: 'italic',
  },
  heroSub: {
    fontSize: 16, lineHeight: 1.7, color: 'var(--lp-ink-3)', fontWeight: 400, margin: 0,
  },
  heroDivider: {
    width: 40, height: 1, background: 'var(--lp-line)',
  },
  heroCtas: {
    display: 'flex', alignItems: 'center', gap: 20,
  },
  ctaPrimary: {
    background: 'var(--lp-cta-bg)', color: 'var(--lp-cta-ink)', border: 'none', borderRadius: 8,
    fontSize: 14, fontWeight: 600, padding: '12px 24px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  ctaSecondary: {
    background: 'none', border: 'none', color: 'var(--lp-ink-4)', fontSize: 14, fontWeight: 400,
    cursor: 'pointer', fontFamily: 'inherit', padding: 0,
  },

  // Terminal
  terminal: {
    flex: 1, minWidth: 0, maxWidth: 680,
    background: 'var(--lp-bg-raised)', borderRadius: 12,
    border: '1px solid var(--lp-line)',
    boxShadow: 'var(--lp-terminal-shadow)',
    overflow: 'hidden',
  },
  termBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px',
    background: 'var(--lp-bg-inset)', borderBottom: '1px solid var(--lp-line-subtle)',
  },
  termDots: { display: 'flex', gap: 7 },
  termDot: { display: 'block', width: 10, height: 10, borderRadius: '50%' },
  termTitle: { fontSize: 11, fontWeight: 500, color: 'var(--lp-ink-5)' },
  termBody: { padding: 0 },

  // Operation header
  opHeader: {
    padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10,
    borderBottom: '1px solid var(--lp-line-subtle)',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: 12,
  },
  opFrom: { color: 'var(--lp-ink-2)', fontWeight: 500 },
  opArrow: { color: 'var(--lp-ink-5)' },
  opTo: { color: 'var(--lp-ink-4)' },
  cursor: { color: 'var(--lp-green)', fontSize: 10, marginLeft: 'auto' },

  // Log entries
  logEntries: { display: 'flex', flexDirection: 'column' },
  logEntry: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '12px 20px', borderBottom: '1px solid var(--lp-line-subtle)',
  },
  logMain: { display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 },
  logCheck: {
    color: 'var(--lp-green)', fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 1,
    display: 'inline-block',
  },
  logInfo: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  logTitleRow: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' as const },
  logId: {
    fontSize: 11, color: 'var(--lp-ink-4)',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
  },
  logTitle: { fontSize: 13, color: 'var(--lp-ink-2)', fontWeight: 500 },
  logMeta: { fontSize: 11, color: 'var(--lp-ink-5)' },
  logTime: {
    fontSize: 11, color: 'var(--lp-ink-5)', flexShrink: 0, marginLeft: 16,
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    marginTop: 2,
  },

  // Summary bar
  summaryBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', background: 'var(--lp-green-bg)',
    borderTop: '1px solid var(--lp-green-line)',
  },
  summaryLeft: { display: 'flex', alignItems: 'baseline', gap: 8 },
  summaryDone: { fontSize: 12, fontWeight: 600, color: 'var(--lp-green)' },
  summaryDetail: { fontSize: 11, color: 'var(--lp-ink-4)' },
  summaryBadge: {
    fontSize: 10, fontWeight: 600, color: 'var(--lp-green)', textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    background: 'var(--lp-green-badge)', border: '1px solid var(--lp-green-line)',
    padding: '3px 10px', borderRadius: 4,
  },

  // Social proof
  proofSection: {
    padding: '108px 0', borderTop: '1px solid var(--lp-line-subtle)',
    borderBottom: '1px solid var(--lp-line-subtle)',
  },
  quoteDecor: {
    fontSize: 80, fontFamily: "'DM Serif Display', Georgia, serif",
    color: 'var(--lp-quote-mark)', lineHeight: 0.6, display: 'block', marginBottom: 20,
  },
  quote: {
    fontSize: 26, fontWeight: 400, lineHeight: 1.55, color: 'var(--lp-ink-3)',
    fontFamily: "'DM Serif Display', Georgia, serif",
    fontStyle: 'italic', margin: 0, maxWidth: 600,
  },
  quoteAuthor: {
    fontSize: 13, color: 'var(--lp-ink-5)', fontWeight: 400, margin: '28px 0 0 0',
    letterSpacing: '0.01em',
  },

  // Sections
  section: { padding: '108px 0' },
  sectionInner: { maxWidth: 1200, margin: '0 auto', padding: '0 40px' },
  h2: {
    fontSize: 32, fontWeight: 400, color: 'var(--lp-ink)', letterSpacing: '-0.02em',
    marginBottom: 56, margin: '0 0 56px 0', lineHeight: 1.2,
    fontFamily: "'DM Serif Display', Georgia, serif",
  },
  specGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '44px 56px',
  },
  specItem: {
    display: 'flex', flexDirection: 'column', gap: 8,
    paddingLeft: 20, borderLeft: '1px solid var(--lp-line)',
  },
  specLabel: { fontSize: 14, fontWeight: 600, color: 'var(--lp-ink-2)', letterSpacing: '-0.01em' },
  specDetail: { fontSize: 13, lineHeight: 1.65, color: 'var(--lp-ink-4)' },

  // Pricing
  pricingSection: { padding: '108px 0', background: 'var(--lp-bg-pricing)' },
  priceCard: {
    background: 'var(--lp-bg-raised)', border: '1px solid var(--lp-line)',
    borderRadius: 14, padding: '52px 44px', textAlign: 'center',
  },
  pricePlan: {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const,
    letterSpacing: '0.08em', color: 'var(--lp-ink-5)', display: 'block', marginBottom: 28,
  },
  priceRow: {
    display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 2,
  },
  priceCurrency: { fontSize: 18, fontWeight: 400, color: 'var(--lp-ink-4)' },
  priceNumber: {
    fontSize: 60, fontWeight: 400, color: 'var(--lp-ink)', letterSpacing: '-0.03em', lineHeight: 1,
    fontFamily: "'DM Serif Display', Georgia, serif",
  },
  priceCents: {
    fontSize: 24, fontWeight: 400, color: 'var(--lp-ink)',
    fontFamily: "'DM Serif Display', Georgia, serif",
  },
  pricePeriod: { fontSize: 14, fontWeight: 400, color: 'var(--lp-ink-4)', marginLeft: 6 },
  priceDivider: {
    height: 1, background: 'var(--lp-line)', margin: '32px 0',
  },
  priceList: {
    listStyle: 'none', padding: 0, margin: '0 0 40px 0',
    display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'left',
  },
  priceItem: {
    fontSize: 14, color: 'var(--lp-ink-3)', fontWeight: 400,
    display: 'flex', alignItems: 'center', gap: 12,
  },
  priceItemCheck: { color: 'var(--lp-green)', fontSize: 12, fontWeight: 700, flexShrink: 0 },
  priceCta: {
    width: '100%', background: 'var(--lp-cta-bg)', color: 'var(--lp-cta-ink)', border: 'none',
    borderRadius: 8, fontSize: 15, fontWeight: 600, padding: '14px 28px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  priceNote: {
    fontSize: 12, color: 'var(--lp-ink-5)', marginTop: 18, marginBottom: 0, fontWeight: 400,
  },

  // Footer
  footer: { borderTop: '1px solid var(--lp-line-subtle)', padding: '24px 0' },
  footerInner: {
    maxWidth: 1200, margin: '0 auto', padding: '0 40px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  footerLogo: { height: 22, opacity: 0.4, display: 'block' },
  footerCopy: { fontSize: 11, color: 'var(--lp-ink-5)' },
  footerLink: {
    background: 'none', border: 'none', color: 'var(--lp-ink-5)', fontSize: 12, fontWeight: 400,
    cursor: 'pointer', fontFamily: 'inherit', padding: 0,
  },
};
