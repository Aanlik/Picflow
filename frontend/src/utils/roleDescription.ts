import type { RoleWithPermissions } from '../services/roles.service';

// Recognize only shipped seed text. Custom descriptions must survive localization.
const defaults: Record<string, string[]> = {
  "super_admin": [
    "Full system access including user management"
  ],
  "admin": [
    "Full event and photo management"
  ],
  "editor": [
    "Can edit events and photos but not create or delete"
  ],
  "viewer": [
    "Read-only access to dashboard and events"
  ],
  "solo_photographer": [
    "Full operator for a one-person studio — everything needed to run the business (galleries, uploads, CRM, invoices, banking, settings and team management). A preset starting point; new-release permissions are not auto-added (only Super Admin tracks all).",
    "Full operator for a one-person photo studio. A preset starting point; new-release permissions are not auto-added (only Super Admin tracks all)."
  ],
  "team_photographer": [
    "Contributing photographer (second/festival shooter) — view events, upload and manage photos, and see read-only client context. Not the customer contact: no settings, user management, billing edits or event configuration. A preset starting point.",
    "Contributing photographer — view events, upload and manage photos, and see read-only client context. Not the customer contact: no settings, user management, or event configuration. A preset starting point."
  ]
};

export function roleDescriptionIsDefault(role: Pick<RoleWithPermissions, 'name' | 'description' | 'isSystem'>): boolean {
  return Boolean(role.isSystem && (!role.description || defaults[role.name]?.includes(role.description)));
}
