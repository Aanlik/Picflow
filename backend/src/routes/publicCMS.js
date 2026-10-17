const express = require('express');
const { db } = require('../database/db');
const logger = require('../utils/logger');
const router = express.Router();

const DEFAULT_PAGE_TITLES = {
  'gallery-not-found': { 'zh-CN': '相册未找到', en: 'Gallery Not Found' },
  'not-found': { 'zh-CN': '页面未找到', en: 'Page Not Found' },
  impressum: { 'zh-CN': '法律声明', en: 'Legal Notice' },
  datenschutz: { 'zh-CN': '隐私政策', en: 'Privacy Policy' },
};

// Get public CMS page
router.get('/pages/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const lang = /^zh(?:-|$)/i.test(String(req.query.lang || '')) ? 'zh-CN' : 'en';
    
    const page = await db('cms_pages').where('slug', slug).first();
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    // Return the appropriate language version
    const title = (lang === 'zh-CN' ? (page.title_zh || page.title_en) : page.title_en)
      || DEFAULT_PAGE_TITLES[slug]?.[lang]
      || (lang === 'zh-CN' ? '信息页面' : 'Information page');
    const content = lang === 'zh-CN' ? (page.content_zh || page.content_en) : page.content_en;
    
    res.json({
      title,
      content,
      slug: page.slug,
      // Per-page logo override (#324). Null means "fall back to global
      // branding logo" — the consumer decides.
      logo_url: page.logo_url || null,
      // Per-page external-URL override. When use_external_url is true and
      // external_url is set, consumers should redirect / link out instead
      // of rendering the internal title/content. external_url is gated by
      // use_external_url so the public response never exposes a URL the
      // admin has saved-but-disabled (the value stays in the DB so the
      // toggle can be flipped back on, but it shouldn't leak via the API).
      use_external_url: !!page.use_external_url,
      external_url: page.use_external_url && page.external_url ? page.external_url : null,
      updated_at: page.updated_at
    });
  } catch (error) {
    logger.error('Error fetching public CMS page:', error);
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

module.exports = router;
