import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ApiResponse } from '../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../core/table-preferences';
import { TooltipDirective } from '../shared/tooltip.directive';

interface ItemRow {
  id: string;
  organizationId: string;
  vendorId?: string | null;
  vendor?: {
    id: string;
    name?: string;
    legalName?: string;
    taxId?: string;
  };
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  type?: string;
  sku?: string;
  name: string;
  description?: string;
  category?: string;
  unit?: string;
  price?: number;
  cost?: number;
  discountedPrice?: number;
  currency?: string;
  stock?: number;
  reorderLevel?: number;
  isActive?: boolean;
}

interface OrganizationOption {
  id: string;
  name?: string;
  legalName?: string;
}

interface VendorOption {
  id: string;
  name?: string;
  legalName?: string;
  taxId?: string;
}

interface ItemImportSummary {
  imported: number;
  skipped: number;
  totalRows: number;
  errors: string[];
}

@Component({
  selector: 'app-items-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TooltipDirective],
  templateUrl: './items-page.component.html',
})
export class ItemsPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);

  readonly rows = signal<ItemRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);
  readonly isImportModalOpen = signal(false);
  readonly exporting = signal(false);
  readonly organizations = signal<OrganizationOption[]>([]);
  readonly vendorFilterResults = signal<VendorOption[]>([]);
  readonly loadingVendorFilter = signal(false);
  readonly selectedVendorFilter = signal<VendorOption | null>(null);
  readonly editVendors = signal<VendorOption[]>([]);
  readonly loadingEditVendors = signal(false);
  readonly selectedEditVendor = signal<VendorOption | null>(null);

  readonly message = signal('');
  readonly error = signal('');
  readonly createModalError = signal('');
  readonly importModalError = signal('');
  readonly importSummary = signal<ItemImportSummary | null>(null);
  readonly filter = signal('');
  vendorFilter = '';
  vendorFilterSearch = '';
  readonly pageSizeOptions = [10, 20, 50, 100];
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
    viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'items-page';

  createForm: Record<string, unknown> = this.newItemForm();

  editingId = '';
  editForm: Record<string, unknown> = this.newItemForm();
  private importFile: File | null = null;
  private readonly vendorFilterSearchInput$ = new Subject<string>();
  private vendorFilterSearchSub?: Subscription;
  private readonly editVendorSearchInput$ = new Subject<string>();
  private editVendorSearchSub?: Subscription;
  editVendorSearch = '';
  private lastVendorScope = '';

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
  }

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get canReadOrganizations(): boolean {
    return this.isSuperuser || this.auth.hasPermission('organizations.read');
  }

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  get currentOrganizationName(): string {
    const orgId = this.currentOrganizationId;
    if (!orgId) {
      return 'No organization selected';
    }
    return this.organizationOptionLabelById(orgId) || orgId;
  }

  ngOnInit(): void {
    this.restoreTablePreferences();
    if (this.canReadOrganizations) {
      this.loadOrganizations();
    } else {
      this.organizations.set([]);
    }

    this.vendorFilterSearchSub = this.vendorFilterSearchInput$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((query) => {
          const trimmed = query.trim();
          const organizationId = this.currentOrganizationId;
          if (!trimmed || trimmed.length < 2) {
            this.loadingVendorFilter.set(false);
            return of([] as VendorOption[]);
          }
          const params = new URLSearchParams({
            q: trimmed,
            limit: '10',
          });
          if (organizationId) {
            params.set('organizationId', organizationId);
          }
          this.loadingVendorFilter.set(true);
          return this.api.list<VendorOption>(`/api/v1/vendors?${params.toString()}`).pipe(
            switchMap((response) => of(response.data || [])),
            catchError(() => of([] as VendorOption[]))
          );
        })
      )
      .subscribe((vendors) => {
        this.loadingVendorFilter.set(false);
        this.vendorFilterResults.set(vendors);
      });

    this.editVendorSearchSub = this.editVendorSearchInput$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((query) => {
          const trimmed = query.trim();
          const organizationId = String(this.editForm['organizationId'] || '').trim() || this.currentOrganizationId;
          if (!trimmed || trimmed.length < 2 || !organizationId) {
            this.loadingEditVendors.set(false);
            return of([] as VendorOption[]);
          }
          const params = new URLSearchParams({
            q: trimmed,
            limit: '10',
            organizationId,
          });
          this.loadingEditVendors.set(true);
          return this.api.list<VendorOption>(`/api/v1/vendors?${params.toString()}`).pipe(
            switchMap((response) => of(response.data || [])),
            catchError(() => of([] as VendorOption[]))
          );
        })
      )
      .subscribe((vendors) => {
        this.loadingEditVendors.set(false);
        this.editVendors.set(vendors);
      });

    this.load();
  }

  ngOnDestroy(): void {
    this.vendorFilterSearchSub?.unsubscribe();
    this.editVendorSearchSub?.unsubscribe();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const q = this.filter().trim();
    const currentScope = this.currentOrganizationId || (this.isSuperuser ? '__all__' : '');
    if (currentScope !== this.lastVendorScope) {
      this.lastVendorScope = currentScope;
      this.vendorFilter = '';
      this.vendorFilterSearch = '';
      this.vendorFilterResults.set([]);
      this.selectedVendorFilter.set(null);
      this.loadingVendorFilter.set(false);
    }
    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
    });
    if (q) {
      params.set('q', q);
    }
    if (this.vendorFilter) {
      params.set('vendorId', this.vendorFilter);
    }

    this.api.list<ItemRow>(`/api/v1/items?${params.toString()}`).subscribe({
      next: (response: ApiResponse<ItemRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load items.');
      },
    });
  }

  loadOrganizations(): void {
    this.api.list<OrganizationOption>('/api/v1/organizations?limit=200').subscribe({
      next: (response: ApiResponse<OrganizationOption[]>) => {
        this.organizations.set(response.data || []);
      },
      error: () => {
        this.organizations.set([]);
      },
    });
  }

  openCreateModal(): void {
    this.createForm = this.newItemForm();
    this.error.set('');
    this.createModalError.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.createModalError.set('');
    this.isCreateModalOpen.set(false);
  }

  createItem(): void {
    if (!this.currentOrganizationId.trim()) {
      if (this.organizationContext.isAllOrganizationsSelected()) {
        this.createModalError.set('Select a specific organization before creating an item.');
        return;
      }
      this.createModalError.set('Logged in user has no organization assigned.');
      return;
    }

    this.submitting.set(true);
    this.createModalError.set('');
    this.message.set('');

    const payload = {
      ...this.buildPayload(this.createForm),
      organizationId: this.currentOrganizationId.trim(),
    };

    this.api.create<ItemRow>('/api/v1/items', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Item created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.createModalError.set(err?.error?.message || 'Unable to create item.');
      },
    });
  }

  openEditModal(row: ItemRow): void {
    this.editingId = row.id;
    this.editForm = {
      organizationId: row.organizationId || '',
      vendorId: row.vendorId || '',
      type: row.type || '',
      sku: row.sku || '',
      name: row.name || '',
      description: row.description || '',
      category: row.category || '',
      unit: row.unit || '',
      price: row.price ?? 0,
      cost: row.cost ?? 0,
      discountedPrice: row.discountedPrice ?? '',
      currency: row.currency || this.currentOrganizationCurrency,
      stock: row.stock ?? 0,
      reorderLevel: row.reorderLevel ?? 0,
      isActive: row.isActive !== false,
    };
    this.selectedEditVendor.set(row.vendor || null);
    this.editVendorSearch = row.vendor?.name || row.vendor?.legalName || '';
    this.editVendors.set([]);
    this.loadingEditVendors.set(false);
    this.error.set('');
    this.message.set('');
    this.isEditModalOpen.set(true);
  }

  closeEditModal(): void {
    this.editingId = '';
    this.editForm = this.newItemForm();
    this.editVendorSearch = '';
    this.editVendors.set([]);
    this.selectedEditVendor.set(null);
    this.loadingEditVendors.set(false);
    this.isEditModalOpen.set(false);
  }

  openImportModal(): void {
    this.importFile = null;
    this.importModalError.set('');
    this.error.set('');
    this.message.set('');
    this.isImportModalOpen.set(true);
  }

  closeImportModal(): void {
    this.importFile = null;
    this.importModalError.set('');
    this.isImportModalOpen.set(false);
  }

  onImportFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.importFile = target?.files && target.files.length > 0 ? target.files[0] : null;
  }

  importItemsCsv(): void {
    if (!this.importFile) {
      this.importModalError.set('Please select a CSV file to import.');
      return;
    }
    if (this.organizationContext.isAllOrganizationsSelected()) {
      this.importModalError.set('Select a specific organization before importing items.');
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

    this.api.createFormData<Record<string, unknown>>('/api/v1/items/import', formData).subscribe({
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
        this.importModalError.set(err?.error?.message || 'Unable to import items.');
      },
    });
  }

  clearImportSummary(): void {
    this.importSummary.set(null);
  }

  exportItemsCsv(): void {
    this.exporting.set(true);
    this.error.set('');
    this.message.set('');

    const params = new URLSearchParams();
    const q = this.filter().trim();
    if (q) {
      params.set('q', q);
    }
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }
    if (this.vendorFilter) {
      params.set('vendorId', this.vendorFilter);
    }

    this.api.download(`/api/v1/items/export?${params.toString()}`).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `items-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.message.set('Items CSV exported successfully.');
      },
      error: (err) => {
        this.exporting.set(false);
        this.error.set(err?.error?.message || 'Unable to export items.');
      },
    });
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Item',
      message: 'Save changes to this item?',
      confirmText: 'Update Item',
      confirmButtonClass: 'btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload(this.editForm);

    this.api.update<ItemRow>('/api/v1/items', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Item updated successfully.');
        this.closeEditModal();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update item.');
      },
    });
  }

  async removeItem(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Item',
      message: 'Delete this item? This action cannot be undone.',
      confirmText: 'Delete Item',
      confirmButtonClass: 'btn-danger',
      iconClass: 'bi-box-seam',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/items', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Item deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete item.');
      },
    });
  }

  setViewMode(mode: TableViewMode): void {
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  onFilterChange(value: string): void {
    this.filter.set(value);
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  onPageSizeChange(value: string): void {
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  onVendorFilterSearchChange(value: string): void {
    const query = String(value || '');
    this.vendorFilterSearch = query;
    if (this.selectedVendorFilter()) {
      this.selectedVendorFilter.set(null);
      this.vendorFilter = '';
    }
    if (!query.trim()) {
      this.loadingVendorFilter.set(false);
      this.vendorFilterResults.set([]);
      this.page = 1;
      this.persistTablePreferences();
      this.load();
      return;
    }
    if (query.trim().length < 2) {
      this.loadingVendorFilter.set(false);
      this.vendorFilterResults.set([]);
      return;
    }
    this.vendorFilterSearchInput$.next(query);
  }

  selectVendorFilter(vendor: VendorOption): void {
    this.selectedVendorFilter.set(vendor);
    this.vendorFilter = vendor.id;
    this.vendorFilterSearch = this.vendorOptionLabel(vendor);
    this.vendorFilterResults.set([]);
    this.loadingVendorFilter.set(false);
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  clearVendorFilter(): void {
    this.selectedVendorFilter.set(null);
    this.vendorFilter = '';
    this.vendorFilterSearch = '';
    this.vendorFilterResults.set([]);
    this.loadingVendorFilter.set(false);
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page || this.loading()) {
      return;
    }
    this.page = page;
    this.persistTablePreferences();
    this.load();
  }

  private restoreTablePreferences(): void {
    const prefs = loadTablePreferences(this.tablePrefsKey);
    this.page = toPositiveInt(prefs['page'], this.page);
    this.pageSize = toPositiveInt(prefs['pageSize'], this.pageSize);
    this.viewMode = toTableViewMode(prefs['viewMode'], this.viewMode);
    this.vendorFilter = String(prefs['vendorFilter'] || '').trim();
    this.vendorFilterSearch = String(prefs['vendorFilterSearch'] || '').trim();
  }

  private persistTablePreferences(): void {
    saveTablePreferences(this.tablePrefsKey, {
      page: this.page,
      pageSize: this.pageSize,
      viewMode: this.viewMode,
      vendorFilter: this.vendorFilter,
      vendorFilterSearch: this.vendorFilterSearch,
    });
  }

  trackById(_index: number, row: ItemRow): string {
    return row.id;
  }

  organizationLabel(row: ItemRow): string {
    return row.organization?.name || row.organization?.legalName || row.organizationId || '-';
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

  itemTypeBadgeClass(type: unknown): string {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'service') return 'text-bg-info';
    if (normalized === 'product') return 'text-bg-primary';
    return 'text-bg-secondary';
  }

  itemStockBadgeClass(row: ItemRow): string {
    const stock = Number(row.stock ?? 0);
    const reorderLevel = Number(row.reorderLevel ?? 0);
    if (stock <= 0) return 'text-bg-danger';
    if (reorderLevel > 0 && stock <= reorderLevel) return 'text-bg-warning';
    return 'text-bg-success';
  }

  itemActiveBadgeClass(isActive: unknown): string {
    return isActive === false ? 'text-bg-secondary' : 'text-bg-success';
  }

  organizationOptionLabel(org: OrganizationOption): string {
    return org.name || org.legalName || org.id;
  }

  vendorOptionLabel(vendor: VendorOption): string {
    const base = vendor.name || vendor.legalName || vendor.id;
    return vendor.taxId ? `${base} (${vendor.taxId})` : base;
  }

  private newItemForm(): Record<string, unknown> {
    return {
      organizationId: '',
      vendorId: '',
      type: 'product',
      sku: '',
      name: '',
      description: '',
      category: '',
      unit: 'pcs',
      price: 0,
      cost: 0,
      discountedPrice: '',
      currency: this.currentOrganizationCurrency,
      stock: 0,
      reorderLevel: 0,
      isActive: true,
    };
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      type: this.optionalString(form['type']),
      sku: this.optionalString(form['sku']),
      name: this.asString(form['name']),
      description: this.optionalString(form['description']),
      category: this.optionalString(form['category']),
      unit: this.optionalString(form['unit']),
      price: this.optionalNumber(form['price']),
      cost: this.optionalNumber(form['cost']),
      discountedPrice: this.optionalNumber(form['discountedPrice']),
      vendorId: this.optionalString(form['vendorId']) || null,
      stock: this.optionalNumber(form['stock']),
      reorderLevel: this.optionalNumber(form['reorderLevel']),
      isActive: Boolean(form['isActive']),
    };

    const organizationId = this.asString(form['organizationId']);
    if (organizationId) {
      payload['organizationId'] = organizationId;
    }

    return payload;
  }

  private organizationOptionLabelById(id: string): string | undefined {
    const match = this.organizations().find((org) => org.id === id);
    if (!match) {
      return undefined;
    }
    return this.organizationOptionLabel(match);
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

  onEditVendorSearchChange(query: string): void {
    this.editVendorSearch = query;
    if (this.selectedEditVendor()) {
      this.selectedEditVendor.set(null);
      this.editForm['vendorId'] = '';
    }
    if (!query.trim() || query.trim().length < 2) {
      this.editVendors.set([]);
      this.loadingEditVendors.set(false);
      return;
    }
    this.editVendorSearchInput$.next(query);
  }

  selectEditVendor(vendor: VendorOption): void {
    this.selectedEditVendor.set(vendor);
    this.editForm['vendorId'] = vendor.id;
    this.editVendorSearch = vendor.name || vendor.legalName || '';
    this.editVendors.set([]);
    this.loadingEditVendors.set(false);
  }

  clearEditVendorSelection(): void {
    this.selectedEditVendor.set(null);
    this.editForm['vendorId'] = '';
    this.editVendorSearch = '';
    this.editVendors.set([]);
    this.loadingEditVendors.set(false);
  }
}
