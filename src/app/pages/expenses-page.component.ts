import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ApiResponse } from '../core/types';
import { TooltipDirective } from '../shared/tooltip.directive';

interface ExpenseRow {
  id: string;
  organizationId: string;
  vendorId: string;
  vendorTaxId?: string;
  expenseNumber?: string;
  vatExemptAmount?: number;
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
  notes?: string;
  vendor?: {
    id: string;
    name?: string;
    taxId?: string;
  };
}

interface VendorOption {
  id: string;
  name: string;
  legalName?: string;
  taxId?: string;
  status?: string;
}

@Component({
  selector: 'app-expenses-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TooltipDirective],
  templateUrl: './expenses-page.component.html',
})
export class ExpensesPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly rows = signal<ExpenseRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly loadingVendors = signal(false);
  readonly vendors = signal<VendorOption[]>([]);
  readonly vendorSearch = signal('');
  readonly selectedCreateVendor = signal<VendorOption | null>(null);
  readonly showInlineVendorCreate = signal(false);
  readonly creatingVendor = signal(false);
  readonly vendorCreateError = signal('');

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');

  createForm: Record<string, unknown> = this.newExpenseForm();
  vendorCreateForm: Record<string, unknown> = this.newVendorForm();
  editingId = '';
  editForm: Record<string, unknown> = this.newExpenseForm();
  private readonly vendorSearchInput$ = new Subject<string>();
  private vendorSearchSub?: Subscription;

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }
    return this.rows().filter((row) => {
      return (
        String(row.expenseNumber || '').toLowerCase().includes(q) ||
        String(row.category || '').toLowerCase().includes(q) ||
        String(row.status || '').toLowerCase().includes(q) ||
        String(row.vendor?.name || '').toLowerCase().includes(q) ||
        String(row.vendorTaxId || '').toLowerCase().includes(q)
      );
    });
  });

  get currentOrganizationId(): string {
    return this.auth.currentUser()?.organizationId || '';
  }

  get currentUserId(): string {
    return this.auth.currentUser()?.id || '';
  }

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  ngOnInit(): void {
    this.load();
    this.vendorSearchSub = this.vendorSearchInput$
      .pipe(debounceTime(350), distinctUntilChanged())
      .subscribe((value) => {
        this.loadVendors(value);
      });
  }

  ngOnDestroy(): void {
    this.vendorSearchSub?.unsubscribe();
  }

  load(): void {
    if (!this.currentOrganizationId) {
      this.error.set('Logged in user has no organization assigned.');
      this.rows.set([]);
      return;
    }

    this.loading.set(true);
    this.error.set('');

    const q = encodeURIComponent(this.filter().trim());
    this.api
      .list<ExpenseRow>(`/api/v1/expenses?organizationId=${encodeURIComponent(this.currentOrganizationId)}&q=${q}&limit=100`)
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          this.rows.set(response.data || []);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(err?.error?.message || 'Unable to load expenses.');
        },
      });
  }

  openCreateModal(): void {
    this.createForm = this.newExpenseForm();
    this.vendorSearch.set('');
    this.selectedCreateVendor.set(null);
    this.vendors.set([]);
    this.showInlineVendorCreate.set(false);
    this.vendorCreateError.set('');
    this.vendorCreateForm = this.newVendorForm();
    this.loadVendors('');
    this.error.set('');
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
    this.vendorCreateForm = this.newVendorForm();
  }

  createExpense(): void {
    if (!this.currentOrganizationId) {
      this.error.set('Logged in user has no organization assigned.');
      return;
    }
    if (!String(this.createForm['vendorId'] || '').trim()) {
      this.error.set('Please select a vendor from search results.');
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload({
      ...this.createForm,
      organizationId: this.currentOrganizationId,
      createdBy: this.currentUserId,
      updatedBy: this.currentUserId,
    });

    this.api.create<ExpenseRow>('/api/v1/expenses', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Expense created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create expense.');
      },
    });
  }

  startEdit(row: ExpenseRow): void {
    this.editingId = row.id;
    this.editForm = {
      organizationId: row.organizationId || '',
      vendorId: row.vendorId || '',
      vendorTaxId: row.vendorTaxId || '',
      expenseNumber: row.expenseNumber || '',
      vatExemptAmount: row.vatExemptAmount ?? 0,
      category: row.category || '',
      description: row.description || '',
      expenseDate: row.expenseDate || '',
      dueDate: row.dueDate || '',
      status: row.status || 'draft',
      paymentMethod: row.paymentMethod || 'bank_transfer',
      currency: row.currency || this.currentOrganizationCurrency,
      amount: row.amount ?? 0,
      taxAmount: row.taxAmount ?? 0,
      discountAmount: row.discountAmount ?? 0,
      totalAmount: row.totalAmount ?? 0,
      notes: row.notes || '',
      updatedBy: this.currentUserId,
    };
  }

  cancelEdit(): void {
    this.editingId = '';
    this.editForm = this.newExpenseForm();
  }

  saveEdit(): void {
    if (!this.editingId) return;

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

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
        this.error.set(err?.error?.message || 'Unable to update expense.');
      },
    });
  }

  removeExpense(id: string): void {
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

  vendorLabel(row: ExpenseRow): string {
    return row.vendor?.name || row.vendorId || '-';
  }

  onVendorSearchChange(value: string): void {
    this.vendorSearch.set(value);
    this.selectedCreateVendor.set(null);
    this.showInlineVendorCreate.set(false);
    this.vendorCreateError.set('');
    this.createForm['vendorId'] = '';
    this.createForm['vendorTaxId'] = '';
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
      postalCode: this.optionalString(this.vendorCreateForm['postalCode']),
      country: this.optionalString(this.vendorCreateForm['country']),
      paymentTerms: this.optionalString(this.vendorCreateForm['paymentTerms']),
      notes: this.optionalString(this.vendorCreateForm['notes']),
      status: 'active',
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

  private loadVendors(search = ''): void {
    if (!this.currentOrganizationId) {
      return;
    }

    this.loadingVendors.set(true);
    const params = new URLSearchParams({
      limit: '20',
      activeOnly: 'true',
    });
    const cleaned = String(search || '').trim();
    if (cleaned) {
      params.set('q', cleaned);
    }

    this.api.list<VendorOption>(`/api/v1/vendors?${params.toString()}`).subscribe({
      next: (response) => {
        this.loadingVendors.set(false);
        this.vendors.set(response.data || []);
      },
      error: () => {
        this.loadingVendors.set(false);
        this.vendors.set([]);
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
      category: '',
      description: '',
      expenseDate: '',
      dueDate: '',
      status: 'draft',
      paymentMethod: 'bank_transfer',
      currency: this.currentOrganizationCurrency,
      amount: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
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
      postalCode: '',
      country: 'United States',
      paymentTerms: '',
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
      category: this.optionalString(form['category']),
      description: this.optionalString(form['description']),
      expenseDate: this.optionalString(form['expenseDate']),
      dueDate: this.optionalString(form['dueDate']),
      status: this.optionalString(form['status']),
      paymentMethod: this.optionalString(form['paymentMethod']),
      amount: this.optionalNumber(form['amount']),
      taxAmount: this.optionalNumber(form['taxAmount']),
      discountAmount: this.optionalNumber(form['discountAmount']),
      totalAmount: this.optionalNumber(form['totalAmount']),
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
