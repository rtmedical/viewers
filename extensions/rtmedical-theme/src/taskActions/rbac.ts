/**
 * RTV-154 — permission (RBAC) checks for task actions.
 *
 * Deliberately tiny and pure: the viewer never decides *what* a role can do,
 * it only gates the UI on permission keys supplied by the auth/OIDC layer
 * (RTV-155). `'*'` or the `admin` role short-circuit to "allowed".
 */
import type { TaskActionDescriptor, UserPermissions } from './types';

export const WILDCARD_PERMISSION = '*';
export const ADMIN_ROLE = 'admin';

/** True when the user is an administrator (admin role or wildcard permission). */
export function isAdmin(user: UserPermissions | null | undefined): boolean {
  if (!user) {
    return false;
  }
  return (
    (user.roles?.includes(ADMIN_ROLE) ?? false) ||
    (user.permissions?.includes(WILDCARD_PERMISSION) ?? false)
  );
}

/** True when the user holds a single permission key (admins hold everything). */
export function hasPermission(user: UserPermissions | null | undefined, permission: string): boolean {
  if (!user) {
    return false;
  }
  if (isAdmin(user)) {
    return true;
  }
  return user.permissions?.includes(permission) ?? false;
}

/** True when the user may run the action (holds ALL required permissions). */
export function canRunAction(
  user: UserPermissions | null | undefined,
  action: TaskActionDescriptor
): boolean {
  const required = action.requiredPermissions ?? [];
  if (required.length === 0) {
    return true;
  }
  if (isAdmin(user)) {
    return true;
  }
  return required.every(permission => hasPermission(user, permission));
}
