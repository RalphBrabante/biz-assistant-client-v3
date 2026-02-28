import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';

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
  fileCdnUrl?: string;
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
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TooltipDirective],
  templateUrl: './expenses-page.component.html',
})
export class ExpensesPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly fb = inject(FormBuilder);

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
  readonly isVendorCreateModalOpen = signal(false);
  readonly creatingVendor = signal(false);
  readonly vendorCreateError = signal('');
  readonly createFileName = signal('');

  readonly message = signal('');
  readonly error = signal('');
  readonly createModalError = signal('');
  readonly editModalError = signal('');
  readonly importModalError = signal('');
  readonly importSummary = signal<ExpenseImportSummary | null>(null);
  viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'expenses-page';
  searchQuery = '';
  statusFilter = '';
  paymentMethodFilter = '';
  expenseDateFrom = '';
  expenseDateTo = '';
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  readonly pageSizeOptions = [10, 20, 50, 100];

  createExpenseForm: FormGroup = this.newCreateExpenseForm();
  vendorCreateForm: FormGroup = this.newVendorCreateForm();
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

  closeOrganizationWarningModal(): void {
    this.showOrganizationWarningModal = false;
  }

  ngOnDestroy(): void {
    this.vendorSearchSub?.unsubscribe();
  }

  load(resetPage = false): void {
    if (this.isContextLocked) {
      this.loading.set(false);
      this.rows.set([]);
      this.total = 0;
      this.totalPages = 1;
      this.page = 1;
      this.error.set('');
      return;
    }
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
                  this.persistTablePreferences();
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
    if (this.isContextLocked) return;
    this.createExpenseForm = this.newCreateExpenseForm();
    this.loadWithholdingTaxTypes();
    this.vendorSearch.set('');
    this.selectedCreateVendor.set(null);
    this.vendors.set([]);
    this.isVendorCreateModalOpen.set(false);
    this.vendorCreateError.set('');
    this.createFile = null;
    this.createFileName.set('');
    this.vendorCreateForm = this.newVendorCreateForm();
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
    this.isVendorCreateModalOpen.set(false);
    this.vendorCreateError.set('');
    this.createModalError.set('');
    this.createFile = null;
    this.createFileName.set('');
    this.vendorCreateForm = this.newVendorCreateForm();
  }

  openImportModal(): void {
    if (this.isContextLocked) return;
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
    if (this.isContextLocked) {
      this.createModalError.set('Select a specific organization before creating an expense.');
      return;
    }
    if (!this.currentOrganizationId) {
      if (this.organizationContext.isAllOrganizationsSelected()) {
        this.createModalError.set('Select a specific organization before creating an expense.');
        return;
      }
      this.createModalError.set('Logged in user has no organization assigned.');
      return;
    }
    if (this.createExpenseForm.invalid) {
      this.createExpenseForm.markAllAsTouched();
      this.createModalError.set('Please complete all required fields.');
      return;
    }

    const vendorId = String(this.createExpenseForm.value['vendorId'] || '').trim();
    if (!vendorId) {
      this.createExpenseForm.get('vendorId')?.markAsTouched();
      this.createModalError.set('Please select a vendor from search results.');
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.createModalError.set('');
    this.message.set('');

    const payload = this.buildPayload({
      ...this.createExpenseForm.getRawValue(),
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
    if (this.isContextLocked) return;
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
    if (this.isContextLocked) return;
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
    if (this.isContextLocked) return;
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

  setViewMode(mode: TableViewMode): void {
    if (this.isContextLocked) return;
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  applyFilters(): void {
    if (this.isContextLocked) return;
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  clearFilters(): void {
    if (this.isContextLocked) return;
    this.searchQuery = '';
    this.statusFilter = '';
    this.paymentMethodFilter = '';
    this.expenseDateFrom = '';
    this.expenseDateTo = '';
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

  organizationLabel(row: ExpenseRow): string {
    return row.organization?.name || row.organization?.legalName || row.organizationId || '-';
  }

  vendorLabel(row: ExpenseRow): string {
    return row.vendor?.name || row.vendorTaxId || row.vendorId || '-';
  }

  taxTypeLabel(row: ExpenseRow): string {
    if (row.taxType?.name) return row.taxType.name;
    if (row.taxType?.code) return row.taxType.code;
    return '-';
  }

  withholdingTaxTypeLabel(row: ExpenseRow): string {
    if (row.withholdingTaxType?.name) return row.withholdingTaxType.name;
    if (row.withholdingTaxType?.code) return row.withholdingTaxType.code;
    return '-';
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

  onVendorSearchChange(value: string): void {
    if (this.isContextLocked) return;
    const query = String(value || '');
    this.vendorSearch.set(query);
    if (!query.trim()) {
      this.vendors.set([]);
      this.loadingVendors.set(false);
      return;
    }
    this.vendorSearchInput$.next(query);
  }

  selectVendor(vendor: VendorOption): void {
    if (this.isContextLocked) return;
    this.selectedCreateVendor.set(vendor);
    this.createExpenseForm.patchValue({
      vendorId: vendor.id,
      vendorTaxId: vendor.taxId || '',
    });
    this.createExpenseForm.get('vendorId')?.markAsTouched();
    this.createExpenseForm.get('vendorId')?.updateValueAndValidity();
    this.vendors.set([]);
    this.vendorSearch.set(vendor.name || vendor.legalName || vendor.id);
  }

  clearSelectedVendor(): void {
    if (this.isContextLocked) return;
    this.selectedCreateVendor.set(null);
    this.createExpenseForm.patchValue({
      vendorId: '',
      vendorTaxId: '',
    });
    this.createExpenseForm.get('vendorId')?.markAsTouched();
    this.createExpenseForm.get('vendorId')?.updateValueAndValidity();
    this.vendorSearch.set('');
    this.vendors.set([]);
  }

  openVendorCreateModal(): void {
    if (this.isContextLocked) return;
    this.vendorCreateError.set('');
    this.vendorCreateForm = this.newVendorCreateForm();
    this.isVendorCreateModalOpen.set(true);
  }

  closeVendorCreateModal(): void {
    if (this.isContextLocked) return;
    if (this.creatingVendor()) {
      return;
    }
    this.isVendorCreateModalOpen.set(false);
    this.vendorCreateError.set('');
  }

  createVendorFromModal(): void {
    if (this.isContextLocked) return;
    if (!this.currentOrganizationId) {
      this.vendorCreateError.set('Select a specific organization first.');
      return;
    }
    if (this.vendorCreateForm.invalid) {
      this.vendorCreateForm.markAllAsTouched();
      this.vendorCreateError.set('Please complete all required vendor fields.');
      return;
    }

    this.creatingVendor.set(true);
    this.vendorCreateError.set('');

    const payload = {
      ...this.vendorCreateForm.getRawValue(),
      organizationId: this.currentOrganizationId,
      createdBy: this.currentUserId,
      updatedBy: this.currentUserId,
    };

    this.api.create<VendorOption>('/api/v1/vendors', payload).subscribe({
      next: (response) => {
        this.creatingVendor.set(false);
        const created = response.data;
        if (created?.id) {
          const createdVendorName =
            String(created.name || '').trim() ||
            String(this.vendorCreateForm.get('name')?.value || '').trim();
          this.selectVendor({
            id: created.id,
            name: createdVendorName,
            legalName: created.legalName,
            taxId: created.taxId,
            status: created.status,
          });
          this.closeVendorCreateModal();
          this.message.set('Vendor created and selected.');
        }
      },
      error: (err) => {
        this.creatingVendor.set(false);
        this.vendorCreateError.set(err?.error?.message || 'Unable to create vendor.');
      },
    });
  }

  onCreateFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.createFile = target?.files && target.files.length > 0 ? target.files[0] : null;
    this.createFileName.set(this.createFile?.name || '');
    const fileControl = this.createExpenseForm.get('file');
    if (this.createFile) {
      fileControl?.setValue(this.createFile.name);
      const isImage = this.createFile.type.startsWith('image/');
      const maxBytes = 5 * 1024 * 1024;
      if (!isImage) {
        fileControl?.setErrors({ invalidType: true });
      } else if (this.createFile.size > maxBytes) {
        fileControl?.setErrors({ tooLarge: true });
      } else {
        fileControl?.setErrors(null);
      }
    } else {
      fileControl?.setValue('');
      fileControl?.setErrors(null);
    }
    fileControl?.markAsTouched();
  }

  onImportFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.importFile = target?.files && target.files.length > 0 ? target.files[0] : null;
  }

  importExpensesCsv(): void {
    if (this.isContextLocked) {
      this.importModalError.set('Select a specific organization before importing expenses.');
      return;
    }
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
    if (this.currentOrganizationId) {
      formData.append('organizationId', this.currentOrganizationId);
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
        this.importSummary.set({ imported, skipped, totalRows, errors });
        this.message.set(response.message || `Imported ${imported}, skipped ${skipped}.`);
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.importModalError.set(err?.error?.message || 'Unable to import expenses.');
      },
    });
  }

  exportExpensesCsv(): void {
    if (this.isContextLocked) return;
    this.exporting.set(true);
    this.error.set('');
    this.message.set('');

    const params = new URLSearchParams();
    if (this.searchQuery.trim()) params.set('q', this.searchQuery.trim());
    if (this.statusFilter) params.set('status', this.statusFilter);
    if (this.paymentMethodFilter) params.set('paymentMethod', this.paymentMethodFilter);
    if (this.expenseDateFrom) params.set('expenseDateFrom', this.expenseDateFrom);
    if (this.expenseDateTo) params.set('expenseDateTo', this.expenseDateTo);
    if (this.currentOrganizationId) params.set('organizationId', this.currentOrganizationId);

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

  clearImportSummary(): void {
    this.importSummary.set(null);
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

  trackById(_index: number, row: ExpenseRow): string {
    return row.id;
  }

  controlHasError(controlName: string, errorCode?: string): boolean {
    const control = this.createExpenseForm.get(controlName);
    if (!control || !(control.touched || control.dirty)) {
      return false;
    }
    if (!errorCode) {
      return control.invalid;
    }
    return !!control.errors?.[errorCode];
  }

  hasCreateFormError(errorCode: string): boolean {
    return !!this.createExpenseForm.errors?.[errorCode];
  }

  vendorCreateControlHasError(controlName: string, errorCode?: string): boolean {
    const control = this.vendorCreateForm.get(controlName);
    if (!control || !(control.touched || control.dirty)) {
      return false;
    }
    if (!errorCode) {
      return control.invalid;
    }
    return !!control.errors?.[errorCode];
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

  private newCreateExpenseForm(): FormGroup {
    return this.fb.group(
      {
        vendorId: ['', [Validators.required]],
        vendorTaxId: [''],
        expenseNumber: [''],
        vatExemptAmount: [0, [Validators.required, Validators.min(0)]],
        withholdingTaxTypeId: [''],
        category: ['', [Validators.required, Validators.maxLength(120)]],
        description: ['', [Validators.maxLength(2000)]],
        expenseDate: ['', [Validators.required]],
        dueDate: [''],
        status: ['draft', [Validators.required]],
        paymentMethod: ['bank_transfer', [Validators.required]],
        amount: [0, [Validators.required, Validators.min(0.01)]],
        discountAmount: [0, [Validators.required, Validators.min(0)]],
        notes: ['', [Validators.maxLength(2000)]],
        file: [''],
      },
      {
        validators: [this.expenseDateRangeValidator, this.vatExemptNotGreaterThanAmountValidator],
      }
    );
  }

  private expenseDateRangeValidator(control: AbstractControl): ValidationErrors | null {
    const expenseDate = String(control.get('expenseDate')?.value || '').trim();
    const dueDate = String(control.get('dueDate')?.value || '').trim();
    if (!expenseDate || !dueDate) {
      return null;
    }
    if (new Date(dueDate).getTime() < new Date(expenseDate).getTime()) {
      return { invalidDateRange: true };
    }
    return null;
  }

  private vatExemptNotGreaterThanAmountValidator(control: AbstractControl): ValidationErrors | null {
    const amount = Number(control.get('amount')?.value ?? 0);
    const vatExemptAmount = Number(control.get('vatExemptAmount')?.value ?? 0);
    if (!Number.isFinite(amount) || !Number.isFinite(vatExemptAmount)) {
      return null;
    }
    if (vatExemptAmount > amount) {
      return { vatExemptTooHigh: true };
    }
    return null;
  }

  private newVendorCreateForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(120)]],
      legalName: ['', [Validators.maxLength(120)]],
      taxId: ['', [Validators.required, Validators.pattern(/^\d{3}-\d{3}-\d{3}-\d{5}$/)]],
      contactPerson: ['', [Validators.maxLength(120)]],
      contactEmail: ['', [Validators.email, Validators.maxLength(120)]],
      phone: ['', [Validators.maxLength(50)]],
      addressLine1: ['', [Validators.maxLength(255)]],
      addressLine2: ['', [Validators.maxLength(255)]],
      city: ['', [Validators.maxLength(120)]],
      state: ['', [Validators.maxLength(120)]],
      barangay: ['', [Validators.maxLength(120)]],
      province: ['', [Validators.maxLength(120)]],
      postalCode: ['', [Validators.maxLength(50)]],
      country: ['United States', [Validators.maxLength(100)]],
      paymentTerms: ['', [Validators.maxLength(120)]],
      status: ['active', [Validators.required]],
      notes: ['', [Validators.maxLength(2000)]],
    });
  }

  onVendorTaxIdInput(value: string): void {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
    const parts = [
      digits.slice(0, 3),
      digits.slice(3, 6),
      digits.slice(6, 9),
      digits.slice(9, 14),
    ].filter((part) => part.length > 0);
    const masked = parts.join('-');

    this.vendorCreateForm.patchValue({ taxId: masked }, { emitEvent: false });
    this.vendorCreateForm.get('taxId')?.markAsTouched();
    this.vendorCreateForm.get('taxId')?.updateValueAndValidity();
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
