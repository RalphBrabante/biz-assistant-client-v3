import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { OrganizationContextService } from './organization-context.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const organizationContext = inject(OrganizationContextService);
  const token = auth.token();
  let request = req;

  if (
    token &&
    req.method === 'GET' &&
    req.url.includes('/api/v1/') &&
    !req.url.includes('/api/v1/auth/') &&
    !req.url.includes('/api/v1/dev/') &&
    !req.url.includes('/api/v1/organizations') &&
    organizationContext.shouldApplySuperuserScope()
  ) {
    const activeOrganizationId = organizationContext.getActiveOrganizationId();
    if (activeOrganizationId && !req.url.includes('organizationId=')) {
      const separator = req.url.includes('?') ? '&' : '?';
      request = req.clone({
        url: `${req.url}${separator}organizationId=${encodeURIComponent(activeOrganizationId)}`,
      });
    }
  }

  if (!token || request.url.includes('/api/v1/auth/login') || request.url.includes('/api/v1/dev/')) {
    return next(request).pipe(
      catchError((err) => {
        if (err?.status === 403) {
          auth.showUnauthorizedAccess(
            err?.error?.message || 'You are not allowed to access this resource.'
          );
        }
        return throwError(() => err);
      })
    );
  }

  return next(
    request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    })
  ).pipe(
    catchError((err) => {
      if (err?.status === 403) {
        auth.showUnauthorizedAccess(
          err?.error?.message || 'You are not allowed to access this resource.'
        );
      }
      return throwError(() => err);
    })
  );
};
