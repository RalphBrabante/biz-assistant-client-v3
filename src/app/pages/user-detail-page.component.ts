import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { ApiResponse } from '../core/types';

interface RoleRow {
  id: string;
  name?: string;
  code?: string;
  description?: string;
}

interface UserRoleRow {
  id: string;
  name?: string;
  code?: string;
  description?: string;
  UserRole?: {
    id?: string;
    assignedByUserId?: string;
    createdAt?: string;
  };
}

interface UserDetail {
  id: string;
  organizationId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  status?: string;
  isEmailVerified?: boolean;
  isActive?: boolean;
  role?: string;
  roles?: UserRoleRow[];
}

@Component({
  selector: 'app-user-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './user-detail-page.component.html',
})
export class UserDetailPageComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly assigning = signal(false);
  readonly removingRoleId = signal('');

  readonly message = signal('');
  readonly error = signal('');

  readonly user = signal<UserDetail | null>(null);
  readonly assignableRoles = signal<RoleRow[]>([]);

  selectedRoleId = '';
  form: Record<string, unknown> = {};

  get userId(): string {
    return String(this.route.snapshot.paramMap.get('id') || '').trim();
  }

  ngOnInit(): void {
    if (!this.userId) {
      this.error.set('User id is required.');
      return;
    }

    this.loadUser();
    this.loadAssignableRoles();
  }

  loadUser(): void {
    this.loading.set(true);
    this.error.set('');

    this.api.get<UserDetail>(`/api/v1/users/${this.userId}`).subscribe({
      next: (response: ApiResponse<UserDetail>) => {
        this.loading.set(false);
        const user = response.data || null;
        this.user.set(user);
        this.form = {
          organizationId: user?.organizationId || '',
          firstName: user?.firstName || '',
          lastName: user?.lastName || '',
          email: user?.email || '',
          password: '',
          phone: user?.phone || '',
          addressLine1: user?.addressLine1 || '',
          addressLine2: user?.addressLine2 || '',
          city: user?.city || '',
          state: user?.state || '',
          postalCode: user?.postalCode || '',
          country: user?.country || 'United States',
          status: user?.status || 'pending_verification',
          role: user?.role || '',
          isEmailVerified: user?.isEmailVerified === true,
          isActive: user?.isActive !== false,
        };
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load user details.');
      },
    });
  }

  loadAssignableRoles(): void {
    this.api.list<RoleRow>(`/api/v1/users/${this.userId}/assignable-roles`).subscribe({
      next: (response: ApiResponse<RoleRow[]>) => {
        this.assignableRoles.set(response.data || []);
      },
      error: () => {
        this.assignableRoles.set([]);
      },
    });
  }

  saveUser(): void {
    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload(this.form);

    this.api.update<UserDetail>('/api/v1/users', this.userId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'User updated successfully.');
        this.loadUser();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update user.');
      },
    });
  }

  assignRole(): void {
    if (!this.selectedRoleId.trim()) {
      this.error.set('Please select a role to assign.');
      return;
    }

    this.assigning.set(true);
    this.error.set('');
    this.message.set('');

    this.api.create(`/api/v1/users/${this.userId}/roles`, { roleId: this.selectedRoleId.trim() }).subscribe({
      next: (response) => {
        this.assigning.set(false);
        this.message.set(response.message || 'Role assigned successfully.');
        this.selectedRoleId = '';
        this.loadUser();
      },
      error: (err) => {
        this.assigning.set(false);
        this.error.set(err?.error?.message || 'Unable to assign role.');
      },
    });
  }

  async removeRole(roleId: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Remove Role',
      message: 'Remove this role from the user?',
      confirmText: 'Remove Role',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-person-dash',
    });
    if (!confirmed) {
      return;
    }
    this.removingRoleId.set(roleId);
    this.error.set('');
    this.message.set('');

    this.api.remove(`/api/v1/users/${this.userId}/roles`, roleId).subscribe({
      next: (response) => {
        this.removingRoleId.set('');
        this.message.set(response.message || 'Role removed successfully.');
        this.loadUser();
      },
      error: (err) => {
        this.removingRoleId.set('');
        this.error.set(err?.error?.message || 'Unable to remove role.');
      },
    });
  }

  roleChipClass(code: string | undefined): string {
    const normalized = String(code || '').toLowerCase();
    if (normalized === 'administrator' || normalized === 'superuser') return 'text-bg-danger';
    if (normalized === 'accountant' || normalized === 'inventorymanager') return 'text-bg-primary';
    if (normalized === 'enduser') return 'text-bg-secondary';
    return 'text-bg-light border border-secondary-subtle text-secondary';
  }

  trackByRoleId(_index: number, role: UserRoleRow): string {
    return role.id;
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      organizationId: this.optionalString(form['organizationId']),
      firstName: this.asString(form['firstName']),
      lastName: this.asString(form['lastName']),
      email: this.asString(form['email']).toLowerCase(),
      phone: this.optionalString(form['phone']),
      addressLine1: this.optionalString(form['addressLine1']),
      addressLine2: this.optionalString(form['addressLine2']),
      city: this.optionalString(form['city']),
      state: this.optionalString(form['state']),
      postalCode: this.optionalString(form['postalCode']),
      country: this.optionalString(form['country']),
      role: this.optionalString(form['role']),
      status: this.optionalString(form['status']),
      isEmailVerified: Boolean(form['isEmailVerified']),
      isActive: Boolean(form['isActive']),
    };

    const password = this.optionalString(form['password']);
    if (password) {
      payload['password'] = password;
    }

    return payload;
  }

  private asString(value: unknown): string {
    return String(value || '').trim();
  }

  private optionalString(value: unknown): string | undefined {
    const cleaned = String(value || '').trim();
    return cleaned ? cleaned : undefined;
  }
}
