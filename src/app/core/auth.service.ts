import { Injectable, signal } from '@angular/core';

interface CurrentUser {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  status?: string;
  organizationId?: string;
  organizationName?: string;
  organizationLegalName?: string;
  currency?: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

interface UnauthorizedAccessState {
  visible: boolean;
  title: string;
  message: string;
  icon: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenKey = 'accessToken';
  private readonly userKey = 'currentUser';

  readonly token = signal<string>(localStorage.getItem(this.tokenKey) || '');
  readonly currentUser = signal<CurrentUser | null>(this.readUser());
  readonly unauthorizedAccess = signal<UnauthorizedAccessState>({
    visible: false,
    title: '',
    message: '',
    icon: 'bi-shield-lock',
  });

  isAuthenticated(): boolean {
    return Boolean(this.token());
  }

  setSession(token: string, user?: CurrentUser): void {
    localStorage.setItem(this.tokenKey, token);
    this.token.set(token);

    if (user) {
      localStorage.setItem(this.userKey, JSON.stringify(user));
      this.currentUser.set(user);
    }
  }

  updateCurrentUser(partial: CurrentUser): void {
    const current = this.currentUser() || {};
    const updated = { ...current, ...partial };
    localStorage.setItem(this.userKey, JSON.stringify(updated));
    this.currentUser.set(updated);
  }

  clearSession(): void {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
    this.token.set('');
    this.currentUser.set(null);
  }

  isPrivileged(): boolean {
    const roleCodes = this.currentUser()?.roleCodes || [];
    const normalized = roleCodes.map((code) => String(code || '').toLowerCase());
    return normalized.includes('administrator') || normalized.includes('superuser');
  }

  hasPermission(permission: string): boolean {
    if (!permission) {
      return true;
    }
    if (this.isPrivileged()) {
      return true;
    }
    const set = new Set(
      (this.currentUser()?.permissionCodes || []).map((code) =>
        String(code || '').toLowerCase()
      )
    );
    return set.has(String(permission || '').toLowerCase());
  }

  hasAnyPermission(permissions: string[] = []): boolean {
    if (!permissions || permissions.length === 0) {
      return true;
    }
    return permissions.some((permission) => this.hasPermission(permission));
  }

  showUnauthorizedAccess(message = 'You are not allowed to access this section.'): void {
    this.unauthorizedAccess.set({
      visible: true,
      title: 'Unauthorized Access',
      message,
      icon: 'bi-shield-lock',
    });
  }

  clearUnauthorizedAccess(): void {
    this.unauthorizedAccess.set({
      visible: false,
      title: '',
      message: '',
      icon: 'bi-shield-lock',
    });
  }

  private readUser(): CurrentUser | null {
    const raw = localStorage.getItem(this.userKey);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as CurrentUser;
    } catch {
      return null;
    }
  }
}
