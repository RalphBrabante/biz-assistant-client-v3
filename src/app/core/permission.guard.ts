import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const required = (route.data?.['permissions'] as string[] | undefined) || [];
  if (auth.hasAnyPermission(required)) {
    return true;
  }

  const message = required.length > 0
    ? `Missing required permission: ${required.join(' OR ')}`
    : 'You are not allowed to access this section.';
  auth.showUnauthorizedAccess(message);

  return router.parseUrl('/dashboard');
};
