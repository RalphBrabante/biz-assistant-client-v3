import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ApiResponse } from '../core/types';
import { TooltipDirective } from '../shared/tooltip.directive';

interface ExpenseRow {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  vendorId: string;
  vendorTaxId?: string;
  expenseNumber?: string;
  vatExemptAmount?: number;
  taxableAmount?: number;
  withHoldingTaxAmount?: number;
  category: string;
  description?: string;
  expenseDate: string;
  dueDate?: string;
  status?: string;
  paymentMethod?: string;
  currency?: string;
  amount?: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  file?: string;
  notes?: string;
  vendor?: {
    id: string;
    name?: string;
    taxId?: string;
  };
  taxTypeId?: string;
  taxType?: {
    id: string;
    code?: string;
    name?: string;
    percentage?: number;
  };
  withholdingTaxTypeId?: string;
  withholdingTaxType?: {
    id: string;
    code?: string;
    name?: string;
    percentage?: number;
  };
}

interface VendorOption {
  id: string;
  name: string;
  legalName?: string;
  taxId?: string;
  status?: string;
}

interface WithholdingTaxTypeOption {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  percentage: number;
  appliesTo?: 'expense' | 'invoice' | 'both';
  isActive?: boolean;
}

interface ExpenseImportSummary {
  imported: number;
  skipped: number;
  totalRows: number;
  errors: string[];
}

@Component({
  selector: 'app-expenses-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TooltipDirective],
  templateUrl: './expenses-page.component.html',
})
export class ExpensesPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);

  readonly rows = signal<ExpenseRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);
  readonly isImportModalOpen = signal(false);
  readonly exporting = signal(false);
  readonly loadingVendors = signal(false);
  readonly vendors = signal<VendorOption[]>([]);
  readonly withholdingTaxTypes = signal<WithholdingTaxTypeOption[]>([]);
  readonly vendorSearch = signal('');
  readonly selectedCreateVendor = signal<VendorOption | null>(null);
  readonly showInlineVendorCreate = signal(false);
  readonly creatingVendor = signal(false);
  readonly vendorCreateError = signal('');
  readonly createFileName = signal('');

  readonly message = signal('');
  readonly error = signal('');
  readonly createModalError = signal('');
  readonly editModalError = signal('');
  readonly importModalError = signal('');
  readonly importSummary = signal<ExpenseImportSummary | null>(null);
  readonly pageSizeOptions = [10, 20, 50, 100];
  searchQuery = '';
  statusFilter = '';
  paymentMethodFilter = '';
  expenseDateFrom = '';
  expenseDateTo = '';
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;

  createForm: Record<string, unknown> = this.newExpenseForm();
  vendorCreateForm: Record<string, unknown> = this.newVendorForm();
  editingId = '';
  editForm: Record<string, unknown> = this.newExpenseForm();
  private readonly vendorSearchInput$ = new Subject<string>();
  private vendorSearchSub?: Subscription;
  private createFile: File | null = null;
  private importFile: File | null = null;

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
  }

  get currentUserId(): string {
    return this.auth.currentUser()?.id || '';
  }

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  ngOnInit(): void {
    this.loadWithholdingTaxTypes();
    this.load();
    this.vendorSearchSub = this.vendorSearchInput$
      .pipe(debounceTime(350), distinctUntilChanged())
      .pipe(
        switchMap((value) => {
          if (!this.currentOrganizationId) {
            this.loadingVendors.set(false);
            return of([] as VendorOption[]);
          }

          const cleaned = String(value || '').trim();
          if (cleaned.length > 0 && cleaned.length < 2) {
            this.loadingVendors.set(false);
            return of([] as VendorOption[]);
          }

          this.loadingVendors.set(true);
          const params = new URLSearchParams({
            limit: '20',
            activeOnly: 'true',
          });
          if (cleaned) {
            params.set('q', cleaned);
          }

          return this.api.list<VendorOption>(`/api/v1/vendors?${params.toString()}`).pipe(
            map((response: ApiResponse<VendorOption[]>) => response.data || []),
            catchError(() => of([] as VendorOption[]))
          );
        })
      )
      .subscribe((vendors) => {
        this.loadingVendors.set(false);
        this.vendors.set(vendors);
      });
  }

  ngOnDestroy(): void {
    this.vendorSearchSub?.unsubscribe();
  }

  load(resetPage = false): void {
    if (!this.currentOrganizationId && !this.organizationContext.isAllOrganizationsSelected()) {
      this.error.set('Logged in user has no organization assigned.');
      this.rows.set([]);
      return;
    }
    if (resetPage) {
      this.page = 1;
    }

    this.loading.set(true);
    this.error.set('');

    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
    });
    const q = this.searchQuery.trim();
    if (q) {
      params.set('q', q);
    }
    if (this.statusFilter) {
      params.set('status', this.statusFilter);
    }
    if (this.paymentMethodFilter) {
      params.set('paymentMethod', this.paymentMethodFilter);
    }
    if (this.expenseDateFrom) {
      params.set('expenseDateFrom', this.expenseDateFrom);
    }
    if (this.expenseDateTo) {
      params.set('expenseDateTo', this.expenseDateTo);
    }
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }

    this.api.list<ExpenseRow>(`/api/v1/expenses?${params.toString()}`).subscribe({
        next: (response) => {
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
          this.error.set(err?.error?.message || 'Unable to load expenses.');
        },
      });
  }

  loadWithholdingTaxTypes(): void {
    const params = new URLSearchParams({
      activeOnly: 'true',
      appliesTo: 'expense',
    });
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }

    this.api
      .list<WithholdingTaxTypeOption>(`/api/v1/withholding-tax-types?${params.toString()}`)
      .subscribe({
        next: (response) => {
          this.withholdingTaxTypes.set(response.data || []);
        },
        error: () => {
          this.withholdingTaxTypes.set([]);
        },
      });
  }

  openCreateModal(): void {
    this.createForm = this.newExpenseForm();
    this.loadWithholdingTaxTypes();
    this.vendorSearch.set('');
    this.selectedCreateVendor.set(null);
    this.vendors.set([]);
    this.showInlineVendorCreate.set(false);
    this.vendorCreateError.set('');
    this.createFile = null;
    this.createFileName.set('');
    this.vendorCreateForm = this.newVendorForm();
    this.loadingVendors.set(false);
    this.error.set('');
    this.createModalError.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
    this.vendorSearch.set('');
    this.selectedCreateVendor.set(null);
    this.vendors.set([]);
    this.showInlineVendorCreate.set(false);
    this.vendorCreateError.set('');
    this.createModalError.set('');
    this.createFile = null;
    this.createFileName.set('');
    this.vendorCreateForm = this.newVendorForm();
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

  createExpense(): void {
    if (!this.currentOrganizationId) {
      if (this.organizationContext.isAllOrganizationsSelected()) {
        this.createModalError.set('Select a specific organization before creating an expense.');
        return;
      }
      this.createModalError.set('Logged in user has no organization assigned.');
      return;
    }
    if (!String(this.createForm['vendorId'] || '').trim()) {
      this.createModalError.set('Please select a vendor from search results.');
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.createModalError.set('');
    this.message.set('');

    const payload = this.buildPayload({
      ...this.createForm,
      organizationId: this.currentOrganizationId,
      createdBy: this.currentUserId,
      updatedBy: this.currentUserId,
    });
    const formData = new FormData();
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    }
    if (this.createFile) {
      formData.append('file', this.createFile);
    }

    this.api.createFormData<ExpenseRow>('/api/v1/expenses', formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Expense created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.createModalError.set(err?.error?.message || 'Unable to create expense.');
      },
    });
  }

  startEdit(row: ExpenseRow): void {
    this.loadWithholdingTaxTypes();
    this.editingId = row.id;
    this.editForm = {
      organizationId: row.organizationId || '',
      vendorId: row.vendorId || '',
      vendorTaxId: row.vendorTaxId || '',
      expenseNumber: row.expenseNumber || '',
      vatExemptAmount: row.vatExemptAmount ?? 0,
      withholdingTaxTypeId: row.withholdingTaxTypeId || row.withholdingTaxType?.id || '',
      category: row.category || '',
      description: row.description || '',
      expenseDate: row.expenseDate || '',
      dueDate: row.dueDate || '',
      status: row.status || 'draft',
      paymentMethod: row.paymentMethod || 'bank_transfer',
      currency: row.currency || this.currentOrganizationCurrency,
      amount: row.amount ?? 0,
      discountAmount: row.discountAmount ?? 0,
      notes: row.notes || '',
      updatedBy: this.currentUserId,
    };
    this.editModalError.set('');
    this.isEditModalOpen.set(true);
  }

  cancelEdit(): void {
    this.editingId = '';
    this.editForm = this.newExpenseForm();
    this.editModalError.set('');
    this.isEditModalOpen.set(false);
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId) return;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Expense',
      message: 'Save changes to this expense?',
      confirmText: 'Update Expense',
      confirmButtonClass: 'btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');
    this.editModalError.set('');

    const payload = this.buildPayload(this.editForm);
    this.api.update<ExpenseRow>('/api/v1/expenses', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Expense updated successfully.');
        this.cancelEdit();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.editModalError.set(err?.error?.message || 'Unable to update expense.');
      },
    });
  }

  async removeExpense(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Expense',
      message: 'Delete this expense? This action cannot be undone.',
      confirmText: 'Delete Expense',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-cash-stack',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/expenses', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Expense deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete expense.');
      },
    });
  }

  trackById(_index: number, row: ExpenseRow): string {
    return row.id;
  }

  onCreateFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files && target.files.length > 0 ? target.files[0] : null;
    this.createFile = file;
    this.createFileName.set(file ? file.name : '');
  }

  onImportFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.importFile = target?.files && target.files.length > 0 ? target.files[0] : null;
  }

  importExpensesCsv(): void {
    if (!this.importFile) {
      this.importModalError.set('Please select a CSV file to import.');
      return;
    }
    if (this.organizationContext.isAllOrganizationsSelected()) {
      this.importModalError.set('Select a specific organization before importing expenses.');
      return;
    }

    this.submitting.set(true);
    this.importModalError.set('');
    this.error.set('');
    this.message.set('');
    this.importSummary.set(null);

    const formData = new FormData();
    formData.append('file', this.importFile);
    if (this.currentOrganizationId.trim()) {
      formData.append('organizationId', this.currentOrganizationId.trim());
    }

    this.api.createFormData<Record<string, unknown>>('/api/v1/expenses/import', formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.closeImportModal();
        const data = (response.data || {}) as Record<string, unknown>;
        const imported = Number(data['imported'] || 0);
        const skipped = Number(data['skipped'] || 0);
        const totalRows = Number(data['totalRows'] || imported + skipped);
        const errors = Array.isArray(data['errors'])
          ? data['errors'].map((row) => String(row || '').trim()).filter((row) => row.length > 0)
          : [];
        this.importSummary.set({
          imported,
          skipped,
          totalRows,
          errors,
        });
        this.message.set(response.message || `Imported ${imported}, skipped ${skipped}.`);
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.importModalError.set(err?.error?.message || 'Unable to import expenses.');
      },
    });
  }

  clearImportSummary(): void {
    this.importSummary.set(null);
  }

  exportExpensesCsv(): void {
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
    if (this.paymentMethodFilter) {
      params.set('paymentMethod', this.paymentMethodFilter);
    }
    if (this.expenseDateFrom) {
      params.set('expenseDateFrom', this.expenseDateFrom);
    }
    if (this.expenseDateTo) {
      params.set('expenseDateTo', this.expenseDateTo);
    }
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }

    this.api.download(`/api/v1/expenses/export?${params.toString()}`).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.message.set('Expenses CSV exported successfully.');
      },
      error: (err) => {
        this.exporting.set(false);
        this.error.set(err?.error?.message || 'Unable to export expenses.');
      },
    });
  }

  applyFilters(): void {
    this.load(true);
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.statusFilter = '';
    this.paymentMethodFilter = '';
    this.expenseDateFrom = '';
    this.expenseDateTo = '';
    this.load(true);
  }

  onPageSizeChange(value: string): void {
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.load(true);
  }

  goToPage(page: number): void {
    if (this.loading() || page < 1 || page > this.totalPages || page === this.page) {
      return;
    }
    this.page = page;
    this.load();
  }

  vendorLabel(row: ExpenseRow): string {
    return row.vendor?.name || row.vendorId || '-';
  }

  taxTypeLabel(row: ExpenseRow): string {
    if (!row.taxType) {
      return '-';
    }
    const code = String(row.taxType.code || '').trim();
    const name = String(row.taxType.name || '').trim();
    const pct = row.taxType.percentage;
    const pctLabel = typeof pct === 'number' && Number.isFinite(pct) ? ` (${pct}%)` : '';
    if (code && name) {
      return `${code} - ${name}${pctLabel}`;
    }
    return code || name || '-';
  }

  withholdingTaxTypeLabel(row: ExpenseRow): string {
    if (!row.withholdingTaxType) {
      return '-';
    }
    const code = String(row.withholdingTaxType.code || '').trim();
    const name = String(row.withholdingTaxType.name || '').trim();
    const pct = row.withholdingTaxType.percentage;
    const pctLabel = typeof pct === 'number' && Number.isFinite(pct) ? ` (${pct}%)` : '';
    if (code && name) {
      return `${code} - ${name}${pctLabel}`;
    }
    return code || name || '-';
  }

  organizationLabel(row: ExpenseRow): string {
    return row.organization?.name || row.organization?.legalName || row.organizationId || '-';
  }

  onVendorSearchChange(value: string): void {
    this.vendorSearch.set(value);
    this.selectedCreateVendor.set(null);
    this.showInlineVendorCreate.set(false);
    this.vendorCreateError.set('');
    this.createForm['vendorId'] = '';
    this.createForm['vendorTaxId'] = '';
    const cleaned = String(value || '').trim();
    if (!cleaned) {
      this.loadingVendors.set(false);
      this.vendors.set([]);
      return;
    }
    this.vendorSearchInput$.next(value);
  }

  selectVendor(vendor: VendorOption): void {
    this.selectedCreateVendor.set(vendor);
    this.vendorSearch.set(vendor.name || vendor.legalName || '');
    this.showInlineVendorCreate.set(false);
    this.vendorCreateError.set('');
    this.createForm['vendorId'] = vendor.id;
    this.createForm['vendorTaxId'] = vendor.taxId || '';
    this.vendors.set([]);
  }

  clearSelectedVendor(): void {
    this.selectedCreateVendor.set(null);
    this.vendorSearch.set('');
    this.createForm['vendorId'] = '';
    this.createForm['vendorTaxId'] = '';
    this.vendors.set([]);
    this.showInlineVendorCreate.set(false);
    this.vendorCreateError.set('');
  }

  openInlineVendorCreate(): void {
    this.showInlineVendorCreate.set(true);
    this.vendorCreateError.set('');
    this.vendorCreateForm = {
      ...this.newVendorForm(),
      name: this.vendorSearch().trim(),
    };
  }

  cancelInlineVendorCreate(): void {
    this.showInlineVendorCreate.set(false);
    this.vendorCreateError.set('');
    this.vendorCreateForm = this.newVendorForm();
  }

  createVendorFromInline(): void {
    const name = String(this.vendorCreateForm['name'] || '').trim();
    if (!name) {
      this.vendorCreateError.set('Vendor name is required.');
      return;
    }

    this.creatingVendor.set(true);
    this.vendorCreateError.set('');

    const payload = {
      name,
      legalName: this.optionalString(this.vendorCreateForm['legalName']),
      taxId: this.optionalString(this.vendorCreateForm['taxId']),
      contactPerson: this.optionalString(this.vendorCreateForm['contactPerson']),
      contactEmail: this.optionalString(this.vendorCreateForm['contactEmail']),
      phone: this.optionalString(this.vendorCreateForm['phone']),
      addressLine1: this.optionalString(this.vendorCreateForm['addressLine1']),
      addressLine2: this.optionalString(this.vendorCreateForm['addressLine2']),
      city: this.optionalString(this.vendorCreateForm['city']),
      state: this.optionalString(this.vendorCreateForm['state']),
      barangay: this.optionalString(this.vendorCreateForm['barangay']),
      province: this.optionalString(this.vendorCreateForm['province']),
      postalCode: this.optionalString(this.vendorCreateForm['postalCode']),
      country: this.optionalString(this.vendorCreateForm['country']),
      paymentTerms: this.optionalString(this.vendorCreateForm['paymentTerms']),
      notes: this.optionalString(this.vendorCreateForm['notes']),
      status: this.optionalString(this.vendorCreateForm['status']) || 'active',
      createdBy: this.currentUserId || undefined,
      updatedBy: this.currentUserId || undefined,
    };

    this.api.create<VendorOption>('/api/v1/vendors', payload).subscribe({
      next: (response) => {
        this.creatingVendor.set(false);
        const createdVendor = response.data;
        if (!createdVendor) {
          this.vendorCreateError.set('Vendor was created but no record was returned.');
          return;
        }

        this.selectVendor(createdVendor);
        this.vendorSearch.set(createdVendor.name || createdVendor.legalName || '');
        this.createForm['vendorId'] = createdVendor.id;
        this.createForm['vendorTaxId'] = createdVendor.taxId || '';
        this.showInlineVendorCreate.set(false);
        this.vendorCreateForm = this.newVendorForm();
      },
      error: (err) => {
        this.creatingVendor.set(false);
        this.vendorCreateError.set(err?.error?.message || 'Unable to create vendor.');
      },
    });
  }

  private newExpenseForm(): Record<string, unknown> {
    return {
      organizationId: '',
      vendorId: '',
      vendorTaxId: '',
      expenseNumber: '',
      vatExemptAmount: 0,
      withholdingTaxTypeId: '',
      category: '',
      description: '',
      expenseDate: '',
      dueDate: '',
      status: 'draft',
      paymentMethod: 'bank_transfer',
      currency: this.currentOrganizationCurrency,
      amount: 0,
      discountAmount: 0,
      notes: '',
      createdBy: '',
      updatedBy: '',
    };
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
      barangay: '',
      province: '',
      postalCode: '',
      country: 'United States',
      paymentTerms: '',
      status: 'active',
      notes: '',
    };
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      organizationId: this.optionalString(form['organizationId']),
      vendorId: this.optionalString(form['vendorId']),
      vendorTaxId: this.optionalString(form['vendorTaxId']),
      expenseNumber: this.optionalString(form['expenseNumber']),
      vatExemptAmount: this.optionalNumber(form['vatExemptAmount']),
      withholdingTaxTypeId: this.optionalString(form['withholdingTaxTypeId']),
      category: this.optionalString(form['category']),
      description: this.optionalString(form['description']),
      expenseDate: this.optionalString(form['expenseDate']),
      dueDate: this.optionalString(form['dueDate']),
      status: this.optionalString(form['status']),
      paymentMethod: this.optionalString(form['paymentMethod']),
      amount: this.optionalNumber(form['amount']),
      discountAmount: this.optionalNumber(form['discountAmount']),
      notes: this.optionalString(form['notes']),
      createdBy: this.optionalString(form['createdBy']),
      updatedBy: this.optionalString(form['updatedBy']),
    };
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
