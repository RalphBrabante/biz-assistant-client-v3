import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ApiResponse } from '../core/types';
import { TooltipDirective } from '../shared/tooltip.directive';

interface VendorRow {
  id: string;
  organizationId: string;
  name: string;
  legalName?: string;
  taxId?: string;
  contactPerson?: string;
  contactEmail?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  paymentTerms?: string;
  notes?: string;
  status?: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
}

@Component({
  selector: 'app-vendors-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TooltipDirective],
  templateUrl: './vendors-page.component.html',
})
export class VendorsPageComponent {
  private readonly api: ApiService;
  private readonly auth: AuthService;

  constructor(api: ApiService, auth: AuthService) {
    this.api = api;
    this.auth = auth;
  }

  readonly rows = signal<VendorRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');

  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  readonly pageSizeOptions = [10, 20, 50, 100];

  createForm: Record<string, unknown> = this.newVendorForm();
  editingId = '';
  editForm: Record<string, unknown> = this.newVendorForm();

  get currentUserId(): string {
    return this.auth.currentUser()?.id || '';
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

    this.api.list<VendorRow>(`/api/v1/vendors?${params.toString()}`).subscribe({
      next: (response: ApiResponse<VendorRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load vendors.');
      },
    });
  }

  openCreateModal(): void {
    this.createForm = this.newVendorForm();
    this.error.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  createVendor(): void {
    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload({
      ...this.createForm,
      createdBy: this.currentUserId,
      updatedBy: this.currentUserId,
    });

    this.api.create<VendorRow>('/api/v1/vendors', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Vendor created successfully.');
        this.page = 1;
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create vendor.');
      },
    });
  }

  openEditModal(row: VendorRow): void {
    this.editingId = row.id;
    this.editForm = {
      name: row.name || '',
      legalName: row.legalName || '',
      taxId: row.taxId || '',
      contactPerson: row.contactPerson || '',
      contactEmail: row.contactEmail || '',
      phone: row.phone || '',
      addressLine1: row.addressLine1 || '',
      addressLine2: row.addressLine2 || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.postalCode || '',
      country: row.country || 'United States',
      paymentTerms: row.paymentTerms || '',
      notes: row.notes || '',
      status: row.status || 'active',
      updatedBy: this.currentUserId,
    };
    this.error.set('');
    this.message.set('');
    this.isEditModalOpen.set(true);
  }

  closeEditModal(): void {
    this.editingId = '';
    this.editForm = this.newVendorForm();
    this.isEditModalOpen.set(false);
  }

  saveEdit(): void {
    if (!this.editingId) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload({
      ...this.editForm,
      updatedBy: this.currentUserId,
    });

    this.api.update<VendorRow>('/api/v1/vendors', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Vendor updated successfully.');
        this.closeEditModal();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update vendor.');
      },
    });
  }

  removeVendor(id: string): void {
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/vendors', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Vendor deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete vendor.');
      },
    });
  }

  trackById(_index: number, row: VendorRow): string {
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

  statusBadgeClass(status: string | undefined): string {
    switch (String(status || '').toLowerCase()) {
      case 'active':
        return 'text-bg-success';
      case 'inactive':
        return 'text-bg-secondary';
      case 'blocked':
        return 'text-bg-danger';
      default:
        return 'text-bg-light';
    }
  }

  private newVendorForm(): Record<string, unknown> {
    return {
      name: '',
      legalName: '',
      taxId: '',
      contactPerson: '',
      contactEmail: '',
      phone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: 'United States',
      paymentTerms: '',
      notes: '',
      status: 'active',
      createdBy: '',
      updatedBy: '',
    };
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      name: this.optionalString(form['name']),
      legalName: this.optionalString(form['legalName']),
      taxId: this.optionalString(form['taxId']),
      contactPerson: this.optionalString(form['contactPerson']),
      contactEmail: this.optionalString(form['contactEmail']),
      phone: this.optionalString(form['phone']),
      addressLine1: this.optionalString(form['addressLine1']),
      addressLine2: this.optionalString(form['addressLine2']),
      city: this.optionalString(form['city']),
      state: this.optionalString(form['state']),
      postalCode: this.optionalString(form['postalCode']),
      country: this.optionalString(form['country']),
      paymentTerms: this.optionalString(form['paymentTerms']),
      notes: this.optionalString(form['notes']),
      status: this.optionalString(form['status']),
      createdBy: this.optionalString(form['createdBy']),
      updatedBy: this.optionalString(form['updatedBy']),
    };
  }

  private optionalString(value: unknown): string | undefined {
    const cleaned = String(value || '').trim();
    return cleaned ? cleaned : undefined;
  }
}
