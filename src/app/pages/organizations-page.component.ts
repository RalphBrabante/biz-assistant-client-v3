import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ApiResponse } from '../core/types';
import { TooltipDirective } from '../shared/tooltip.directive';

interface OrganizationRow {
  id: string;
  name: string;
  legalName?: string;
  taxId?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  website?: string;
  industry?: string;
  employeeCount?: number;
  notes?: string;
  isActive?: boolean;
}

@Component({
  selector: 'app-organizations-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TooltipDirective],
  templateUrl: './organizations-page.component.html',
})
export class OrganizationsPageComponent {
  private readonly api: ApiService;

  constructor(api: ApiService) {
    this.api = api;
  }

  readonly rows = signal<OrganizationRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  readonly pageSizeOptions = [10, 20, 50, 100];

  createForm: Record<string, unknown> = this.newOrgForm();
  editingId = '';
  editForm: Record<string, unknown> = this.newOrgForm();

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }

    return this.rows().filter((row) => {
      return (
        String(row.name || '').toLowerCase().includes(q) ||
        String(row.legalName || '').toLowerCase().includes(q) ||
        String(row.contactEmail || '').toLowerCase().includes(q) ||
        String(row.city || '').toLowerCase().includes(q)
      );
    });
  });

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

    this.api.list<OrganizationRow>(`/api/v1/organizations?${params.toString()}`).subscribe({
      next: (response: ApiResponse<OrganizationRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load organizations.');
      },
    });
  }

  openCreateModal(): void {
    this.createForm = this.newOrgForm();
    this.error.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  createOrganization(): void {
    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload(this.createForm);

    this.api.create<OrganizationRow>('/api/v1/organizations', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Organization created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create organization.');
      },
    });
  }

  startEdit(row: OrganizationRow): void {
    this.editingId = row.id;
    this.editForm = {
      name: row.name || '',
      legalName: row.legalName || '',
      taxId: row.taxId || '',
      addressLine1: row.addressLine1 || '',
      addressLine2: row.addressLine2 || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.postalCode || '',
      country: row.country || 'United States',
      contactName: row.contactName || '',
      contactEmail: row.contactEmail || '',
      phone: row.phone || '',
      website: row.website || '',
      industry: row.industry || '',
      employeeCount: row.employeeCount ?? 0,
      notes: row.notes || '',
      isActive: row.isActive !== false,
    };
  }

  cancelEdit(): void {
    this.editingId = '';
    this.editForm = this.newOrgForm();
  }

  saveEdit(): void {
    if (!this.editingId) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload(this.editForm);

    this.api.update<OrganizationRow>('/api/v1/organizations', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Organization updated successfully.');
        this.cancelEdit();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update organization.');
      },
    });
  }

  removeOrganization(id: string): void {
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/organizations', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Organization deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete organization.');
      },
    });
  }

  trackById(_index: number, row: OrganizationRow): string {
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

  private newOrgForm(): Record<string, unknown> {
    return {
      name: '',
      legalName: '',
      taxId: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: 'United States',
      contactName: '',
      contactEmail: '',
      phone: '',
      website: '',
      industry: '',
      employeeCount: 0,
      notes: '',
      isActive: true,
    };
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      name: this.asString(form['name']),
      legalName: this.optionalString(form['legalName']),
      taxId: this.optionalString(form['taxId']),
      addressLine1: this.asString(form['addressLine1']),
      addressLine2: this.optionalString(form['addressLine2']),
      city: this.asString(form['city']),
      state: this.optionalString(form['state']),
      postalCode: this.optionalString(form['postalCode']),
      country: this.optionalString(form['country']),
      contactName: this.optionalString(form['contactName']),
      contactEmail: this.asString(form['contactEmail']),
      phone: this.asString(form['phone']),
      website: this.optionalString(form['website']),
      industry: this.optionalString(form['industry']),
      employeeCount: this.optionalNumber(form['employeeCount']),
      notes: this.optionalString(form['notes']),
      isActive: Boolean(form['isActive']),
    };
  }

  private asString(value: unknown): string {
    return String(value || '').trim();
  }

  private optionalString(value: unknown): string | undefined {
    const cleaned = String(value || '').trim();
    return cleaned ? cleaned : undefined;
  }

  private optionalNumber(value: unknown): number | undefined {
    if (value === '' || value === null || value === undefined) {
      return undefined;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
}
