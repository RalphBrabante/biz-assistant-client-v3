import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ApiResponse } from '../core/types';
import { TooltipDirective } from '../shared/tooltip.directive';

interface CustomerRow {
  id: string;
  organizationId: string;
  customerCode?: string;
  type?: string;
  name: string;
  legalName?: string;
  taxId: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  creditLimit?: number;
  paymentTermsDays?: number;
  status?: string;
  notes?: string;
  isActive?: boolean;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
}

@Component({
  selector: 'app-customers-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TooltipDirective],
  templateUrl: './customers-page.component.html',
})
export class CustomersPageComponent {
  private readonly api: ApiService;
  private readonly auth: AuthService;
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);

  constructor(api: ApiService, auth: AuthService) {
    this.api = api;
    this.auth = auth;
  }

  readonly rows = signal<CustomerRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);
  readonly isImportModalOpen = signal(false);
  readonly exporting = signal(false);
  readonly importModalError = signal('');

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  readonly pageSizeOptions = [10, 20, 50, 100];

  createForm: Record<string, unknown> = this.newCustomerForm();
  editingId = '';
  editForm: Record<string, unknown> = this.newCustomerForm();
  private importFile: File | null = null;

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }

    return this.rows().filter((row) => {
      return (
        String(row.name || '').toLowerCase().includes(q) ||
        String(row.legalName || '').toLowerCase().includes(q) ||
        String(row.taxId || '').toLowerCase().includes(q) ||
        String(row.email || '').toLowerCase().includes(q) ||
        String(row.customerCode || '').toLowerCase().includes(q) ||
        String(row.organization?.name || '').toLowerCase().includes(q)
      );
    });
  });

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
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

    this.api.list<CustomerRow>(`/api/v1/customers?${params.toString()}`).subscribe({
      next: (response: ApiResponse<CustomerRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load customers.');
      },
    });
  }

  openCreateModal(): void {
    this.createForm = this.newCustomerForm();
    this.error.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  openImportModal(): void {
    this.importFile = null;
    this.importModalError.set('');
    this.error.set('');
    this.message.set('');
    this.isImportModalOpen.set(true);
  }

  closeImportModal(): void {
    this.isImportModalOpen.set(false);
    this.importFile = null;
    this.importModalError.set('');
  }

  createCustomer(): void {
    if (!this.currentOrganizationId.trim()) {
      if (this.organizationContext.isAllOrganizationsSelected()) {
        this.error.set('Select a specific organization before creating a customer.');
        return;
      }
      this.error.set('Logged in user has no organization assigned.');
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const currentUser = this.auth.currentUser();
    const payload = this.buildPayload({
      ...this.createForm,
      organizationId: this.currentOrganizationId,
      createdBy: currentUser?.id || '',
      updatedBy: currentUser?.id || '',
    });

    this.api.create<CustomerRow>('/api/v1/customers', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Customer created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create customer.');
      },
    });
  }

  openEditModal(row: CustomerRow): void {
    this.editingId = row.id;
    this.editForm = {
      organizationId: row.organizationId || '',
      customerCode: row.customerCode || '',
      type: row.type || 'business',
      name: row.name || '',
      legalName: row.legalName || '',
      taxId: row.taxId || '',
      contactPerson: row.contactPerson || '',
      email: row.email || '',
      phone: row.phone || '',
      mobile: row.mobile || '',
      addressLine1: row.addressLine1 || '',
      addressLine2: row.addressLine2 || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.postalCode || '',
      country: row.country || 'United States',
      creditLimit: row.creditLimit ?? 0,
      paymentTermsDays: row.paymentTermsDays ?? 30,
      status: row.status || 'active',
      notes: row.notes || '',
      isActive: row.isActive !== false,
    };
    this.error.set('');
    this.message.set('');
    this.isEditModalOpen.set(true);
  }

  closeEditModal(): void {
    this.editingId = '';
    this.editForm = this.newCustomerForm();
    this.isEditModalOpen.set(false);
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Customer',
      message: 'Save changes to this customer?',
      confirmText: 'Update Customer',
      confirmButtonClass: 'btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const currentUser = this.auth.currentUser();
    const payload = this.buildPayload({
      ...this.editForm,
      updatedBy: currentUser?.id || '',
    });

    this.api.update<CustomerRow>('/api/v1/customers', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Customer updated successfully.');
        this.closeEditModal();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update customer.');
      },
    });
  }

  async removeCustomer(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Customer',
      message: 'Delete this customer? This action cannot be undone.',
      confirmText: 'Delete Customer',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-person-vcard',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/customers', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Customer deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete customer.');
      },
    });
  }

  trackById(_index: number, row: CustomerRow): string {
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

  onImportFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.importFile = target?.files && target.files.length > 0 ? target.files[0] : null;
  }

  importCustomersCsv(): void {
    if (!this.importFile) {
      this.importModalError.set('Please select a CSV file to import.');
      return;
    }
    if (this.organizationContext.isAllOrganizationsSelected()) {
      this.importModalError.set('Select a specific organization before importing customers.');
      return;
    }

    this.submitting.set(true);
    this.importModalError.set('');
    this.error.set('');
    this.message.set('');

    const formData = new FormData();
    formData.append('file', this.importFile);
    if (this.currentOrganizationId.trim()) {
      formData.append('organizationId', this.currentOrganizationId.trim());
    }

    this.api.createFormData<Record<string, unknown>>('/api/v1/customers/import', formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.closeImportModal();
        const data = (response.data || {}) as Record<string, unknown>;
        const imported = Number(data['imported'] || 0);
        const skipped = Number(data['skipped'] || 0);
        this.message.set(response.message || `Imported ${imported}, skipped ${skipped}.`);
        this.page = 1;
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.importModalError.set(err?.error?.message || 'Unable to import customers.');
      },
    });
  }

  exportCustomersCsv(): void {
    this.exporting.set(true);
    this.error.set('');
    this.message.set('');

    const params = new URLSearchParams();
    const q = this.filter().trim();
    if (q) {
      params.set('q', q);
    }

    this.api.download(`/api/v1/customers/export?${params.toString()}`).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.message.set('Customers CSV exported successfully.');
      },
      error: (err) => {
        this.exporting.set(false);
        this.error.set(err?.error?.message || 'Unable to export customers.');
      },
    });
  }

  organizationLabel(row: CustomerRow): string {
    return row.organization?.name || row.organization?.legalName || row.organizationId || '-';
  }

  customerStatusBadgeClass(status: string | undefined): string {
    switch (String(status || '').toLowerCase()) {
      case 'active':
        return 'text-bg-success';
      case 'inactive':
        return 'text-bg-secondary';
      case 'blocked':
        return 'text-bg-danger';
      default:
        return 'text-bg-light border border-secondary-subtle text-secondary';
    }
  }

  customerActiveBadgeClass(isActive: boolean | undefined): string {
    return isActive ? 'text-bg-success' : 'text-bg-secondary';
  }

  private newCustomerForm(): Record<string, unknown> {
    return {
      organizationId: '',
      customerCode: '',
      type: 'business',
      name: '',
      legalName: '',
      taxId: '',
      contactPerson: '',
      email: '',
      phone: '',
      mobile: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: 'United States',
      creditLimit: 0,
      paymentTermsDays: 30,
      status: 'active',
      notes: '',
      isActive: true,
      createdBy: '',
      updatedBy: '',
    };
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      organizationId: this.asString(form['organizationId']),
      customerCode: this.optionalString(form['customerCode']),
      type: this.optionalString(form['type']),
      name: this.asString(form['name']),
      legalName: this.optionalString(form['legalName']),
      taxId: this.asString(form['taxId']),
      contactPerson: this.optionalString(form['contactPerson']),
      email: this.optionalString(form['email']),
      phone: this.optionalString(form['phone']),
      mobile: this.optionalString(form['mobile']),
      addressLine1: this.optionalString(form['addressLine1']),
      addressLine2: this.optionalString(form['addressLine2']),
      city: this.optionalString(form['city']),
      state: this.optionalString(form['state']),
      postalCode: this.optionalString(form['postalCode']),
      country: this.optionalString(form['country']),
      creditLimit: this.optionalNumber(form['creditLimit']),
      paymentTermsDays: this.optionalNumber(form['paymentTermsDays']),
      status: this.optionalString(form['status']),
      notes: this.optionalString(form['notes']),
      isActive: Boolean(form['isActive']),
      createdBy: this.optionalString(form['createdBy']),
      updatedBy: this.optionalString(form['updatedBy']),
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
