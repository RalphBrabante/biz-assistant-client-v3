import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class OrganizationContextService {
  private readonly storageKey = 'selectedOrganizationId';
  private readonly auth = inject(AuthService);

  readonly selectedOrganizationId = signal<string>(this.readStoredSelection());

  isSuperuser(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return roleCodes.includes('superuser');
  }

  getActiveOrganizationId(): string {
    const userOrgId = String(this.auth.currentUser()?.organizationId || '').trim();
    if (!this.isSuperuser()) {
      return userOrgId;
    }

    const selected = String(this.selectedOrganizationId() || '').trim();
    return selected || userOrgId;
  }

  shouldApplySuperuserScope(): boolean {
    return this.isSuperuser() && Boolean(String(this.selectedOrganizationId() || '').trim());
  }

  setSelectedOrganizationId(organizationId: string): void {
    const normalized = String(organizationId || '').trim();
    this.selectedOrganizationId.set(normalized);
    if (normalized) {
      localStorage.setItem(this.storageKey, normalized);
    } else {
      localStorage.removeItem(this.storageKey);
    }
  }

  clearSelectedOrganizationId(): void {
    this.selectedOrganizationId.set('');
    localStorage.removeItem(this.storageKey);
  }

  private readStoredSelection(): string {
    return String(localStorage.getItem(this.storageKey) || '').trim();
  }
}
