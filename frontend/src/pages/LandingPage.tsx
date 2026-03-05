interface Props {
  onNavigateToLogin: () => void;
  onNavigateToSignup: () => void;
}

export default function LandingPage({ onNavigateToLogin, onNavigateToSignup }: Props) {

  return (
    <div style={styles.page}>
      <style>{cssText}</style>

      {/* ==================== NAV ==================== */}
      <nav style={styles.nav}>
        <div className="lp-nav-inner" style={styles.navInner}>
          <span style={styles.logo}>Copy Anuncios</span>
          <div style={styles.navActions}>
            <button className="lp-nav-link" onClick={onNavigateToLogin} style={styles.navLink}>
              Entrar
            </button>
            <button className="lp-nav-cta" onClick={onNavigateToSignup} style={styles.navCta}>
              Começar
            </button>
          </div>
        </div>
      </nav>

      {/* ==================== HERO ==================== */}
      <section style={styles.hero}>
        {/* Hero text + CTAs */}
        <div style={styles.heroContent}>
          <p style={styles.heroBadge}>Para sellers que gerenciam múltiplas contas</p>

          <h1 className="lp-hero-title" style={styles.heroTitle}>
            Copie anúncios entre contas em segundos
          </h1>

          <p style={styles.heroSub}>
            Sem reenviar fotos, atributos e compatibilidades uma por uma.
            Copie dezenas de anúncios por vez.
          </p>

          <div className="lp-hero-ctas" style={styles.heroCtas}>
            <button className="lp-cta-primary" onClick={onNavigateToSignup} style={styles.ctaPrimary}>
              Criar conta
            </button>
            <button className="lp-cta-ghost" onClick={onNavigateToLogin} style={styles.ctaGhost}>
              Já tenho conta
            </button>
          </div>
        </div>

        {/* Product mockup — static CSS representation of the copy interface */}
        <div style={styles.mockupWrap}>
          <div className="lp-mockup" style={styles.mockup}>
            {/* Mockup top bar */}
            <div style={styles.mockupBar}>
              <div style={styles.mockupBarDots}>
                <span style={styles.mockupDot} />
                <span style={styles.mockupDot} />
                <span style={styles.mockupDot} />
              </div>
              <span style={styles.mockupBarTitle}>Copiar anúncios</span>
              <div style={{ width: 36 }} />
            </div>

            {/* Mockup body */}
            <div className="lp-mockup-body" style={styles.mockupBody}>
              {/* Left column — Origem */}
              <div style={styles.mockupCol}>
                <p style={styles.mockupColLabel}>Origem</p>
                <div style={styles.mockupSelector}>
                  <span style={styles.mockupSelectorDot} />
                  <span style={styles.mockupSelectorText}>loja_principal</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 'auto', opacity: 0.3 }}>
                    <path d="M2 3.5L5 6.5L8 3.5" stroke="#f2f2f2" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>

                <p style={styles.mockupFieldLabel}>IDs dos anúncios</p>
                <div style={styles.mockupTextarea}>
                  <span style={styles.mockupItem}>MLB1234567890</span>
                  <span style={styles.mockupItem}>MLB9876543210</span>
                  <span style={styles.mockupItem}>MLB5551239870</span>
                </div>
              </div>

              {/* Right column — Destino */}
              <div style={styles.mockupCol}>
                <p style={styles.mockupColLabel}>Destino</p>

                <div style={styles.mockupDestList}>
                  {[
                    { name: 'loja_sul', checked: true },
                    { name: 'loja_norte', checked: true },
                    { name: 'loja_sp', checked: true },
                  ].map((seller) => (
                    <div key={seller.name} style={styles.mockupDestItem}>
                      <div style={styles.mockupCheckbox}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 2.5" stroke="#23D8D3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span style={styles.mockupDestName}>{seller.name}</span>
                    </div>
                  ))}
                </div>

                {/* Progress indicator */}
                <div style={styles.mockupProgress}>
                  <div style={styles.mockupProgressBar}>
                    <div style={styles.mockupProgressFill} />
                  </div>
                  <div style={styles.mockupProgressRow}>
                    <span style={styles.mockupProgressLabel}>3/3 copiados</span>
                    <span style={styles.mockupSuccessBadge}>
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path d="M1.5 4.5l2 2L7.5 2" stroke="#23D8D3" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Concluído
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== HOW IT WORKS ==================== */}
      <section style={styles.section}>
        <div className="lp-section-inner" style={styles.sectionInner}>
          <h2 className="lp-section-title" style={styles.sectionTitle}>Três passos</h2>

          <div className="lp-steps" style={styles.steps}>
            {[
              {
                num: '1',
                title: 'Conecte suas contas',
                desc: 'Autorize via Mercado Livre. Seguro e instantâneo.',
              },
              {
                num: '2',
                title: 'Cole IDs ou busque por SKU',
                desc: 'Veja exatamente o que será copiado antes de confirmar.',
              },
              {
                num: '3',
                title: 'Copie em massa',
                desc: 'Fotos, atributos, variações, compatibilidades. Tudo copiado em segundos.',
              },
            ].map((step) => (
              <div key={step.num} className="lp-step" style={styles.step}>
                <span style={styles.stepNum}>{step.num}</span>
                <div style={styles.stepText}>
                  <h3 style={styles.stepTitle}>{step.title}</h3>
                  <p style={styles.stepDesc}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== PRICING ==================== */}
      <section style={{ ...styles.section, ...styles.sectionAlt }}>
        <div className="lp-section-inner" style={styles.sectionInner}>
          <h2 className="lp-section-title" style={styles.sectionTitle}>Preço único</h2>

          <div className="lp-pricing-card" style={styles.pricingCard}>
            <div style={styles.pricingHeader}>
              <span style={styles.pricingPlan}>Plano Único</span>
              <div style={styles.pricingAmount}>
                <span style={styles.pricingCurrency}>R$</span>
                <span style={styles.pricingNumber}>349</span>
                <span style={styles.pricingCents}>,90</span>
                <span style={styles.pricingPeriod}>/mês</span>
              </div>
            </div>

            <div style={styles.pricingDivider} />

            <div style={styles.pricingFeatures}>
              {[
                'Cópias ilimitadas',
                'Compatibilidades veiculares',
                'Múltiplas contas do Mercado Livre',
                'Usuários e permissões',
                'Suporte por email',
              ].map((feature) => (
                <div key={feature} style={styles.pricingFeatureRow}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M13.3 4.3L6 11.6L2.7 8.3" stroke="#23D8D3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={styles.pricingFeatureText}>{feature}</span>
                </div>
              ))}
            </div>

            <button className="lp-pricing-cta" onClick={onNavigateToSignup} style={styles.pricingCta}>
              Começar agora
            </button>

            <p style={styles.pricingNote}>Sem contrato. Cancele quando quiser.</p>
          </div>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer style={styles.footer}>
        <div className="lp-footer-inner" style={styles.footerInner}>
          <span style={styles.footerLogo}>Copy Anuncios</span>
          <span style={styles.footerCopy}>
            &copy; {new Date().getFullYear()} Copy Anuncios. Todos os direitos reservados.
          </span>
          <button className="lp-footer-link" onClick={onNavigateToLogin} style={styles.footerLink}>
            Entrar
          </button>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Scoped CSS                                                         */
/* ------------------------------------------------------------------ */
const cssText = `
  @keyframes lp-hero-enter {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .lp-cta-primary:hover {
    background: #1fc9c5 !important;
  }
  .lp-cta-primary:active {
    transform: scale(0.97);
  }

  .lp-cta-ghost:hover {
    border-color: rgba(255, 255, 255, 0.2) !important;
    color: #f2f2f2 !important;
  }

  .lp-nav-cta:hover {
    background: #1fc9c5 !important;
  }

  .lp-nav-link:hover {
    color: #f2f2f2 !important;
  }

  .lp-pricing-cta:hover {
    background: #1fc9c5 !important;
  }
  .lp-pricing-cta:active {
    transform: scale(0.97);
  }

  .lp-footer-link:hover {
    color: #f2f2f2 !important;
  }

  @media (max-width: 768px) {
    .lp-hero-title {
      font-size: 36px !important;
      line-height: 1.1 !important;
    }
    .lp-hero-ctas {
      flex-direction: column !important;
      align-items: stretch !important;
    }
    .lp-steps {
      flex-direction: column !important;
      gap: 36px !important;
    }
    .lp-section-inner {
      padding: 0 20px !important;
    }
    .lp-nav-inner {
      padding: 0 20px !important;
    }
    .lp-pricing-card {
      padding: 32px 24px !important;
    }
    .lp-footer-inner {
      flex-direction: column !important;
      gap: 12px !important;
      text-align: center !important;
    }
    .lp-mockup {
      margin: 0 20px !important;
    }
    .lp-mockup-body {
      grid-template-columns: 1fr !important;
    }
    .lp-section-title {
      font-size: 28px !important;
    }
  }

  @media (max-width: 560px) {
    .lp-hero-title {
      font-size: 30px !important;
    }
  }
`;

/* ------------------------------------------------------------------ */
/*  Style objects                                                      */
/* ------------------------------------------------------------------ */
const styles: Record<string, React.CSSProperties> = {
  page: {
    background: '#0a0a0a',
    color: '#f2f2f2',
    minHeight: '100vh',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    overflowX: 'hidden',
  },

  /* Nav */
  nav: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    background: 'rgba(10, 10, 10, 0.85)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  navInner: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '0 40px',
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: '#f2f2f2',
  },
  navActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  navLink: {
    background: 'none',
    border: 'none',
    color: '#888888',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    padding: '6px 12px',
    borderRadius: 6,
    transition: 'color 0.15s',
    fontFamily: 'inherit',
  },
  navCta: {
    background: '#23D8D3',
    color: '#0a0a0a',
    border: 'none',
    fontSize: 13,
    fontWeight: 600,
    padding: '7px 16px',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background 0.15s',
    fontFamily: 'inherit',
  },

  /* Hero */
  hero: {
    paddingTop: 128,
    paddingBottom: 96,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  heroContent: {
    maxWidth: 640,
    textAlign: 'center',
    padding: '0 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 24,
    animation: 'lp-hero-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
  },
  heroBadge: {
    fontSize: 13,
    fontWeight: 400,
    color: '#666666',
    margin: 0,
    letterSpacing: '0',
  },
  heroTitle: {
    fontSize: 52,
    fontWeight: 700,
    lineHeight: 1.08,
    letterSpacing: '-0.035em',
    color: '#f2f2f2',
    margin: 0,
    maxWidth: 600,
  },
  heroSub: {
    fontSize: 17,
    lineHeight: 1.65,
    color: '#888888',
    maxWidth: 480,
    margin: 0,
    fontWeight: 400,
  },
  heroCtas: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  ctaPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 28px',
    background: '#23D8D3',
    color: '#0a0a0a',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s, transform 0.1s',
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
  },
  ctaGhost: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 28px',
    background: 'transparent',
    color: '#888888',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'border-color 0.15s, color 0.15s',
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
  },

  /* Product mockup */
  mockupWrap: {
    width: '100%',
    maxWidth: 760,
    marginTop: 72,
    padding: '0 24px',
    boxSizing: 'border-box',
  },
  mockup: {
    background: '#111111',
    border: '1px solid rgba(255, 255, 255, 0.07)',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 32px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.04)',
  },
  mockupBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    background: '#0e0e0e',
  },
  mockupBarDots: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  mockupDot: {
    display: 'block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.1)',
  },
  mockupBarTitle: {
    fontSize: 12,
    fontWeight: 500,
    color: '#555555',
    letterSpacing: '-0.01em',
  },
  mockupBody: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 0,
  },
  mockupCol: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  mockupColLabel: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: '#555555',
    margin: 0,
  },
  mockupSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: '#0a0a0a',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
  },
  mockupSelectorDot: {
    display: 'block',
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#23D8D3',
    flexShrink: 0,
  },
  mockupSelectorText: {
    fontSize: 12,
    fontWeight: 500,
    color: '#cccccc',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
  },
  mockupFieldLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: '#555555',
    margin: '4px 0 0 0',
  },
  mockupTextarea: {
    padding: '10px 12px',
    background: '#0a0a0a',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    minHeight: 80,
  },
  mockupItem: {
    fontSize: 12,
    color: '#888888',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    letterSpacing: '0.01em',
  },

  /* Right col — destination + progress */
  mockupDestList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    flex: 1,
  },
  mockupDestItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    background: '#0a0a0a',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
  },
  mockupCheckbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    background: 'rgba(35, 216, 211, 0.12)',
    border: '1px solid rgba(35, 216, 211, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  mockupDestName: {
    fontSize: 12,
    fontWeight: 500,
    color: '#cccccc',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
  },
  mockupProgress: {
    marginTop: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  mockupProgressBar: {
    height: 3,
    background: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 99,
    overflow: 'hidden',
  },
  mockupProgressFill: {
    height: '100%',
    width: '100%',
    background: '#23D8D3',
    borderRadius: 99,
  },
  mockupProgressRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mockupProgressLabel: {
    fontSize: 11,
    color: '#666666',
    fontVariantNumeric: 'tabular-nums',
  },
  mockupSuccessBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    fontWeight: 500,
    color: '#23D8D3',
    background: 'rgba(35, 216, 211, 0.08)',
    border: '1px solid rgba(35, 216, 211, 0.15)',
    borderRadius: 4,
    padding: '2px 7px',
  },

  /* Sections */
  section: {
    padding: '100px 0',
  },
  sectionAlt: {
    background: '#0e0e0e',
  },
  sectionInner: {
    maxWidth: 760,
    margin: '0 auto',
    padding: '0 40px',
  },
  sectionTitle: {
    fontSize: 32,
    fontWeight: 700,
    lineHeight: 1.15,
    letterSpacing: '-0.03em',
    color: '#f2f2f2',
    marginBottom: 56,
    margin: '0 0 56px 0',
  },

  /* Steps — plain numbered list, no cards */
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 28,
    padding: '32px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  stepNum: {
    fontSize: 13,
    fontWeight: 600,
    color: '#444444',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.01em',
    minWidth: 20,
    paddingTop: 2,
  },
  stepText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  stepTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: '#f2f2f2',
    letterSpacing: '-0.02em',
    lineHeight: 1.3,
    margin: 0,
  },
  stepDesc: {
    fontSize: 15,
    lineHeight: 1.65,
    color: '#777777',
    margin: 0,
    fontWeight: 400,
  },

  /* Pricing */
  pricingCard: {
    maxWidth: 420,
    margin: '0 auto',
    padding: '40px 36px',
    borderRadius: 14,
    background: 'rgba(255, 255, 255, 0.025)',
    border: '1px solid rgba(255, 255, 255, 0.07)',
  },
  pricingHeader: {
    textAlign: 'center',
    marginBottom: 28,
  },
  pricingPlan: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: '#555555',
    display: 'block',
    marginBottom: 20,
  },
  pricingAmount: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 2,
  },
  pricingCurrency: {
    fontSize: 16,
    fontWeight: 500,
    color: '#888888',
  },
  pricingNumber: {
    fontSize: 52,
    fontWeight: 700,
    color: '#f2f2f2',
    letterSpacing: '-0.04em',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  pricingCents: {
    fontSize: 22,
    fontWeight: 600,
    color: '#f2f2f2',
    letterSpacing: '-0.02em',
  },
  pricingPeriod: {
    fontSize: 14,
    fontWeight: 400,
    color: '#666666',
    marginLeft: 4,
  },
  pricingDivider: {
    height: 1,
    background: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 28,
  },
  pricingFeatures: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    marginBottom: 36,
  },
  pricingFeatureRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  pricingFeatureText: {
    fontSize: 14,
    color: '#bbbbbb',
    fontWeight: 400,
  },
  pricingCta: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '14px 28px',
    background: '#23D8D3',
    color: '#0a0a0a',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s, transform 0.1s',
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
  },
  pricingNote: {
    fontSize: 12,
    color: '#555555',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 0,
    fontWeight: 400,
  },

  /* Footer */
  footer: {
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    padding: '24px 0',
  },
  footerInner: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '0 40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerLogo: {
    fontSize: 13,
    fontWeight: 600,
    color: '#444444',
    letterSpacing: '-0.01em',
  },
  footerCopy: {
    fontSize: 12,
    color: '#3d3d3d',
  },
  footerLink: {
    background: 'none',
    border: 'none',
    color: '#555555',
    fontSize: 13,
    fontWeight: 400,
    cursor: 'pointer',
    transition: 'color 0.15s',
    fontFamily: 'inherit',
    padding: 0,
  },
};
