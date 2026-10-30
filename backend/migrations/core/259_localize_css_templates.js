'use strict';

const BUILT_IN_TEMPLATES = new Map([
  ['elegant dark', '优雅暗色'],
  ['apple liquid glass', '苹果液态玻璃'],
  ['liquid glass dark', '液态玻璃深色'],
  ['优雅暗色', '优雅暗色'],
  ['苹果液态玻璃', '苹果液态玻璃'],
  ['液态玻璃深色', '液态玻璃深色'],
]);

function normalizeTemplateName(name) {
  return BUILT_IN_TEMPLATES.get(String(name || '').trim().toLowerCase()) || null;
}

function removeCssComments(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('css_templates'))) return;

  const templates = await knex('css_templates').select('id', 'name', 'css_content');
  for (const template of templates) {
    const localizedName = normalizeTemplateName(template.name);
    if (!localizedName) continue;

    await knex('css_templates').where({ id: template.id }).update({
      name: localizedName,
      // The bundled examples contain long English comments and old upstream
      // issue references. Comments do not affect CSS behavior; remove them so
      // the editor presents only the usable stylesheet. Custom template names
      // are left untouched above.
      css_content: removeCssComments(template.css_content),
      updated_at: knex.fn.now(),
    });
  }
};

exports.down = async function down() {
  // The stylesheet rules are unchanged; removed comments and localized names
  // are not safely reconstructable after an administrator edits a template.
};

exports.normalizeTemplateName = normalizeTemplateName;
exports.removeCssComments = removeCssComments;
