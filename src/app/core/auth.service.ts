import { Injectable, signal } from '@angular/core';

interface CurrentUser {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: string;
  organizationId?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenKey = 'accessToken';
  private readonly userKey = 'currentUser';

  readonly token = signal<string>(localStorage.getItem(this.tokenKey) || '');
  readonly currentUser = signal<CurrentUser | null>(this.readUser());

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

  clearSession(): void {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
    this.token.set('');
    this.currentUser.set(null);
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
