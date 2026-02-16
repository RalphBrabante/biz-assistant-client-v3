import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ApiResponse } from '../core/types';
import { TooltipDirective } from '../shared/tooltip.directive';

interface UserRow {
  id: string;
  organizationId?: string;
  primaryOrganization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  role?: string;
  status?: string;
  isEmailVerified?: boolean;
  emailVerifiedAt?: string;
  isActive?: boolean;
  lastLoginAt?: string;
}

interface UserCreateResponse extends UserRow {
  inviteEmail?: {
    sent?: boolean;
    message?: string;
  };
}

interface RoleOption {
  id: string;
  name?: string;
  code?: string;
  description?: string;
}

interface OrganizationOption {
  id: string;
  name?: string;
  legalName?: string;
}

@Component({
  selector: 'app-users-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TooltipDirective],
  templateUrl: './users-page.component.html',
})
export class UsersPageComponent {
  private readonly api: ApiService;
  private readonly auth: AuthService;
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);

  constructor(api: ApiService, auth: AuthService) {
    this.api = api;
    this.auth = auth;
  }

  readonly rows = signal<UserRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly createOptionsLoading = signal(false);
  readonly createRoleOptions = signal<RoleOption[]>([]);
  readonly createOrganizationOptions = signal<OrganizationOption[]>([]);
  readonly createModalError = signal('');
  readonly countryOptions = this.buildCountryOptions();

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  readonly pageSizeOptions = [10, 20, 50, 100];

  createForm: Record<string, unknown> = this.newUserForm(true);
  createSelectedRoleIds: string[] = [];

  editingId = '';
  editForm: Record<string, unknown> = this.newUserForm(false);

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }

    return this.rows().filter((row) => {
      return (
        String(row.firstName || '').toLowerCase().includes(q) ||
        String(row.lastName || '').toLowerCase().includes(q) ||
        String(row.email || '').toLowerCase().includes(q) ||
        String(row.role || '').toLowerCase().includes(q) ||
        String(row.status || '').toLowerCase().includes(q)
      );
    });
  });

  get currentOrganizationId(): string {
    return this.auth.currentUser()?.organizationId || '';
  }

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const q = this.filter().trim();
    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
    });
    if (q) {
      params.set('q', q);
    }

    this.api.list<UserRow>(`/api/v1/users?${params.toString()}`).subscribe({
      next: (response: ApiResponse<UserRow[]>) => {
        this.loading.set(false);
        this.rows.set(response.data || []);
        const meta = response.meta || {};
        this.total = Number(meta.total || 0);
        this.totalPages = Math.max(1, Number(meta.totalPages || 1));
        this.page = Math.max(1, Number(meta.page || this.page));
        this.pageSize = Math.max(1, Number(meta.limit || this.pageSize));
        if (this.page > this.totalPages) {
          this.page = this.totalPages;
          this.load();
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load users.');
      },
    });
  }

  openCreateModal(): void {
    this.createForm = this.newUserForm(true);
    this.createSelectedRoleIds = [];
    this.createForm['organizationId'] = this.isSuperuser ? '' : this.currentOrganizationId;
    this.createModalError.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
    this.loadCreateModalOptions();
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
    this.createModalError.set('');
  }

  createUser(): void {
    if (!this.isSuperuser && !this.currentOrganizationId.trim()) {
      this.createModalError.set('Logged in user has no organization assigned.');
      return;
    }
    if (this.isSuperuser && !this.optionalString(this.createForm['organizationId'])) {
      this.createModalError.set('Please select an organization.');
      return;
    }
    if (this.createSelectedRoleIds.length === 0) {
      this.createModalError.set('Please select at least one role.');
      return;
    }
    if (!this.asString(this.createForm['password'])) {
      this.createModalError.set('Password is required.');
      return;
    }

    this.submitting.set(true);
    this.createModalError.set('');
    this.message.set('');

    const payload = this.buildPayload(this.createForm, true);
    payload['organizationId'] = this.isSuperuser
      ? this.optionalString(this.createForm['organizationId'])
      : this.currentOrganizationId;
    payload['roleIds'] = [...this.createSelectedRoleIds];
    delete payload['role'];

    this.api.create<UserCreateResponse>('/api/v1/users', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        const inviteEmail = response.data?.inviteEmail;
        const inviteSent = inviteEmail?.sent !== false;

        if (!inviteSent) {
          this.createModalError.set(
            inviteEmail?.message || 'User was created, but invite email could not be sent.'
          );
          this.message.set(response.message || 'User created successfully.');
          this.load();
          return;
        }

        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'User created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.createModalError.set(err?.error?.message || 'Unable to create user.');
      },
    });
  }

  startEdit(row: UserRow): void {
    this.editingId = row.id;
    this.editForm = {
      organizationId: row.organizationId || '',
      firstName: row.firstName || '',
      lastName: row.lastName || '',
      email: row.email || '',
      password: '',
      phone: row.phone || '',
      addressLine1: row.addressLine1 || '',
      addressLine2: row.addressLine2 || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.postalCode || '',
      country: row.country || '',
      role: row.role || '',
      status: row.status || 'pending_verification',
      isEmailVerified: row.isEmailVerified === true,
      isActive: row.isActive !== false,
    };
  }

  cancelEdit(): void {
    this.editingId = '';
    this.editForm = this.newUserForm(false);
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update User',
      message: 'Save changes to this user?',
      confirmText: 'Update User',
      confirmButtonClass: 'btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload(this.editForm, false);

    this.api.update<UserRow>('/api/v1/users', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'User updated successfully.');
        this.cancelEdit();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update user.');
      },
    });
  }

  async removeUser(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete User',
      message: 'Delete this user? This action cannot be undone.',
      confirmText: 'Delete User',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-person-x',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/users', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'User deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete user.');
      },
    });
  }

  trackById(_index: number, row: UserRow): string {
    return row.id;
  }

  onFilterChange(value: string): void {
    this.filter.set(value);
    this.page = 1;
    this.load();
  }

  onPageSizeChange(value: string): void {
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.page = 1;
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page || this.loading()) {
      return;
    }
    this.page = page;
    this.load();
  }

  userRoleBadgeClass(role: string | undefined): string {
    switch (String(role || '').toLowerCase()) {
      case 'administrator':
      case 'superuser':
        return 'text-bg-danger';
      case 'accountant':
      case 'inventorymanager':
        return 'text-bg-primary';
      case 'enduser':
        return 'text-bg-secondary';
      default:
        return 'text-bg-light border border-secondary-subtle text-secondary';
    }
  }

  userStatusBadgeClass(status: string | undefined): string {
    switch (String(status || '').toLowerCase()) {
      case 'active':
        return 'text-bg-success';
      case 'pending_verification':
        return 'text-bg-warning';
      case 'inactive':
        return 'text-bg-secondary';
      case 'blocked':
      case 'suspended':
        return 'text-bg-danger';
      default:
        return 'text-bg-light border border-secondary-subtle text-secondary';
    }
  }

  verificationBadgeClass(isEmailVerified: boolean | undefined): string {
    return isEmailVerified ? 'text-bg-success' : 'text-bg-warning';
  }

  activeBadgeClass(isActive: boolean | undefined): string {
    return isActive ? 'text-bg-success' : 'text-bg-secondary';
  }

  organizationLabel(row: UserRow): string {
    return row.primaryOrganization?.name || row.primaryOrganization?.legalName || row.organizationId || '-';
  }

  roleOptionLabel(role: RoleOption): string {
    const name = String(role.name || '').trim();
    const code = String(role.code || '').trim();
    if (name && code) {
      return `${name} (${code.toUpperCase()})`;
    }
    return name || code || role.id;
  }

  organizationOptionLabel(organization: OrganizationOption): string {
    return organization.name || organization.legalName || organization.id;
  }

  isCreateRoleSelected(roleId: string): boolean {
    return this.createSelectedRoleIds.includes(roleId);
  }

  toggleCreateRoleSelection(roleId: string, checked: boolean): void {
    if (!checked) {
      this.createSelectedRoleIds = this.createSelectedRoleIds.filter((id) => id !== roleId);
      return;
    }
    if (!this.createSelectedRoleIds.includes(roleId)) {
      this.createSelectedRoleIds = [...this.createSelectedRoleIds, roleId];
    }
  }

  generateCreatePassword(): void {
    const charset =
      'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()_+-=';
    const length = 14;
    let generated = '';
    for (let i = 0; i < length; i += 1) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      generated += charset.charAt(randomIndex);
    }
    this.createForm['password'] = generated;
    this.createModalError.set('');
  }

  private loadCreateModalOptions(): void {
    this.createOptionsLoading.set(true);
    this.createRoleOptions.set([]);
    this.createOrganizationOptions.set([]);

    const rolesRequest = this.api.list<RoleOption>('/api/v1/roles?limit=500&isActive=true');
    const organizationsRequest = this.isSuperuser
      ? this.api.list<OrganizationOption>('/api/v1/organizations?limit=500')
      : of({ ok: true, data: [] } as ApiResponse<OrganizationOption[]>);

    forkJoin([rolesRequest, organizationsRequest]).subscribe({
      next: ([rolesResponse, organizationsResponse]: [ApiResponse<RoleOption[]>, ApiResponse<OrganizationOption[]>]) => {
        this.createOptionsLoading.set(false);
        const roleRows = (rolesResponse.data || []).filter(
          (role: RoleOption) =>
            this.isSuperuser || String(role.code || '').toLowerCase() !== 'superuser'
        );
        this.createRoleOptions.set(roleRows);
        this.createOrganizationOptions.set(organizationsResponse.data || []);
      },
      error: () => {
        this.createOptionsLoading.set(false);
        this.createModalError.set('Unable to load create-user options.');
      },
    });
  }

  private newUserForm(includePassword: boolean): Record<string, unknown> {
    return {
      organizationId: '',
      firstName: '',
      lastName: '',
      email: '',
      password: includePassword ? '' : '',
      phone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: 'United States',
      role: undefined,
      status: 'pending_verification',
      isEmailVerified: false,
      isActive: true,
    };
  }

  private buildPayload(form: Record<string, unknown>, includePassword: boolean): Record<string, unknown> {
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
    if (includePassword || password) {
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

  private buildCountryOptions(): string[] {
    const fallback = ['United States'];
    try {
      const intlAny = Intl as unknown as {
        DisplayNames?: new (locales: string[], options: { type: 'region' }) => Intl.DisplayNames;
      };
      if (!intlAny.DisplayNames) {
        return fallback;
      }
      const regionNames = new intlAny.DisplayNames(['en'], { type: 'region' });
      const names = new Set<string>();
      for (let first = 65; first <= 90; first += 1) {
        for (let second = 65; second <= 90; second += 1) {
          const code = String.fromCharCode(first, second);
          const value = regionNames.of(code);
          if (!value || value === code || /unknown region/i.test(value)) {
            continue;
          }
          names.add(value);
        }
      }
      const result = Array.from(names).sort((a, b) => a.localeCompare(b));
      return result.length > 0 ? result : fallback;
    } catch (_err) {
      return fallback;
    }
  }
}
