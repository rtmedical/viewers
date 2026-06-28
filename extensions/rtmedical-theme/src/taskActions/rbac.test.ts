import { canRunAction, hasPermission, isAdmin } from './rbac';
import type { TaskActionDescriptor, UserPermissions } from './types';

const action = (requiredPermissions: string[]): TaskActionDescriptor => ({
  id: 'export',
  label: 'Exportar estudo',
  requiredPermissions,
});

describe('rbac', () => {
  describe('isAdmin', () => {
    it('is false for null/undefined or empty users', () => {
      expect(isAdmin(null)).toBe(false);
      expect(isAdmin(undefined)).toBe(false);
      expect(isAdmin({})).toBe(false);
    });

    it('recognizes the admin role and the wildcard permission', () => {
      expect(isAdmin({ roles: ['admin'] })).toBe(true);
      expect(isAdmin({ permissions: ['*'] })).toBe(true);
      expect(isAdmin({ roles: ['radiologist'] })).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('returns false without a user', () => {
      expect(hasPermission(null, 'study:export')).toBe(false);
    });

    it('matches an explicit permission', () => {
      const user: UserPermissions = { permissions: ['study:export'] };
      expect(hasPermission(user, 'study:export')).toBe(true);
      expect(hasPermission(user, 'study:delete')).toBe(false);
    });

    it('grants any permission to admins', () => {
      expect(hasPermission({ permissions: ['*'] }, 'anything')).toBe(true);
      expect(hasPermission({ roles: ['admin'] }, 'study:delete')).toBe(true);
    });
  });

  describe('canRunAction', () => {
    it('allows actions with no required permissions', () => {
      expect(canRunAction(null, action([]))).toBe(true);
    });

    it('requires ALL listed permissions (AND semantics)', () => {
      const a = action(['study:export', 'study:read']);
      expect(canRunAction({ permissions: ['study:export'] }, a)).toBe(false);
      expect(canRunAction({ permissions: ['study:export', 'study:read'] }, a)).toBe(true);
    });

    it('lets admins run anything', () => {
      expect(canRunAction({ roles: ['admin'] }, action(['study:delete']))).toBe(true);
    });
  });
});
