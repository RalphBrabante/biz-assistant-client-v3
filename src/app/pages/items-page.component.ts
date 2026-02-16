import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ApiResponse } from '../core/types';
import { TooltipDirective } from '../shared/tooltip.directive';

interface ItemRow {
  id: string;
  organizationId: string;
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

  readonly message = signal('');
  readonly error = signal('');
  readonly importModalError = signal('');
  readonly importSummary = signal<ItemImportSummary | null>(null);
  readonly filter = signal('');
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  readonly pageSizeOptions = [10, 20, 50, 100];

  createForm: Record<string, unknown> = this.newItemForm();

  editingId = '';
  editForm: Record<string, unknown> = this.newItemForm();
  private importFile: File | null = null;

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

  ngOnInit(): void {
    this.load();
    if (this.canReadOrganizations) {
      this.loadOrganizations();
    } else {
      this.organizations.set([]);
    }
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

    this.api.list<ItemRow>(`/api/v1/items?${params.toString()}`).subscribe({
      next: (response: ApiResponse<ItemRow[]>) => {
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
    this.createForm = {
      ...this.newItemForm(),
      organizationId: this.currentOrganizationId,
    };
    this.error.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  createItem(): void {
    if (!this.currentOrganizationId.trim()) {
      if (this.organizationContext.isAllOrganizationsSelected()) {
        this.error.set('Select a specific organization before creating an item.');
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

    this.api.create<ItemRow>('/api/v1/items', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Item created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create item.');
      },
    });
  }

  openEditModal(row: ItemRow): void {
    this.editingId = row.id;
    this.editForm = {
      organizationId: row.organizationId || '',
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
    this.error.set('');
    this.message.set('');
    this.isEditModalOpen.set(true);
  }

  closeEditModal(): void {
    this.editingId = '';
    this.editForm = this.newItemForm();
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

  trackById(_index: number, row: ItemRow): string {
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

  organizationLabel(row: ItemRow): string {
    if (row.organization?.name) {
      return row.organization.name;
    }
    if (row.organization?.legalName) {
      return row.organization.legalName;
    }
    return this.organizationOptionLabelById(row.organizationId) || row.organizationId || '-';
  }

  itemTypeBadgeClass(type: string | undefined): string {
    switch (String(type || '').toLowerCase()) {
      case 'product':
        return 'text-bg-primary';
      case 'service':
        return 'text-bg-info';
      default:
        return 'text-bg-secondary';
    }
  }

  itemActiveBadgeClass(isActive: boolean | undefined): string {
    return isActive ? 'text-bg-success' : 'text-bg-secondary';
  }

  itemStockBadgeClass(row: ItemRow): string {
    const stock = Math.max(0, Number(row.stock ?? 0));
    const reorderLevel = Math.max(0, Number(row.reorderLevel ?? 0));
    const lowStockThreshold = reorderLevel > 0 ? reorderLevel : 5;

    if (stock === 0) {
      return 'text-bg-danger';
    }
    if (stock <= lowStockThreshold) {
      return 'text-bg-warning';
    }
    return 'text-bg-success';
  }

  organizationOptionLabel(org: OrganizationOption): string {
    return org.name || org.legalName || org.id;
  }

  formatMoney(value: unknown, currency?: string): string {
    const amount = Number(value ?? 0);
    const code = String(currency || this.currentOrganizationCurrency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number.isFinite(amount) ? amount : 0);
    } catch (_err) {
      return `${code} ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
    }
  }

  get currentOrganizationName(): string {
    return (
      this.organizationOptionLabelById(this.currentOrganizationId) ||
      this.auth.currentUser()?.organizationId ||
      'Current organization'
    );
  }

  private newItemForm(): Record<string, unknown> {
    return {
      organizationId: '',
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
    return {
      organizationId: this.asString(form['organizationId']),
      type: this.optionalString(form['type']),
      sku: this.optionalString(form['sku']),
      name: this.asString(form['name']),
      description: this.optionalString(form['description']),
      category: this.optionalString(form['category']),
      unit: this.optionalString(form['unit']),
      price: this.optionalNumber(form['price']),
      cost: this.optionalNumber(form['cost']),
      discountedPrice: this.optionalNumber(form['discountedPrice']),
      stock: this.optionalNumber(form['stock']),
      reorderLevel: this.optionalNumber(form['reorderLevel']),
      isActive: Boolean(form['isActive']),
    };
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
}
