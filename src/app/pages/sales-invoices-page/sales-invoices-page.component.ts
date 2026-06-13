import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';

interface SalesInvoiceRow {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  orderId?: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  status?: string;
  paymentStatus?: string;
  currency?: string;
  amount?: number;
  taxableAmount?: number;
  withHoldingTaxAmount?: number;
  subtotalAmount?: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  paidAt?: string;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
}

interface SalesInvoiceImportSummary {
  imported: number;
  updated: number;
  skipped: number;
  totalRows: number;
  errors: string[];
}

@Component({
  selector: 'app-sales-invoices-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TooltipDirective],
  templateUrl: './sales-invoices-page.component.html',
})
export class SalesInvoicesPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly fb = inject(FormBuilder);

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
  readonly importSummary = signal<SalesInvoiceImportSummary | null>(null);
  searchQuery = '';
  statusFilter = '';
  paymentStatusFilter = '';
  issueDateFrom = '';
  issueDateTo = '';
  sortBy = 'createdAt';
  sortDirection: 'asc' | 'desc' = 'desc';
  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];
  total = 0;
  totalPages = 1;
    viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'sales-invoices-page';

  createInvoiceForm: FormGroup = this.newCreateInvoiceForm();
  private importFile: File | null = null;
  forceImport = false;

  readonly sortIcon = computed(() =>
    this.sortDirection === 'asc' ? 'bi-sort-up-alt' : 'bi-sort-down-alt'
  );

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
  }

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get hasOrganizationContext(): boolean {
    return Boolean(this.currentOrganizationId.trim());
  }

  get isContextLocked(): boolean {
    return this.isSuperuser && !this.hasOrganizationContext;
  }

  showOrganizationWarningModal = false;

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.showOrganizationWarningModal = this.isContextLocked;
    this.load();
  }

  closeOrganizationWarningModal(): void {
    this.showOrganizationWarningModal = false;
  }

  load(): void {
    if (this.isContextLocked) {
      this.loading.set(false);
      this.rows.set([]);
      this.total = 0;
      this.totalPages = 1;
      this.page = 1;
      this.error.set('');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
      sortBy: this.sortBy,
      sortDirection: this.sortDirection,
    });
    const q = this.searchQuery.trim();
    if (q) {
      params.set('q', q);
    }
    if (this.statusFilter) {
      params.set('status', this.statusFilter);
    }
    if (this.paymentStatusFilter) {
      params.set('paymentStatus', this.paymentStatusFilter);
    }
    if (this.issueDateFrom) {
      params.set('issueDateFrom', this.issueDateFrom);
    }
    if (this.issueDateTo) {
      params.set('issueDateTo', this.issueDateTo);
    }
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }

    this.api.list<SalesInvoiceRow>(`/api/v1/sales-invoices?${params.toString()}`).subscribe({
      next: (response: ApiResponse<SalesInvoiceRow[]>) => {
        this.loading.set(false);
        this.rows.set(response.data || []);
        const meta = response.meta || {};
        this.total = Number(meta.total || 0);
        this.totalPages = Math.max(1, Number(meta.totalPages || 1));
        this.page = Math.max(1, Number(meta.page || this.page));
                this.persistTablePreferences();
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
    if (this.isContextLocked) return;
    this.createInvoiceForm = this.newCreateInvoiceForm();
    this.error.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  openImportModal(): void {
    if (this.isContextLocked) return;
    this.importFile = null;
    this.forceImport = false;
    this.importModalError.set('');
    this.message.set('');
    this.error.set('');
    this.isImportModalOpen.set(true);
  }

  closeImportModal(): void {
    this.isImportModalOpen.set(false);
    this.importFile = null;
    this.forceImport = false;
    this.importModalError.set('');
  }

  createInvoice(): void {
    if (this.isContextLocked) {
      this.error.set('Select a specific organization before creating a sales invoice.');
      return;
    }
    if (!this.currentOrganizationId.trim()) {
      if (this.organizationContext.isAllOrganizationsSelected()) {
        this.error.set('Select a specific organization before creating a sales invoice.');
        return;
      }
      this.error.set('Logged in user has no organization assigned.');
      return;
    }

    if (this.createInvoiceForm.invalid) {
      this.createInvoiceForm.markAllAsTouched();
      this.error.set('Please complete all required sales invoice fields.');
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload({
      ...this.createInvoiceForm.getRawValue(),
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
    if (this.isContextLocked) {
      this.importModalError.set('Select a specific organization before importing sales invoices.');
      return;
    }
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
    this.importSummary.set(null);

    const formData = new FormData();
    formData.append('file', this.importFile);
    if (this.forceImport) {
      formData.append('forceImport', 'true');
    }
    if (this.currentOrganizationId.trim()) {
      formData.append('organizationId', this.currentOrganizationId.trim());
    }

    this.api.createFormData<Record<string, unknown>>('/api/v1/sales-invoices/import', formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.closeImportModal();
        const data = (response.data || {}) as Record<string, unknown>;
        const imported = Number(data['imported'] || 0);
        const updated = Number(data['updated'] || 0);
        const skipped = Number(data['skipped'] || 0);
        const totalRows = Number(data['totalRows'] || imported + updated + skipped);
        const errors = Array.isArray(data['errors'])
          ? data['errors'].map((row) => String(row || '').trim()).filter((row) => row.length > 0)
          : [];
        this.importSummary.set({
          imported,
          updated,
          skipped,
          totalRows,
          errors,
        });
        this.message.set(response.message || `Imported ${imported}, updated ${updated}, skipped ${skipped}.`);
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.importModalError.set(err?.error?.message || 'Unable to import sales invoices.');
      },
    });
  }

  clearImportSummary(): void {
    this.importSummary.set(null);
  }

  exportSalesInvoicesCsv(): void {
    if (this.isContextLocked) return;
    this.exporting.set(true);
    this.error.set('');
    this.message.set('');

    const params = new URLSearchParams();
    const q = this.searchQuery.trim();
    if (q) {
      params.set('q', q);
    }
    if (this.statusFilter) {
      params.set('status', this.statusFilter);
    }
    if (this.paymentStatusFilter) {
      params.set('paymentStatus', this.paymentStatusFilter);
    }
    if (this.issueDateFrom) {
      params.set('issueDateFrom', this.issueDateFrom);
    }
    if (this.issueDateTo) {
      params.set('issueDateTo', this.issueDateTo);
    }
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }
    params.set('sortBy', this.sortBy);
    params.set('sortDirection', this.sortDirection);

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
    if (this.isContextLocked) return;
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

  setViewMode(mode: TableViewMode): void {
    if (this.isContextLocked) return;
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  onFilterChange(): void {
    if (this.isContextLocked) return;
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  setSort(value: string): void {
    if (this.isContextLocked) return;
    this.sortBy = String(value || 'createdAt');
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  toggleSortDirection(): void {
    if (this.isContextLocked) return;
    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  clearFilters(): void {
    if (this.isContextLocked) return;
    this.searchQuery = '';
    this.statusFilter = '';
    this.paymentStatusFilter = '';
    this.issueDateFrom = '';
    this.issueDateTo = '';
    this.sortBy = 'createdAt';
    this.sortDirection = 'desc';
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  onPageSizeChange(value: string): void {
    if (this.isContextLocked) return;
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  goToPage(page: number): void {
    if (this.isContextLocked || page < 1 || page > this.totalPages || page === this.page || this.loading()) {
      return;
    }
    this.page = page;
    this.persistTablePreferences();
    this.load();
  }

  get hasActiveFilters(): boolean {
    return !!(
      this.searchQuery.trim() ||
      this.statusFilter ||
      this.paymentStatusFilter ||
      this.issueDateFrom ||
      this.issueDateTo
    );
  }

  get activeFilterCount(): number {
    let count = 0;
    if (this.searchQuery.trim()) count++;
    if (this.statusFilter) count++;
    if (this.paymentStatusFilter) count++;
    if (this.issueDateFrom || this.issueDateTo) count++;
    return count;
  }

  invoiceStatusLabel(value: string): string {
    const labels: Record<string, string> = {
      draft: 'Draft', issued: 'Issued', sent: 'Sent',
      partially_paid: 'Partially Paid', paid: 'Paid',
      overdue: 'Overdue', void: 'Void',
    };
    return labels[value] || value;
  }

  paymentStatusLabel(value: string): string {
    const labels: Record<string, string> = {
      unpaid: 'Unpaid', partially_paid: 'Partially Paid',
      paid: 'Paid', refunded: 'Refunded', failed: 'Failed',
    };
    return labels[value] || value;
  }

  organizationLabel(row: SalesInvoiceRow): string {
    if (row.organization?.name) return row.organization.name;
    if (row.organization?.legalName) return row.organization.legalName;
    return row.organizationId || '-';
  }

  invoiceStatusBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'paid':
      case 'issued':
      case 'sent':
        return 'text-bg-success';
      case 'partially_paid':
      case 'overdue':
        return 'text-bg-warning';
      case 'void':
      case 'cancelled':
        return 'text-bg-danger';
      case 'draft':
      default:
        return 'text-bg-secondary';
    }
  }

  paymentStatusBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'paid':
        return 'text-bg-success';
      case 'partially_paid':
        return 'text-bg-warning';
      case 'failed':
      case 'refunded':
        return 'text-bg-danger';
      case 'unpaid':
      default:
        return 'text-bg-secondary';
    }
  }

  formatMoney(value: unknown, currency: string): string {
    const amount = Number(value ?? 0);
    const normalized = Number.isFinite(amount) ? amount : 0;
    const code = String(currency || this.currentOrganizationCurrency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(normalized);
    } catch (_err) {
      return `${code} ${normalized.toFixed(2)}`;
    }
  }

  private restoreTablePreferences(): void {
    const prefs = loadTablePreferences(this.tablePrefsKey);
    this.page = toPositiveInt(prefs['page'], this.page);
    this.pageSize = toPositiveInt(prefs['pageSize'], this.pageSize);
    this.viewMode = toTableViewMode(prefs['viewMode'], this.viewMode);
  }

  private persistTablePreferences(): void {
    saveTablePreferences(this.tablePrefsKey, {
      page: this.page,
      pageSize: this.pageSize,
      viewMode: this.viewMode,
    });
  }

  trackById(_index: number, row: SalesInvoiceRow): string {
    return row.id;
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
      amount: 0,
      taxableAmount: 0,
      withHoldingTaxAmount: 0,
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

  private newCreateInvoiceForm(): FormGroup {
    const defaults = this.newInvoiceForm();
    return this.fb.group(
      {
        orderId: [defaults['orderId']],
        invoiceNumber: [defaults['invoiceNumber'], [Validators.required, Validators.maxLength(120)]],
        issueDate: [defaults['issueDate'], [Validators.required]],
        dueDate: [defaults['dueDate']],
        status: [defaults['status'], [Validators.required]],
        paymentStatus: [defaults['paymentStatus'], [Validators.required]],
        amount: [defaults['amount'], [Validators.required, Validators.min(0)]],
        taxAmount: [defaults['taxAmount'], [Validators.min(0)]],
        taxableAmount: [defaults['taxableAmount'], [Validators.min(0)]],
        withHoldingTaxAmount: [defaults['withHoldingTaxAmount'], [Validators.min(0)]],
        discountAmount: [defaults['discountAmount'], [Validators.min(0)]],
        totalAmount: [defaults['totalAmount'], [Validators.required, Validators.min(0)]],
        paidAt: [defaults['paidAt']],
        notes: [defaults['notes'], [Validators.maxLength(2000)]],
      },
      { validators: [this.invoiceDateRangeValidator] }
    );
  }

  private invoiceDateRangeValidator(control: AbstractControl): ValidationErrors | null {
    const issueDate = String(control.get('issueDate')?.value || '').trim();
    const dueDate = String(control.get('dueDate')?.value || '').trim();
    if (!issueDate || !dueDate) {
      return null;
    }
    if (new Date(dueDate).getTime() < new Date(issueDate).getTime()) {
      return { invalidDateRange: true };
    }
    return null;
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      organizationId: this.asString(form['organizationId']),
      orderId: this.optionalString(form['orderId']),
      invoiceNumber: this.asString(form['invoiceNumber']),
      issueDate: this.asString(form['issueDate']),
      dueDate: this.optionalString(form['dueDate']),
      status: this.optionalString(form['status']),
      paymentStatus: this.optionalString(form['paymentStatus']),
      amount: this.optionalNumber(form['amount']),
      taxableAmount: this.optionalNumber(form['taxableAmount']),
      withHoldingTaxAmount: this.optionalNumber(form['withHoldingTaxAmount']),
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
