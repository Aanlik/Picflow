'use strict';

// Some databases can retain the original bundled CSS if migration 259 was
// skipped during an interrupted upgrade. Only strip comments when the content
// still carries a bundled legacy marker; do not erase notes added by an admin
// after the earlier cleanup.
const { normalizeTemplateName, removeCssComments } = require('./259_localize_css_templates');

const LEGACY_TEMPLATE_MARKER = /PicPeak Custom CSS Template|#1131/i;

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('css_templates'))) return;

  const templates = await knex('css_templates').select('id', 'name', 'css_content');
  for (const template of templates) {
    const localizedName = normalizeTemplateName(template.name);
    const hasLegacyContent = typeof template.css_content === 'string'
      && LEGACY_TEMPLATE_MARKER.test(template.css_content);
    const cssContent = hasLegacyContent
      ? removeCssComments(template.css_content)
      : template.css_content;
    const updates = {};

    if (localizedName && localizedName !== template.name) updates.name = localizedName;
    if (hasLegacyContent && cssContent !== template.css_content) updates.css_content = cssContent;
    if (Object.keys(updates).length === 0) continue;

    updates.updated_at = knex.fn.now();
    await knex('css_templates').where({ id: template.id }).update(updates);
  }
};

exports.down = async function down() {
  // Removed comments and translated built-in names are not recoverable safely.
};
