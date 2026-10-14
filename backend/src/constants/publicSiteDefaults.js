const DEFAULT_PUBLIC_SITE_TITLE = 'Picflow｜摄影作品展示与交付';

const DEFAULT_PUBLIC_SITE_HTML = `
<section class="hero" id="welcome">
  <div class="hero__inner">
    <span class="hero__badge">Picflow 作品展示</span>
    <h1>用影像讲述 {{company_name}} 的故事</h1>
    <p class="hero__lead">{{company_tagline}}</p>
    <div class="hero__cta">
      <a href="#features" class="button button--primary">了解功能</a>
      <a href="#collections" class="button button--ghost">浏览作品</a>
    </div>
    <dl class="hero__stats">
      <div>
        <dt>专属访问</dt>
        <dd>为每位客户提供安全的访问链接</dd>
      </div>
      <div>
        <dt>精选交付</dt>
        <dd>快速整理客户选中的照片</dd>
      </div>
      <div>
        <dt>品牌呈现</dt>
        <dd>使用符合工作室风格的颜色、字体和标志</dd>
      </div>
    </dl>
  </div>
  <div class="hero__visual">
    <article class="deck deck--primary">
      <header class="deck__header">
        <img src="{{brand_logo_url}}" alt="{{company_name}} logo" class="deck__logo" loading="lazy" decoding="async" />
        <span class="deck__title">Picflow 摄影作品</span>
      </header>
      <ul class="deck__list">
        <li>清晰的作品展示</li>
        <li>客户上传与选片</li>
        <li>安全的高清照片下载</li>
      </ul>
    </article>
    <article class="deck deck--secondary">
      <p class="deck__quote">“从打开作品链接的那一刻起，客户就能轻松浏览、选片并下载照片。”</p>
      <p class="deck__author">— 摄影工作室</p>
    </article>
  </div>
</section>

<section class="features" id="features">
  <div class="section-head">
    <span class="section-badge">为什么选择 Picflow</span>
    <h2>让作品展示与交付流程更简单</h2>
    <p>通过品牌化、安全且适配手机的作品页面，为客户提供顺畅的选片体验。</p>
  </div>
  <div class="feature-grid">
    <article>
      <h3>统一的视觉风格</h3>
      <p>作品页面会自动应用你的 Picflow 主题、字体和颜色设置。</p>
    </article>
    <article>
      <h3>灵活展示作品</h3>
      <p>整理照片分类，突出重点作品，并添加客户评价。</p>
    </article>
    <article>
      <h3>安心分享</h3>
      <p>使用访问密码、有效期和下载保护，控制作品的访问方式。</p>
    </article>
  </div>
</section>

<section class="workflow" id="workflow">
  <div class="workflow__content">
    <h2>几步即可开始</h2>
    <ol class="workflow__steps">
      <li>
        <h4>设置品牌样式</h4>
        <p>设置一次标志、颜色和联系方式，即可应用到作品页面。</p>
      </li>
      <li>
        <h4>整理项目内容</h4>
        <p>按分类展示照片，也可以突出封面和重要时刻。</p>
      </li>
      <li>
        <h4>分享给客户</h4>
        <p>发送项目链接，让客户浏览、选片并获取最终照片。</p>
      </li>
    </ol>
  </div>
  <div class="workflow__media">
    <figure class="workflow__browser">
      <img src="/picflow-icon.png" alt="Picflow 界面" loading="lazy" decoding="async" />
      <figcaption>Picflow 工作台</figcaption>
    </figure>
  </div>
</section>

<section class="collections" id="collections">
  <div class="section-head">
    <span class="section-badge">作品展示</span>
    <h2>按项目整理并分享摄影作品</h2>
    <p>用清晰的内容结构介绍项目，让客户知道如何浏览和下载。</p>
  </div>
  <div class="collection-showcase">
    <article>
      <h3>精选作品</h3>
      <p>通过适配不同屏幕的卡片展示代表作品或合作项目。</p>
    </article>
    <article>
      <h3>清晰的客户流程</h3>
      <p>引导客户完成浏览、选片和下载。</p>
    </article>
  </div>
</section>

<section class="stories" id="stories">
  <div class="section-head section-head--center">
    <span class="section-badge">客户评价</span>
    <h2>让每次交付都更顺畅</h2>
  </div>
  <div class="story-grid">
    <figure>
      <blockquote>“从打开页面到下载照片，整个流程都很清晰，客户也能很快找到喜欢的作品。”</blockquote>
      <figcaption>— 客户反馈</figcaption>
    </figure>
    <figure>
      <blockquote>“项目页面让照片展示更有条理，客户可以专注于挑选和交流。”</blockquote>
      <figcaption>— 摄影师反馈</figcaption>
    </figure>
  </div>
</section>

<section class="cta" id="contact">
  <div class="cta__inner">
    <div>
        <h2>准备好分享你的作品了吗？</h2>
        <p>创建符合工作室风格的 Picflow 页面，开始向客户交付摄影作品。</p>
    </div>
    <div class="cta__actions">
      <a href="#features" class="button button--ghost">查看功能</a>
    </div>
  </div>
</section>

<footer class="site-footer" id="legal">
  <div class="footer-inner">
    <div>
      <h2>{{company_name}}</h2>
      <p>由 Picflow 提供支持，让作品整理与交付更加轻松。</p>
    </div>
  </div>
</footer>
`;

const DEFAULT_PUBLIC_SITE_CSS = `
*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  background: linear-gradient(180deg, var(--brand-background), var(--brand-surface, #ffffff) 55%);
  color: var(--brand-text);
  -webkit-font-smoothing: antialiased;
}

a {
  color: inherit;
  text-decoration: none;
}

img {
  max-width: 100%;
  display: block;
}

.site-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, var(--brand-elevated, rgba(15, 23, 42, 0.03)), transparent 65%);
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--brand-surface, rgba(255, 255, 255, 0.92));
  backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--brand-border, rgba(15, 23, 42, 0.08));
}

.header-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-logo {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  object-fit: contain;
  background: rgba(148, 163, 184, 0.12);
  padding: 6px;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.brand-label {
  margin: 0;
  font-weight: 600;
  font-size: 1rem;
  letter-spacing: -0.01em;
  color: var(--brand-text);
}

.brand-tagline {
  margin: 0;
  font-size: 0.85rem;
  color: var(--brand-muted-text, rgba(15, 23, 42, 0.65));
}

.site-nav {
  display: flex;
  gap: 1rem;
  font-size: 0.95rem;
  color: var(--brand-muted-text, rgba(15, 23, 42, 0.65));
}

.site-nav a {
  position: relative;
  padding: 0.25rem 0;
}

.site-nav a::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -6px;
  width: 100%;
  height: 2px;
  background: transparent;
  transition: background 0.2s ease;
}

.site-nav a:hover::after {
  background: var(--brand-primary);
}

.site-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rem;
  padding: 2.5rem 1.5rem 4rem;
}

@media (min-width: 960px) {
  .site-main {
    padding: 3rem 0 5rem;
    gap: 5rem;
  }

  .hero,
  .features,
  .workflow,
  .collections,
  .stories,
  .cta {
    max-width: 1100px;
    margin: 0 auto;
  }
}

.hero {
  display: grid;
  gap: 2.5rem;
  align-items: center;
}

@media (min-width: 960px) {
  .hero {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  }
}

.hero__inner {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.hero__badge {
  display: inline-flex;
  align-items: center;
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: rgba(34, 197, 94, 0.18);
  color: var(--brand-primary);
}

.hero h1 {
  margin: 0;
  font-size: clamp(2.65rem, 4.8vw, 3.6rem);
  letter-spacing: -0.02em;
  line-height: 1.08;
}

.hero__lead {
  margin: 0;
  max-width: 32rem;
  color: var(--brand-muted-text, rgba(15, 23, 42, 0.72));
  font-size: 1.05rem;
  line-height: 1.6;
}

.hero__cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
}

.hero__stats {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  margin: 0;
  padding: 0;
}

.hero__stats dt {
  font-weight: 600;
  color: var(--brand-text);
}

.hero__stats dd {
  margin: 0.35rem 0 0;
  color: var(--brand-muted-text, rgba(15, 23, 42, 0.6));
  font-size: 0.95rem;
}

.hero__visual {
  display: grid;
  gap: 1.5rem;
}

.deck {
  border-radius: 20px;
  padding: 1.75rem;
  background: var(--brand-surface, #fff);
  box-shadow: 0 35px 60px -35px rgba(15, 23, 42, 0.35);
  border: 1px solid var(--brand-border, rgba(15, 23, 42, 0.08));
  display: grid;
  gap: 1.35rem;
}

.deck--primary {
  border-color: rgba(34, 197, 94, 0.2);
}

.deck--secondary {
  background: linear-gradient(135deg, var(--brand-surface, #fff), var(--brand-elevated, rgba(15, 23, 42, 0.03)));
}

.deck__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.deck__logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(34, 197, 94, 0.12);
  padding: 6px;
}

.deck__title {
  font-weight: 600;
  letter-spacing: -0.01em;
}

.deck__list {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.65rem;
  color: var(--brand-muted-text, rgba(15, 23, 42, 0.68));
}

.deck__quote {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.7;
  color: var(--brand-text, rgba(15, 23, 42, 0.78));
}

.deck__author {
  margin: 0;
  font-weight: 600;
  color: var(--brand-text);
}

.section-head {
  display: grid;
  gap: 1rem;
  max-width: 640px;
}

.section-head--center {
  text-align: center;
  margin: 0 auto;
}

.section-badge {
  display: inline-flex;
  padding: 0.45rem 0.9rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: rgba(34, 197, 94, 0.14);
  color: var(--brand-primary);
}

.section-head h2 {
  margin: 0;
  font-size: clamp(2rem, 3vw, 2.6rem);
  letter-spacing: -0.018em;
}

.section-head p {
  margin: 0;
  color: var(--brand-muted-text, rgba(15, 23, 42, 0.65));
}

.feature-grid {
  display: grid;
  gap: 1.5rem;
  margin-top: 2.5rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.feature-grid article {
  background: var(--brand-surface, rgba(255, 255, 255, 0.9));
  border-radius: 16px;
  padding: 1.75rem;
  border: 1px solid var(--brand-border, rgba(15, 23, 42, 0.08));
  box-shadow: 0 18px 40px -30px rgba(15, 23, 42, 0.28);
}

.workflow {
  display: grid;
  gap: 2rem;
  align-items: center;
}

@media (min-width: 960px) {
  .workflow {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  }
}

.workflow__steps {
  margin: 1.75rem 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 1.5rem;
}

.workflow__steps h4 {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
  color: var(--brand-text);
}

.workflow__steps p {
  margin: 0;
  color: var(--brand-muted-text, rgba(15, 23, 42, 0.65));
}

.workflow__browser {
  margin: 0;
  background: var(--brand-elevated, rgba(15, 23, 42, 0.05));
  border-radius: 20px;
  border: 1px solid var(--brand-border, rgba(15, 23, 42, 0.1));
  padding: 2rem;
  text-align: center;
  color: var(--brand-muted-text, rgba(15, 23, 42, 0.55));
  font-size: 0.85rem;
}

.collection-showcase {
  margin-top: 2.5rem;
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.collection-showcase article {
  background: var(--brand-surface, rgba(255, 255, 255, 0.92));
  border-radius: 18px;
  border: 1px solid var(--brand-border, rgba(15, 23, 42, 0.08));
  padding: 1.5rem;
  box-shadow: 0 18px 45px -32px rgba(15, 23, 42, 0.3);
}

.story-grid {
  margin-top: 2.5rem;
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.story-grid figure {
  margin: 0;
  padding: 1.75rem;
  background: var(--brand-surface, rgba(255, 255, 255, 0.95));
  border-radius: 20px;
  border: 1px solid var(--brand-border, rgba(15, 23, 42, 0.08));
  box-shadow: 0 18px 42px -32px rgba(15, 23, 42, 0.28);
}

.story-grid blockquote {
  margin: 0 0 1.2rem;
  font-size: 1.05rem;
  line-height: 1.7;
  color: var(--brand-text, rgba(15, 23, 42, 0.8));
}

.story-grid figcaption {
  font-weight: 600;
  color: var(--brand-muted-text, rgba(15, 23, 42, 0.7));
}

.cta {
  background: linear-gradient(135deg, var(--brand-primary), var(--brand-accent));
  color: #fff;
  border-radius: 28px;
  padding: clamp(2.5rem, 5vw, 3.5rem);
}

.cta__inner {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  max-width: 720px;
}

.cta__inner h2 {
  margin: 0;
  font-size: clamp(2rem, 3vw, 2.5rem);
}

.cta__inner p {
  margin: 0;
  font-size: 1.05rem;
  opacity: 0.95;
}

.cta__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.85rem 1.75rem;
  border-radius: 999px;
  font-weight: 600;
  transition: transform 160ms ease, box-shadow 200ms ease, background 200ms ease, color 200ms ease;
  border: 1px solid transparent;
}

.button:hover {
  transform: translateY(-2px);
}

.button--primary {
  background: var(--brand-primary);
  color: #fff;
  box-shadow: 0 25px 45px -25px rgba(15, 23, 42, 0.55);
}

.button--primary:hover {
  background: var(--brand-accent);
}

.button--ghost {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.45);
  color: inherit;
}

.site-footer {
  padding: 3rem 1.5rem;
  background: var(--brand-elevated, rgba(15, 23, 42, 0.05));
  border-top: 1px solid var(--brand-border, rgba(15, 23, 42, 0.08));
}

.footer-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.footer-inner h2 {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
}

.footer-inner p {
  margin: 0;
  color: var(--brand-muted-text, rgba(15, 23, 42, 0.65));
  line-height: 1.6;
}

@media (max-width: 960px) {
  .site-nav {
    display: none;
  }

  .hero__visual {
    grid-template-columns: minmax(0, 1fr);
  }

  .workflow {
    grid-template-columns: minmax(0, 1fr);
  }

  .cta__inner {
    gap: 1.5rem;
  }
}
`;

module.exports = {
  DEFAULT_PUBLIC_SITE_TITLE,
  DEFAULT_PUBLIC_SITE_HTML,
  DEFAULT_PUBLIC_SITE_CSS,
};
