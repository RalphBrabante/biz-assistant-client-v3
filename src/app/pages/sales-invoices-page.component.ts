import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ApiResponse } from '../core/types';
import { TooltipDirective } from '../shared/tooltip.directive';

interface SalesInvoiceRow {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  orderId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  status?: string;
  paymentStatus?: string;
  currency?: string;
  subtotalAmount?: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  paidAt?: string;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
}

@Component({
  selector: 'app-sales-invoices-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TooltipDirective],
  templateUrl: './sales-invoices-page.component.html',
})
export class SalesInvoicesPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);

  readonly rows = signal<SalesInvoiceRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isImportModalOpen = signal(false);
  readonly exporting = signal(false);

  readonly message = signal('');
  readonly error = signal('');
  readonly importModalError = signal('');
  readonly filter = signal('');
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  readonly pageSizeOptions = [10, 20, 50, 100];

  createForm: Record<string, unknown> = this.newInvoiceForm();
  private importFile: File | null = null;

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }

    return this.rows().filter((row) => {
      return (
        String(row.invoiceNumber || '').toLowerCase().includes(q) ||
        String(row.organizationId || '').toLowerCase().includes(q) ||
        String(row.orderId || '').toLowerCase().includes(q) ||
        String(row.status || '').toLowerCase().includes(q)
      );
    });
  });

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
  }

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
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

    this.api.list<SalesInvoiceRow>(`/api/v1/sales-invoices?${params.toString()}`).subscribe({
      next: (response: ApiResponse<SalesInvoiceRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load sales invoices.');
      },
    });
  }

  openCreateModal(): void {
    this.createForm = this.newInvoiceForm();
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
    this.message.set('');
    this.error.set('');
    this.isImportModalOpen.set(true);
  }

  closeImportModal(): void {
    this.isImportModalOpen.set(false);
    this.importFile = null;
    this.importModalError.set('');
  }

  createInvoice(): void {
    if (!this.currentOrganizationId.trim()) {
      if (this.organizationContext.isAllOrganizationsSelected()) {
        this.error.set('Select a specific organization before creating a sales invoice.');
        return;
      }
      this.error.set('Logged in user has no organization assigned.');
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload({
      ...this.createForm,
      organizationId: this.currentOrganizationId,
    });

    this.api.create<SalesInvoiceRow>('/api/v1/sales-invoices', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Sales invoice created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create sales invoice.');
      },
    });
  }

  onImportFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.importFile = target?.files && target.files.length > 0 ? target.files[0] : null;
  }

  importSalesInvoicesCsv(): void {
    if (!this.importFile) {
      this.importModalError.set('Please select a CSV file to import.');
      return;
    }
    if (this.organizationContext.isAllOrganizationsSelected()) {
      this.importModalError.set('Select a specific organization before importing sales invoices.');
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

    this.api.createFormData<Record<string, unknown>>('/api/v1/sales-invoices/import', formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.closeImportModal();
        const data = (response.data || {}) as Record<string, unknown>;
        const imported = Number(data['imported'] || 0);
        const skipped = Number(data['skipped'] || 0);
        this.message.set(response.message || `Imported ${imported}, skipped ${skipped}.`);
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.importModalError.set(err?.error?.message || 'Unable to import sales invoices.');
      },
    });
  }

  exportSalesInvoicesCsv(): void {
    this.exporting.set(true);
    this.error.set('');
    this.message.set('');

    const params = new URLSearchParams();
    const q = this.filter().trim();
    if (q) {
      params.set('q', q);
    }

    this.api.download(`/api/v1/sales-invoices/export?${params.toString()}`).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `sales-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.message.set('Sales invoices CSV exported successfully.');
      },
      error: (err) => {
        this.exporting.set(false);
        this.error.set(err?.error?.message || 'Unable to export sales invoices.');
      },
    });
  }

  async removeInvoice(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Sales Invoice',
      message: 'Delete this sales invoice? This action cannot be undone.',
      confirmText: 'Delete Invoice',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-file-earmark-x',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/sales-invoices', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Sales invoice deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete sales invoice.');
      },
    });
  }

  trackById(_index: number, row: SalesInvoiceRow): string {
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

  invoiceStatusBadgeClass(status: string | undefined): string {
    switch (String(status || '').toLowerCase()) {
      case 'paid':
        return 'text-bg-success';
      case 'issued':
      case 'sent':
        return 'text-bg-primary';
      case 'partially_paid':
        return 'text-bg-info';
      case 'overdue':
        return 'text-bg-warning';
      case 'void':
      case 'cancelled':
        return 'text-bg-danger';
      default:
        return 'text-bg-secondary';
    }
  }

  paymentStatusBadgeClass(status: string | undefined): string {
    switch (String(status || '').toLowerCase()) {
      case 'paid':
        return 'text-bg-success';
      case 'partially_paid':
        return 'text-bg-info';
      case 'refunded':
        return 'text-bg-warning';
      case 'failed':
        return 'text-bg-danger';
      case 'unpaid':
      default:
        return 'text-bg-secondary';
    }
  }

  organizationLabel(row: SalesInvoiceRow): string {
    return row.organization?.name || row.organization?.legalName || row.organizationId || '-';
  }

  private newInvoiceForm(): Record<string, unknown> {
    return {
      organizationId: '',
      orderId: '',
      invoiceNumber: '',
      issueDate: '',
      dueDate: '',
      status: 'draft',
      paymentStatus: 'unpaid',
      currency: this.currentOrganizationCurrency,
      subtotalAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
      paidAt: '',
      notes: '',
      createdBy: '',
      updatedBy: '',
    };
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      organizationId: this.asString(form['organizationId']),
      orderId: this.asString(form['orderId']),
      invoiceNumber: this.asString(form['invoiceNumber']),
      issueDate: this.asString(form['issueDate']),
      dueDate: this.optionalString(form['dueDate']),
      status: this.optionalString(form['status']),
      paymentStatus: this.optionalString(form['paymentStatus']),
      subtotalAmount: this.optionalNumber(form['subtotalAmount']),
      taxAmount: this.optionalNumber(form['taxAmount']),
      discountAmount: this.optionalNumber(form['discountAmount']),
      totalAmount: this.optionalNumber(form['totalAmount']),
      paidAt: this.optionalString(form['paidAt']),
      notes: this.optionalString(form['notes']),
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
